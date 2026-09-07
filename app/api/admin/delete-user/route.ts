import { assertSecret } from "@/lib/jobs/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteUser, LifecycleError } from "@/lib/lifecycle";

/**
 * Guarded by `ADMIN_SECRET` (a separate secret from `CRON_SECRET`, so a leaked
 * cron token cannot delete users). Body: `{ "userId": "<uuid>" }`.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = assertSecret(req, "admin");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_request", "Request body must be valid JSON", 400);
  }

  const userId = (body as { userId?: unknown })?.userId;
  if (typeof userId !== "string" || userId.trim() === "") {
    return jsonError("invalid_request", "Missing or invalid `userId`", 400);
  }

  try {
    const service = createServiceClient();
    const result = await deleteUser(service, userId);

    if (result.status === "must_reassign") {
      return Response.json(
        {
          error: {
            code: "must_reassign",
            message:
              "Teacher owns classes/quizzes; reassign ownership before deleting.",
          },
          details: { classes: result.classes, quizzes: result.quizzes },
        },
        { status: 409 }
      );
    }

    return Response.json(
      { status: "deleted", role: result.role, userId: result.userId },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof LifecycleError) {
      return jsonError(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonError("internal_error", message, 500);
  }
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}
