/**
 * Admin: service-role lifecycle primitives (spec §6.1). Wraps the privileged
 * helpers that run as the service role, not as any actor. Exposed to tests as
 * `testbed.admin`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../db";
import type { Teacher } from "./teacher";
import type { Student } from "./student";

function idOf(x: { id: string } | string): string {
  return typeof x === "string" ? x : x.id;
}

export class Admin {
  /**
   * The hourly sweep backstop (`close_expired_attempt_windows`, service_role
   * only) that force-finalizes attempts nobody came back to interact with
   * after their window closed. Cast to the untyped client — this RPC predates
   * the last `gen:types` run, same reason `lib/quizAuthor.ts`'s `AnyClient`
   * pattern exists.
   */
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

  /** Deactivate a teacher (`deactivate_teacher` RPC + auth ban). Idempotent. */
  async deactivateTeacher(teacher: Teacher | string) {
    const { deactivateTeacher } = await import("@/lib/lifecycle");
    return deactivateTeacher(getServiceClient(), idOf(teacher));
  }

  /** Move every class + quiz from one teacher to another (`reassign_ownership`). */
  async reassignOwnership(opts: {
    from: Teacher | string;
    to: Teacher | string;
  }) {
    const { reassignOwnership } = await import("@/lib/lifecycle");
    return reassignOwnership(getServiceClient(), idOf(opts.from), idOf(opts.to));
  }

  /** Delete a user, branching by role (student → anonymise; teacher → guard). */
  async deleteUser(user: Teacher | Student | string) {
    const { deleteUser } = await import("@/lib/lifecycle");
    return deleteUser(getServiceClient(), idOf(user));
  }

  /** Hard-delete an auth user directly (models the GoTrue admin delete path). */
  async hardDeleteAuthUser(user: Teacher | Student | string): Promise<void> {
    const { error } = await getServiceClient().auth.admin.deleteUser(idOf(user));
    if (error) throw new Error(`deleteUser failed: ${error.message}`);
  }
}
