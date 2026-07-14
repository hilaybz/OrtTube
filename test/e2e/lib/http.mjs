/**
 * Low-level HTTP plumbing for the e2e actor DSL — the fetch/cookie/parsing
 * machinery lifted out of the smoke script so the test itself reads as prose.
 *
 * Nothing here knows about teachers, quizzes, or the API shape; it only moves
 * bytes and cookies. The domain vocabulary lives in `app.mjs`.
 */
import { readFileSync } from "node:fs";

/** Load `.env.local` KEY=VALUE lines into `process.env` (without overriding). */
export function loadEnv(envPath) {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

/**
 * A per-actor cookie jar over global fetch: the sign-in route sets session
 * cookies; subsequent authenticated requests resend them. Each actor owns one so
 * a teacher's session never bleeds into a student's.
 */
export class CookieJar {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }
  capture(res) {
    // Node 20 undici exposes getSetCookie(); fall back to raw header split.
    let cookies = [];
    if (typeof res.headers.getSetCookie === "function") {
      cookies = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get("set-cookie");
      if (raw) cookies = [raw];
    }
    for (const c of cookies) {
      const first = c.split(";")[0];
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const k = first.slice(0, eq).trim();
      const v = first.slice(eq + 1).trim();
      // A cleared cookie (empty value / deleted) is removed from the jar.
      if (v === "" || /expires=Thu, 01 Jan 1970/i.test(c)) this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  header() {
    if (this.jar.size === 0) return undefined;
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  /** Whether any session cookie is currently held. */
  get hasSession() {
    return this.jar.size > 0;
  }
}

/**
 * Perform a request through a cookie jar against `baseUrl`, capturing any
 * Set-Cookie back into the jar. `body` is JSON-encoded automatically. Returns a
 * parsed envelope: `{ status, json, text }` (json is null for non-JSON bodies).
 */
export async function request(baseUrl, jar, path, opts = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const headers = { ...(opts.headers || {}) };
  const cookie = jar.header();
  if (cookie) headers["Cookie"] = cookie;
  let body = opts.body;
  if (body !== undefined && typeof body !== "string") {
    body = JSON.stringify(body);
  }
  if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...opts, body, headers, redirect: "manual" });
  jar.capture(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. a streamed tutor answer) */
  }
  return { status: res.status, json, text };
}
