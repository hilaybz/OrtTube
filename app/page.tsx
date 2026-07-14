import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";

export default async function Home() {
  // Signed-in users skip the landing and go straight to their role home.
  const profile = await getMyProfile(await createClient());
  if (profile?.role === "teacher") redirect("/dashboard");
  if (profile?.role === "student") redirect("/student");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/80 bg-white/60 shadow-[var(--glass-shadow)]">
          <Icon name="play" size={26} className="text-[var(--brand)]" />
        </span>
        <span className="text-3xl font-bold tracking-tight">OrtTube</span>
      </div>

      <div className="max-w-2xl">
        <h1 className="mb-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          כל סרטון יוטיוב הופך למבחן אינטראקטיבי
        </h1>
        <p className="text-lg leading-relaxed text-[var(--body)]">
          מורים בונים (או מייצרים ב-AI) שאלות המעוגנות לרגעים בסרטון; תלמידים צופים,
          עונים בכל נקודת עצירה, ושואלים מורה־AI — הכול בעברית, בערבית ובאנגלית.
        </p>
      </div>

      <GlassCard className="w-full max-w-md">
        <div className="flex flex-col gap-3">
          <Link
            href="/sign-in"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--brand)] px-5 py-3 font-medium text-[#06210f] shadow-[var(--shadow-xs),inset_var(--color-1-400)_0_6px_0px_-5px,var(--color-1-700)_0_4px_10px_-5px] transition-colors hover:bg-[var(--brand-strong)]"
          >
            התחברות
            <Icon name="arrow" size={18} />
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-5 py-3 font-medium text-[var(--heading)] transition-colors hover:bg-[var(--glass-bg-hover)]"
          >
            תלמיד/ה שהמורה הוסיף/ה לכיתה? יצירת חשבון
          </Link>
        </div>
      </GlassCard>
    </main>
  );
}
