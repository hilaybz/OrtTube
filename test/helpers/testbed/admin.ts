import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../db";
import type { Teacher } from "./teacher";
import type { Student } from "./student";

function idOf(x: { id: string } | string): string {
  return typeof x === "string" ? x : x.id;
}

export class Admin {
  async closeExpiredAttemptWindows(batchLimit = 500): Promise<{ closed: number }> {
    const client = getServiceClient() as unknown as SupabaseClient;
    const { data, error } = await client.rpc("close_expired_attempt_windows", {
      p_batch_limit: batchLimit,
    });
    if (error) {
      throw new Error(`close_expired_attempt_windows failed: ${error.message}`);
    }
    return data as { closed: number };
  }

  async deactivateTeacher(teacher: Teacher | string) {
    const { deactivateTeacher } = await import("@/lib/lifecycle");
    return deactivateTeacher(getServiceClient(), idOf(teacher));
  }

  async reassignOwnership(opts: {
    from: Teacher | string;
    to: Teacher | string;
  }) {
    const { reassignOwnership } = await import("@/lib/lifecycle");
    return reassignOwnership(getServiceClient(), idOf(opts.from), idOf(opts.to));
  }

  async deleteUser(user: Teacher | Student | string) {
    const { deleteUser } = await import("@/lib/lifecycle");
    return deleteUser(getServiceClient(), idOf(user));
  }

  async hardDeleteAuthUser(user: Teacher | Student | string): Promise<void> {
    const { error } = await getServiceClient().auth.admin.deleteUser(idOf(user));
    if (error) throw new Error(`deleteUser failed: ${error.message}`);
  }
}
