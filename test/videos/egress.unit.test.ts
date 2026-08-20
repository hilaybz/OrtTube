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

vi.mock("undici", () => ({
  fetch: undiciFetch,
  ProxyAgent: class {
    constructor(uri: string) {
      proxyAgentCtor(uri);
    }
  },
}));

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

describe("last-known-good memo", () => {
  it("sends the next request straight to the exit that worked", async () => {
    // Burned proxies are the common case, so without this every request pays
    // for the dead ones ahead of it in the list.
    undiciFetch
      .mockResolvedValueOnce(reply(BOT_CHECK))
      .mockResolvedValueOnce(reply(GOOD))
      .mockResolvedValue(reply(GOOD));
    const { proxiedFetch } = await loadEgress("1.1.1.1:1:u:p,2.2.2.2:2:u:p");

    await proxiedFetch("https://www.youtube.com/watch?v=x");
    expect(undiciFetch).toHaveBeenCalledTimes(2);

    await proxiedFetch("https://www.youtube.com/watch?v=y");

    // One more call total, not two: it skipped the known-bad exit.
    expect(undiciFetch).toHaveBeenCalledTimes(3);
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
