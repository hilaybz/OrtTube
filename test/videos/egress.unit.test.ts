/**
 * Proxy egress for YouTube requests — no network.
 *
 * YouTube bot-checks Vercel's datacenter IP, so production routes these
 * requests through proxies instead. The pool is deliberately unreliable: free
 * proxies get burned, and only some of any given list answer (measured: 3 of
 * 10). So what needs pinning is not "a proxy is used" but the fallthrough — a
 * refused exit must cost one wasted request, not the whole fetch.
 *
 * `undici` is mocked at the module boundary so a dispatcher never opens a
 * socket, and each case scripts what an exit returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const undiciFetch = vi.hoisted(() => vi.fn());
const proxyAgentCtor = vi.hoisted(() => vi.fn());
const agentClosed = vi.hoisted(() => vi.fn());

/**
 * The fake agent keeps its own `uri`, so a test can tell WHICH exit a request
 * went through. Without that the mock can only be scripted in call order, and
 * an assertion on call COUNT passes whether or not the exit was chosen
 * correctly — which is how the memo test below was originally tautological.
 *
 * Note this is a property the REAL ProxyAgent does not expose — it exists here
 * only so tests can identify a dispatcher. Production code must not read it;
 * `lib/egress.ts` keeps its own label alongside each agent for that reason.
 */
vi.mock("undici", () => ({
  fetch: undiciFetch,
  ProxyAgent: class {
    uri: string;
    constructor(options: string | { uri: string }) {
      this.uri = typeof options === "string" ? options : options.uri;
      // Mirrors the real constructor, which rejects an unsupported scheme with
      // InvalidArgumentError and an unparseable URL with TypeError (measured on
      // undici 8.10). A permissive mock here would let a pool-construction bug
      // through, since the whole hazard is that this throws.
      const parsed = new URL(this.uri);
      if (!/^(https?|socks[45]?):$/.test(parsed.protocol) || !parsed.hostname) {
        throw new Error(`InvalidArgumentError: unsupported proxy protocol ${parsed.protocol}`);
      }
      proxyAgentCtor(this.uri);
    }
    async close() {
      agentClosed(this.uri);
    }
  },
}));

/** The exit a recorded call was dispatched through, as `host:port`. */
function exitOf(call: number): string {
  return new URL(undiciFetch.mock.calls[call][1].dispatcher.uri).host;
}

/** An undici-shaped response: only what `proxiedFetch` reads off it. */
function reply(body: string, status = 200) {
  return {
    status,
    statusText: "",
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
  };
}

const BOT_CHECK = JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
const GOOD = JSON.stringify({ playabilityStatus: { status: "OK" } });

/** Imported fresh per test so the module's proxy pool and memo start clean. */
async function loadEgress(proxies?: string) {
  if (proxies === undefined) delete process.env.YOUTUBE_PROXY_URLS;
  else process.env.YOUTUBE_PROXY_URLS = proxies;
  vi.resetModules();
  return import("@/lib/egress");
}

beforeEach(() => {
  undiciFetch.mockReset();
  proxyAgentCtor.mockReset();
  agentClosed.mockReset();
});

afterEach(() => {
  delete process.env.YOUTUBE_PROXY_URLS;
  vi.unstubAllGlobals();
});

describe("proxiedFetch with no proxy configured", () => {
  it("delegates to the GLOBAL fetch, so stubs and local dev still work", async () => {
    // Not a stylistic point: unit tests across the suite drive YouTube by
    // stubbing global.fetch, and going through undici here would walk past
    // every one of them onto the real network.
    const globalFetch = vi.fn(async () => new Response("direct"));
    vi.stubGlobal("fetch", globalFetch);
    const { proxiedFetch } = await loadEgress();

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(await res.text()).toBe("direct");
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
    expect(proxyAgentCtor).not.toHaveBeenCalled();
  });
});

describe("proxy URL parsing", () => {
  it("accepts the host:port:user:pass form proxy dashboards export", async () => {
    const { normalizeProxyUrl } = await loadEgress("");
    expect(normalizeProxyUrl("1.2.3.4:6754:bob:secret")).toBe("http://bob:secret@1.2.3.4:6754");
  });

  it("passes a full URL through unchanged", async () => {
    const { normalizeProxyUrl } = await loadEgress("");
    expect(normalizeProxyUrl("http://bob:secret@1.2.3.4:6754")).toBe(
      "http://bob:secret@1.2.3.4:6754"
    );
  });

  it("drops an unparseable entry instead of throwing", async () => {
    // One malformed entry must not take down every YouTube fetch in the app.
    const { normalizeProxyUrl } = await loadEgress("");
    expect(normalizeProxyUrl("nonsense")).toBeNull();
  });

  it("skips malformed entries but still builds the valid ones", async () => {
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("nonsense,1.2.3.4:6754:bob:secret");

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(proxyAgentCtor).toHaveBeenCalledTimes(1);
    expect(proxyAgentCtor).toHaveBeenCalledWith("http://bob:secret@1.2.3.4:6754");
  });
});

