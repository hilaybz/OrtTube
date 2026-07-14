/**
 * Shared plumbing for the actor DSL: the `Actor` contract plus the identity
 * helpers that mint auth users and signed-in (RLS-subject) clients. Not part of
 * the public DSL surface — the actor modules import these; tests do not.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, createAnonClient, signInAs } from "../db";

/** Anyone who carries an authenticated (RLS-subject) client. */
export interface Actor {
  readonly client: SupabaseClient;
}

export const DEFAULT_PASSWORD = "actor-password-123";

/** Deterministic-but-unique email from a person's name, so runs don't collide. */
export function emailFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug}.${rand}@test.orttube.local`;
}

/** An anon client already signed in as the given credentials. */
export async function createSignedInClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createAnonClient();
  await signInAs(client, email, password);
  return client as unknown as SupabaseClient;
}

/** Create a confirmed auth user with a display name; returns its id. */
export async function createAuthUser(
  email: string,
  password: string,
  displayName: string
): Promise<string> {
  const { data, error } = await getServiceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) {
    throw new Error(
      `createAuthUser(${email}) failed: ${error?.message ?? "no user returned"}`
    );
  }
  return data.user.id;
}
