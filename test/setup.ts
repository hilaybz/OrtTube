// Vitest global setup: load local Supabase credentials from `.env.local` into
// `process.env` before any test module (or the modules it imports) reads them.
//
// Next.js loads `.env.local` automatically; Vitest does not, so we do it here.
// `dotenv` does not override variables already present in the environment, so a
// CI-provided value still wins.
import { config } from "dotenv";
import { resolve } from "node:path";
import WebSocket from "ws";

config({ path: resolve(process.cwd(), ".env.local") });

// Unit tests drive YouTube by stubbing `global.fetch`. `proxiedFetch` only
// delegates there when NO proxy is configured — with one set it uses undici and
// a real dispatcher instead, which walks straight past the stub and onto the
// network. A developer with `YOUTUBE_PROXY_URLS` in `.env.local` would then see
// tests that hit real YouTube through a metered proxy and fail for reasons
// having nothing to do with their change. Tests that want proxy behaviour set
// this themselves, per case.
delete process.env.YOUTUBE_PROXY_URLS;

// supabase-js constructs a Realtime client (which needs a global WebSocket) even
// when Realtime is unused. Node < 22 has no native WebSocket, so polyfill it from
// the `ws` package for the test environment. No-op if a native one already exists.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket =
    WebSocket as unknown as typeof globalThis.WebSocket;
}
