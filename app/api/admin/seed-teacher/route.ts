/**
 * POST /api/admin/seed-teacher
 *
 * Teacher provisioning. Guarded by ADMIN_SECRET (separate from CRON_SECRET).
 * Creates a teacher auth user + profile, resolving/creating the school. Teachers
 * are onboarded by an administrator through this endpoint; there is no teacher
 * self-signup.
 *
 * Body: { email, password, displayName, schoolId?, schoolName? }
 *   - schoolId given         -> use it.
 *   - schoolName given (no id) -> find a school by name, else create one.
 *   - neither                -> 400.
 *
 * Same delete-on-failure cleanup as student signup: if the profile insert fails,
 * the created auth user is removed. Returns 201 { userId, schoolId }.
 */
import { createServiceClient } from "@/lib/auth/serviceClient";
import { assertAdminSecret } from "@/lib/auth/adminSecret";
import { jsonError, jsonOk } from "@/lib/auth/http";
import type { SupabaseClient } from "@supabase/supabase-js";

interface SeedBody {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  schoolId?: unknown;
  schoolName?: unknown;
}

async function resolveSchoolId(
  service: SupabaseClient,
  schoolId: string | null,
  schoolName: string | null
): Promise<{ ok: true; schoolId: string } | { ok: false; message: string }> {
  if (schoolId) {
    const { data, error } = await service
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .maybeSingle();
    if (error) return { ok: false, message: "Could not verify the school." };
    if (!data) return { ok: false, message: "The given schoolId does not exist." };
    return { ok: true, schoolId: data.id };
  }

  if (schoolName) {
    const { data: existing, error: findErr } = await service
      .from("schools")
      .select("id")
      .eq("name", schoolName)
      .limit(1)
      .maybeSingle();
    if (findErr) return { ok: false, message: "Could not look up the school." };
    if (existing) return { ok: true, schoolId: existing.id };

    const { data: inserted, error: insErr } = await service
      .from("schools")
      .insert({ name: schoolName })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return { ok: false, message: "Could not create the school." };
    }
    return { ok: true, schoolId: inserted.id };
  }

  return { ok: false, message: "Either schoolId or schoolName is required." };
}

export async function POST(req: Request): Promise<Response> {
  const denied = assertAdminSecret(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as SeedBody | null;
  if (!body) {
    return jsonError("invalid_request", "Request body must be valid JSON.", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim().length > 0
      ? body.displayName.trim()
      : null;
  const schoolId =
    typeof body.schoolId === "string" && body.schoolId.trim().length > 0
      ? body.schoolId.trim()
      : null;
  const schoolName =
    typeof body.schoolName === "string" && body.schoolName.trim().length > 0
      ? body.schoolName.trim()
      : null;

  if (!email || !password) {
    return jsonError("invalid_request", "email and password are required.", 400);
  }
  if (password.length < 6) {
    return jsonError("invalid_request", "Password must be at least 6 characters.", 400);
  }
  if (!schoolId && !schoolName) {
    return jsonError("invalid_request", "Either schoolId or schoolName is required.", 400);
  }

  const service = createServiceClient();

  // Resolve (or create) the school first.
  const school = await resolveSchoolId(service, schoolId, schoolName);
  if (!school.ok) {
    return jsonError("school_not_found", school.message, 400);
  }
  const resolvedSchoolId = school.schoolId;

  // Create the auth user.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  });

  if (createErr || !created?.user) {
    const message = createErr?.message ?? "Could not create the account.";
    const taken = /already|exists|registered/i.test(message);
    return jsonError(
      taken ? "email_taken" : "seed_failed",
      taken ? "An account already exists for this email address." : message,
      taken ? 409 : 500
    );
  }

  const userId = created.user.id;

  // Insert the teacher profile; delete-on-failure cleanup.
  try {
    const { error: profErr } = await service.from("profiles").insert({
      id: userId,
      role: "teacher",
      school_id: resolvedSchoolId,
      email,
      display_name: displayName,
    });
    if (profErr) throw profErr;
  } catch {
    await service.auth.admin.deleteUser(userId).catch(() => {});
    return jsonError("seed_failed", "Could not create the teacher profile.", 500);
  }

  return jsonOk({ userId, schoolId: resolvedSchoolId }, 201);
}