describe("fallthrough", () => {
  it("moves to the next exit when one is bot-checked", async () => {
    undiciFetch
      .mockResolvedValueOnce(reply(BOT_CHECK))
      .mockResolvedValueOnce(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(await res.text()).toBe(GOOD);
  });

  it("treats 429 as refused, not as an answer", async () => {
    undiciFetch
      .mockResolvedValueOnce(reply("rate limited", 429))
      .mockResolvedValueOnce(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(res.status).toBe(200);
    expect(undiciFetch).toHaveBeenCalledTimes(2);
  });

  it("moves on when an exit throws outright", async () => {
    undiciFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(res.status).toBe(200);
  });

  it("returns the LAST refused response when every exit is blocked", async () => {
    // fetchFreshTranscript already classifies a bot-checked response as a
    // transient error; throwing a novel one here would only bypass that.
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(await res.text()).toBe(BOT_CHECK);
  });

  it("throws only when every exit threw and none answered", async () => {
    undiciFetch.mockRejectedValue(new TypeError("fetch failed"));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await expect(proxiedFetch("https://www.youtube.com/watch?v=x")).rejects.toThrow(
      "fetch failed"
    );
  });
});

describe("self-healing exits", () => {
  it("retires a refused exit's agent so the next request gets a fresh IP", async () => {
    // undici pins one exit IP per ProxyAgent for its whole life (measured: four
    // requests through one agent all left from the same address). A rotating
    // proxy therefore only rotates if the burned agent is thrown away.
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    // The pool is built lazily, so nothing exists until the first request.
    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(agentClosed).toHaveBeenCalledTimes(1);
    // Two constructions: the original, then its replacement for the same slot.
    expect(proxyAgentCtor).toHaveBeenCalledTimes(2);
    expect(proxyAgentCtor).toHaveBeenLastCalledWith("http://u:p@1.1.1.1:1");
  });

  it("retires an exit that threw, not only one that was refused", async () => {
    // A dead tunnel would otherwise be retried for the life of the instance.
    undiciFetch.mockRejectedValue(new TypeError("fetch failed"));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await expect(proxiedFetch("https://www.youtube.com/watch?v=x")).rejects.toThrow();

    expect(agentClosed).toHaveBeenCalledTimes(1);
    expect(proxyAgentCtor).toHaveBeenCalledTimes(2);
  });

  it("leaves a working exit's agent alone", async () => {
    // Rebuilding on success would throw away connection reuse for nothing.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(agentClosed).not.toHaveBeenCalled();
    expect(proxyAgentCtor).toHaveBeenCalledTimes(1);
  });
});

describe("last-known-good memo", () => {
  it("sends the next request straight to the exit that worked", async () => {
    // Burned proxies are the common case, so without this every request pays
    // for the dead ones ahead of it in the list.
    //
    // Scripted by EXIT, not by call order: with an ordered mock the second
    // request succeeds on its first attempt no matter which exit it picks, so
    // a call-count assertion alone passes even with the memo deleted.
    undiciFetch.mockImplementation(async (_url: string, opts: { dispatcher: { uri: string } }) =>
      opts.dispatcher.uri.includes("1.1.1.1") ? reply(BOT_CHECK) : reply(GOOD)
    );
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(exitOf(0)).toBe("1.1.1.1:1");
    expect(exitOf(1)).toBe("2.2.2.2:2");

    await proxiedFetch("https://www.youtube.com/watch?v=y");

    // The burned exit is skipped entirely: one more call, and it went straight
    // to the exit that answered last time.
    expect(undiciFetch).toHaveBeenCalledTimes(3);
    expect(exitOf(2)).toBe("2.2.2.2:2");
  });
});

describe("request forwarding", () => {
  it("forwards method, headers and body — the InnerTube POST depends on it", async () => {
    // Nothing else in this file asserts the second argument, so dropping `body`
    // from the dispatch would otherwise go unnoticed until production.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await proxiedFetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"videoId":"x"}',
    });

    expect(undiciFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/youtubei/v1/player",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"videoId":"x"}',
      })
    );
  });

  it("passes an abort signal, so a stalled proxy cannot hang the request", async () => {
    // undici's own defaults are 300s for headers and body; on a sequential
    // sweep that is long enough to outlive the caller.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(undiciFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects shapes it would otherwise send with the body silently dropped", async () => {
    // The exported type is the platform fetch, which is wider than what is
    // supported. Failing loudly beats YouTube answering 400 with no trace.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await expect(
      proxiedFetch("https://x.test", { method: "POST", body: new URLSearchParams({ a: "b" }) })
    ).rejects.toThrow(/string bodies/);
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});

describe("pool construction is not brought down by one bad entry", () => {
  it("survives an entry whose scheme makes ProxyAgent throw", async () => {
    // `new ProxyAgent("htp://…")` throws InvalidArgumentError. Uncaught, that
    // would break every YouTube fetch in the app for as long as the typo lived
    // in the env var.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("htp://1.2.3.4:8080,2.2.2.2:2:u:p");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(res.status).toBe(200);
    expect(exitOf(0)).toBe("2.2.2.2:2");
  });

  it("treats an empty variable as no proxy — the value the example file ships", async () => {
    const globalFetch = vi.fn(async () => new Response("direct"));
    vi.stubGlobal("fetch", globalFetch);
    const { proxiedFetch } = await loadEgress("");

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch).not.toHaveBeenCalled();
  });
});

