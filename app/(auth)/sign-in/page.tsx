import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { SignInForm } from "./SignInForm";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-xl font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/80 bg-white/60">
          <Icon name="play" size={16} className="text-[var(--brand)]" />
        </span>
        OrtTube
      </Link>
      <GlassCard className="w-full p-7">
        <h1 className="mb-1 text-2xl font-bold">התחברות</h1>
        <p className="mb-6 text-sm text-[var(--body)]">
          מורים ותלמידים מתחברים באותו מקום.
        </p>
        <SignInForm />
      </GlassCard>
    </main>
  );
}
