import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SignInForm } from "./SignInForm";

/**
 * The single signed-out screen. There is no separate marketing landing and no
 * self-signup — the school provisions accounts — so `/` forwards here and this
 * page carries both the brand identity and the login form in one glass panel:
 * identity on the inline-start half, the form on the inline-end half.
 */

/**
 * Terse capability lines under the lockup. Hidden while the panels are stacked
 * so the phone layout opens on the form rather than pushing it below the fold.
 */
const HIGHLIGHTS: { icon: IconName; text: string }[] = [
  { icon: "quiz", text: "שאלות מעוגנות לרגעי הסרטון" },
  { icon: "bot", text: "OrtAI עונה תוך כדי הצפייה" },
  { icon: "chart", text: "תמונת מצב על הכיתה" },
];

export default async function SignInPage() {
  // Someone who is already signed in has no business on a login screen.
  const profile = await getMyProfile(await createClient());
  if (profile?.role === "teacher") redirect("/dashboard");
  if (profile?.role === "student") redirect("/student");

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
      <div className="glass quiz-pop w-full max-w-4xl">
        <div className="grid md:grid-cols-[1.05fr_1fr]">
          {/* Brand half — the lockup dominates, the copy supports it. */}
          <section className="relative flex flex-col justify-center gap-8 bg-[radial-gradient(120%_100%_at_100%_0%,var(--brand-softer),transparent_70%)] px-7 py-8 sm:px-9 sm:py-12">
            <div className="flex items-center gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[var(--radius)] border border-[var(--brand-soft)] bg-[var(--neutral-primary-soft)] shadow-[var(--shadow-xs)] sm:h-[72px] sm:w-[72px]">
                <Icon name="play" size={32} className="text-[var(--brand)]" />
              </span>
              <h1 className="text-[2.5rem] font-bold leading-none tracking-tight sm:text-5xl">
                OrtTube
              </h1>
            </div>

            <p className="max-w-[30ch] text-base leading-relaxed text-[var(--body)]">
              כל סרטון יוטיוב הופך לחידון אינטראקטיבי.
            </p>

            <ul className="hidden flex-col gap-4 md:flex">
              {HIGHLIGHTS.map(({ icon, text }) => (
                <li key={text} className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-full)] bg-[var(--brand-softer)]">
                    <Icon
                      name={icon}
                      size={16}
                      className="text-[var(--fg-brand-strong)]"
                    />
                  </span>
                  <span className="text-sm font-medium text-[var(--body)]">
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Login half — separated by a hairline that follows the writing mode. */}
          <section className="border-t border-[var(--glass-border-subtle)] px-7 py-9 sm:px-9 sm:py-12 md:border-t-0 md:border-s">
            <h2 className="mb-6 text-2xl font-semibold tracking-tight">
              התחברות
            </h2>
            <SignInForm />
            <p className="mt-7 flex items-start gap-2 border-t border-[var(--glass-border-subtle)] pt-5 text-sm leading-relaxed text-[var(--body-subtle)]">
              <Icon name="info" size={16} className="mt-0.5 shrink-0" />
              <span>
                החשבונות נפתחים על ידי בית הספר — לקבלת פרטי התחברות פנו
                למנהל/ת המערכת.
              </span>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
