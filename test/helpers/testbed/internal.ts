import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, createAnonClient, signInAs } from "../db";

export interface Actor {
  readonly client: SupabaseClient;
}

export const DEFAULT_PASSWORD = "actor-password-123";

export function emailFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${slug}.${rand}@test.orttube.local`;
}

export async function createSignedInClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const client = createAnonClient();
  await signInAs(client, email, password);
  return client as unknown as SupabaseClient;
}

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