describe("sweep cooldown", () => {
  it("does not re-sweep the whole pool right after every exit refused", async () => {
    // A genuinely login-gated video returns LOGIN_REQUIRED from every IP on
    // earth, and is indistinguishable from a burned pool. Re-sweeping ten exits
    // at ~1.2MB each on every retry would spend the monthly quota on a video
    // that can never succeed.
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=gated");
    expect(undiciFetch).toHaveBeenCalledTimes(3);

    await proxiedFetch("https://www.youtube.com/watch?v=gated");

    // One probe, not another full pass.
    expect(undiciFetch).toHaveBeenCalledTimes(4);
  });

  it("is per-endpoint, so a working endpoint cannot clear a walled one's cooldown", async () => {
    // Observed in production: YouTube serves the watch page from a datacenter
    // IP but walls api/timedtext from the same address. With a single global
    // cooldown, the watch-page success reset it before it could ever apply, and
    // one attempt made TWO full 10-exit sweeps of timedtext — 20 bot walls.
    undiciFetch.mockImplementation(async (url: string) =>
      url.includes("timedtext") ? reply("nope", 429) : reply(GOOD)
    );
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/api/timedtext?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(3); // full sweep, all refused

    // A different endpoint succeeds in between — this must NOT reset the
    // timedtext cooldown.
    await proxiedFetch("https://www.youtube.com/watch?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(4);

    await proxiedFetch("https://www.youtube.com/api/timedtext?v=x");

    // One probe, not another sweep: 4 + 1, not 4 + 3.
    expect(undiciFetch).toHaveBeenCalledTimes(5);
  });
});

describe("trace", () => {
  it("names what each exit did, so a burned pool is visible", async () => {
    // Without this the caller sees only the last exit's bot check and cannot
    // tell "rotate the proxies" from "YouTube walled everything".
    undiciFetch
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      }))
      .mockResolvedValue(reply(GOOD));
    const { createProxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");
    const trace: string[] = [];

    await createProxiedFetch(trace)("https://www.youtube.com/watch?v=x");

    expect(trace).toHaveLength(1);
    expect(trace[0]).toContain("1.1.1.1:1 ECONNREFUSED");
    expect(trace[0]).toContain("2.2.2.2:2 ok");
  });

  it("names a rejected credential as such, not as an 'abort'", async () => {
    // undici reports a 407 as UND_ERR_ABORTED several .cause levels down, which
    // reads as "someone cancelled this request" and sent a real debugging
    // session looking for a network fault that did not exist.
    undiciFetch.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new DOMException("Request was cancelled."), {
          cause: Object.assign(new Error("Proxy response (407) !== 200 when HTTP Tunneling"), {
            code: "UND_ERR_ABORTED",
          }),
        }),
      })
    );
    const { createProxiedFetch } = await loadEgress("1.1.1.1:1:u:p");
    const trace: string[] = [];

    await expect(createProxiedFetch(trace)("https://x.test")).rejects.toThrow();

    expect(trace[0]).toContain("proxy auth rejected (407)");
    expect(trace[0]).toContain("YOUTUBE_PROXY_URLS");
    expect(trace[0]).not.toContain("UND_ERR_ABORTED");
  });

  it("does not leak proxy credentials into the trace", async () => {
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { createProxiedFetch } = await loadEgress("1.1.1.1:1:bob:hunter2");
    const trace: string[] = [];

    await createProxiedFetch(trace)("https://www.youtube.com/watch?v=x");

    expect(trace.join(" ")).not.toContain("hunter2");
    expect(trace.join(" ")).not.toContain("bob");
  });

  it("stays silent on a clean first-exit success", async () => {
    // The happy path is most requests; a line per call would drown the trace.
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { createProxiedFetch } = await loadEgress("1.1.1.1:1:u:p");
    const trace: string[] = [];

    await createProxiedFetch(trace)("https://www.youtube.com/watch?v=x");

    expect(trace).toHaveLength(0);
  });
});

describe("response rebuilding", () => {
  it("does not forward content-encoding, which no longer describes the body", async () => {
    // undici already decoded it; forwarding the header would describe bytes
    // that no longer exist.
    const res = reply(GOOD);
    res.headers.set("content-encoding", "gzip");
    undiciFetch.mockResolvedValue(res);
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    const out = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(out.headers.get("content-encoding")).toBeNull();
    expect(out.headers.get("content-type")).toBe("text/html");
  });

  it("builds a bodyless Response for 204, which cannot carry one", async () => {
    undiciFetch.mockResolvedValue({
      status: 204,
      statusText: "No Content",
      headers: new Headers(),
      text: async () => "",
    });
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    const out = await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(out.status).toBe(204);
    expect(out.body).toBeNull();
  });
});
