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

// supabase-js constructs a Realtime client (which needs a global WebSocket) even
// when Realtime is unused. Node < 22 has no native WebSocket, so polyfill it from
// the `ws` package for the test environment. No-op if a native one already exists.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket =
    WebSocket as unknown as typeof globalThis.WebSocket;
}
