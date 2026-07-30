import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { GlassCard } from "@/components/ui/GlassCard";
import { Alert } from "@/components/ui/Alert";
import { SettingsForm } from "@/components/teacher/library/SettingsForm";

export default async function TeacherSettingsPage() {
  let profile;
  try {
    const client = (await createClient()) as unknown as SupabaseClient;
    profile = await getMyProfile(client);
  } catch {
    profile = null;
  }

  return (
    <div className="mx-auto max-w-2xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">הגדרות</h1>
      <p className="mb-6 text-[var(--body)]">ניהול החשבון וההעדפות שלך.</p>
      {profile ? (
        <GlassCard as="section">
          <SettingsForm
            profile={{
              email: profile.email,
              role: profile.role,
              preferred_language: profile.preferred_language,
            }}
          />
        </GlassCard>
      ) : (
        <Alert variant="danger">לא ניתן לטעון את ההגדרות. נסו לרענן.</Alert>
      )}
    </div>
  );
}
