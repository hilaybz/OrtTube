import { messageForCode } from "@/lib/errors";

export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(messageForCode(code));
    this.name = "ApiError";
  }
}

/**
 * Reads on the server go through `@/lib` directly (RLS), not this helper.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? "internal_error");
  }
  return body as T;
}
