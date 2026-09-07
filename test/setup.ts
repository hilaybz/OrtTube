import { config } from "dotenv";
import { resolve } from "node:path";
import WebSocket from "ws";

config({ path: resolve(process.cwd(), ".env.local") });

delete process.env.YOUTUBE_PROXY_URLS;

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket =
    WebSocket as unknown as typeof globalThis.WebSocket;
}
