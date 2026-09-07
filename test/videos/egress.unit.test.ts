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

function exitOf(call: number): string {
  return new URL(undiciFetch.mock.calls[call][1].dispatcher.uri).host;
}

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

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(agentClosed).toHaveBeenCalledTimes(1);
    expect(proxyAgentCtor).toHaveBeenCalledTimes(2);
    expect(proxyAgentCtor).toHaveBeenLastCalledWith("http://u:p@1.1.1.1:1");
  });

  it("retires an exit that threw, not only one that was refused", async () => {
    undiciFetch.mockRejectedValue(new TypeError("fetch failed"));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await expect(proxiedFetch("https://www.youtube.com/watch?v=x")).rejects.toThrow();

    expect(agentClosed).toHaveBeenCalledTimes(1);
    expect(proxyAgentCtor).toHaveBeenCalledTimes(2);
  });

  it("leaves a working exit's agent alone", async () => {
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x");

    expect(agentClosed).not.toHaveBeenCalled();
    expect(proxyAgentCtor).toHaveBeenCalledTimes(1);
  });
});

describe("exit rotation", () => {
  it("starts each request at a different exit", async () => {
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=a");
    await proxiedFetch("https://www.youtube.com/watch?v=b");
    await proxiedFetch("https://www.youtube.com/watch?v=c");

    expect([exitOf(0), exitOf(1), exitOf(2)]).toEqual([
      "1.1.1.1:1",
      "2.2.2.2:2",
      "3.3.3.3:3",
    ]);
  });

  it("wraps around, and still falls through a refused exit", async () => {
    undiciFetch.mockImplementation(async (_url: string, opts: { dispatcher: { uri: string } }) =>
      opts.dispatcher.uri.includes("2.2.2.2") ? reply(BOT_CHECK) : reply(GOOD)
    );
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=a");
    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(exitOf(0)).toBe("1.1.1.1:1");

    const res = await proxiedFetch("https://www.youtube.com/watch?v=b");
    expect(exitOf(1)).toBe("2.2.2.2:2");
    expect(exitOf(2)).toBe("1.1.1.1:1");
    expect(await res.text()).toBe(GOOD);
  });
});

describe("request forwarding", () => {
  it("forwards method, headers and body — the InnerTube POST depends on it", async () => {
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

  it("aborts a stalled proxy on a SHORT deadline, not merely 'at some point'", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      undiciFetch.mockResolvedValue(reply(GOOD));
      const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");

      await proxiedFetch("https://www.youtube.com/watch?v=x");

      expect(undiciFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it("honours the caller's own budget alongside the per-exit deadline", async () => {
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p");
    const caller = new AbortController();

    await proxiedFetch("https://www.youtube.com/watch?v=x", { signal: caller.signal });
    const signal: AbortSignal = undiciFetch.mock.calls[0][1].signal;

    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("stops trying exits once the caller's budget is spent", async () => {
    const caller = new AbortController();
    undiciFetch.mockImplementation(async () => {
      caller.abort();
      return reply(BOT_CHECK);
    });
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x", { signal: caller.signal });

    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects shapes it would otherwise send with the body silently dropped", async () => {
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
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=gated");
    expect(undiciFetch).toHaveBeenCalledTimes(3);

    await proxiedFetch("https://www.youtube.com/watch?v=gated");

    expect(undiciFetch).toHaveBeenCalledTimes(4);
  });

  it("is per-endpoint, so a working endpoint cannot clear a walled one's cooldown", async () => {
    undiciFetch.mockImplementation(async (url: string) =>
      url.includes("timedtext") ? reply("nope", 429) : reply(GOOD)
    );
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p,3.3.3.3:3:u:p");

    await proxiedFetch("https://www.youtube.com/api/timedtext?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(3);

    await proxiedFetch("https://www.youtube.com/watch?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(4);

    await proxiedFetch("https://www.youtube.com/api/timedtext?v=x");

    expect(undiciFetch).toHaveBeenCalledTimes(5);
  });
});

describe("trace", () => {
  it("names what each exit did, so a burned pool is visible", async () => {
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
    undiciFetch.mockResolvedValue(reply(GOOD));
    const { createProxiedFetch } = await loadEgress("1.1.1.1:1:u:p");
    const trace: string[] = [];

    await createProxiedFetch(trace)("https://www.youtube.com/watch?v=x");

    expect(trace).toHaveLength(0);
  });
});

describe("response rebuilding", () => {
  it("does not forward content-encoding, which no longer describes the body", async () => {
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

describe("sweep cost", () => {
  const TEN = Array.from({ length: 10 }, (_, i) => `${i}.${i}.${i}.${i}:1:u:p`).join(",");

  it("gives up after a few exits instead of walking the whole pool", async () => {
    undiciFetch.mockResolvedValue(reply(BOT_CHECK));
    const { proxiedFetch } = await loadEgress(TEN);

    await proxiedFetch("https://www.youtube.com/api/timedtext?v=x");

    expect(undiciFetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("keeps trying other exits after a login wall, even once the pool has worked", async () => {
    // An age-gated video answers LOGIN_REQUIRED from every IP, byte-identically
    // to a bot wall, so it is tempting to treat a wall as proof about the video
    // whenever the pool recently succeeded and stop there. That is unsound: every
    // entry is an independent draw from ONE rotating endpoint, so a burned draw
    // can wall a video the next draw would serve. Giving up would trade a
    // recoverable fetch for two saved requests.
    const { proxiedFetch } = await loadEgress(TEN);
    undiciFetch.mockResolvedValue(reply(GOOD));
    await proxiedFetch("https://www.youtube.com/youtubei/v1/player");

    undiciFetch.mockReset();
    undiciFetch
      .mockResolvedValueOnce(reply(BOT_CHECK))
      .mockResolvedValue(reply(GOOD));
    const res = await proxiedFetch("https://www.youtube.com/youtubei/v1/player?v=other");

    expect(undiciFetch).toHaveBeenCalledTimes(2);
    expect(await res.text()).toBe(GOOD);
  });

  it("passes a non-OK playability straight through rather than sweeping", async () => {
    // UNPLAYABLE and ERROR are verdicts about the video that every IP returns
    // identically. Retrying them costs requests and changes nothing.
    undiciFetch.mockResolvedValue(
      reply(JSON.stringify({ playabilityStatus: { status: "UNPLAYABLE" } }))
    );
    const { proxiedFetch } = await loadEgress(TEN);

    const res = await proxiedFetch("https://www.youtube.com/youtubei/v1/player");

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
