/**
 * POST /api/auth/sign-up-student
 *
 * Robust, role-aware student signup. Because GoTrue creates the `auth.users` row
 * before app logic can validate, this endpoint OWNS the ordering and cleans up on
 * failure so a rejected/failed signup never leaves an orphan `auth.users` row.
 *
 * Order:
 *   1. Normalize email; look up `class_invites` by (citext) email.
 *        - none                       -> 409 { code: 'no_invite' }
 *        - invites across >1 school_id -> 409 { code: 'ambiguous_school' }
 *   2. Resolve the single school_id from the invite(s).
 *   3. auth.admin.createUser({ email, password, email_confirm: true }).
 *   4. Insert `profiles` (role='student', resolved school_id, email, display_name).
 *      The invite-conversion AFTER-INSERT trigger converts matching invites -> class_members.
 *   5. On ANY failure after step 3, delete the created auth.users row. 201 on success.
 *
 * Process death mid-flow cannot be caught here — the `reconcile-auth` job is
 * the safety net for orphaned auth users.
 *
 * Body: { email, password, displayName }
 */
import { createServiceClient } from "@/lib/auth/serviceClient";
import { jsonError, jsonOk } from "@/lib/auth/http";

interface SignUpBody {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function schoolIdOf(invite: { classes?: unknown }): string | null {
  const c = invite.classes;
  if (!c) return null;
  // PostgREST embeds a to-one relationship as an object, but can surface an array
  // depending on inferred cardinality — handle both.
  if (Array.isArray(c)) {
    const first = c[0] as { school_id?: string } | undefined;
    return first?.school_id ?? null;
  }
  return (c as { school_id?: string }).school_id ?? null;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as SignUpBody | null;
  if (!body) {
    return jsonError("invalid_request", "Request body must be valid JSON.", 400);
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim().length > 0
      ? body.displayName.trim()
      : null;

  if (!email || !password) {
    return jsonError(
      "invalid_request",
      "email and password are required.",
      400
    );
  }
  if (password.length < 6) {
    return jsonError(
      "invalid_request",
      "Password must be at least 6 characters.",
      400
    );
  }

  const service = createServiceClient();

  // 1. Look up invites by email, resolving each invite's school via its class.
  const { data: invites, error: inviteErr } = await service
    .from("class_invites")
    .select("class_id, classes(school_id)")
    .eq("email", email);

  if (inviteErr) {
    return jsonError(
      "signup_failed",
      "Could not verify your invitation. Please try again.",
      500
    );
  }

  if (!invites || invites.length === 0) {
    return jsonError(
      "no_invite",
      "No pending invitation was found for this email address.",
      409
    );
  }

  // 2. Resolve the school; reject if invites span multiple schools.
  const schoolIds = new Set<string>();
  for (const inv of invites) {
    const sid = schoolIdOf(inv as { classes?: unknown });
    if (sid) schoolIds.add(sid);
  }

  if (schoolIds.size === 0) {
    // Invites exist but none resolve to a school (data integrity issue).
    return jsonError(
      "signup_failed",
      "Your invitation could not be linked to a school. Please contact your teacher.",
      500
    );
  }
  if (schoolIds.size > 1) {
    return jsonError(
      "ambiguous_school",
      "Your invitations span multiple schools. Please contact an administrator.",
      409
    );
  }

  const schoolId = [...schoolIds][0];

  // 3. Create the auth user.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  });

  if (createErr || !created?.user) {
    const message = createErr?.message ?? "Could not create the account.";
    // GoTrue surfaces an "already registered" style message for a duplicate email.
    const taken = /already|exists|registered/i.test(message);
    return jsonError(
      taken ? "email_taken" : "signup_failed",
      taken ? "An account already exists for this email address." : message,
      taken ? 409 : 500
    );
  }

  const userId = created.user.id;

  // 4. Insert the profile. The invite-conversion trigger converts invites -> memberships.
  // 5. On ANY failure here, delete the created auth user (no orphan).
  try {
    const { error: profErr } = await service.from("profiles").insert({
      id: userId,
      role: "student",
      school_id: schoolId,
      email,
      display_name: displayName,
    });
    if (profErr) throw profErr;
  } catch {
    await service.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort; the reconcile-auth job is the safety net if this also fails.
    });
    return jsonError(
      "signup_failed",
      "Could not complete signup. Please try again.",
      500
    );
  }

  return jsonOk({ userId }, 201);
}
