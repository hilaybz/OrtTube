import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { Alert } from "@/components/ui/Alert";
import { StudentSignUpForm } from "./StudentSignUpForm";

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2 text-xl font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/80 bg-white/60">
          <Icon name="play" size={16} className="text-[var(--brand)]" />
        </span>
        OrtTube
      </Link>
      <GlassCard className="w-full p-7">
        <h1 className="mb-1 text-2xl font-bold">הצטרפות כתלמיד/ה</h1>
        <p className="mb-5 text-sm text-[var(--body)]">
          ההרשמה פתוחה רק לתלמידים שהמורה כבר הוסיף/ה לכיתה. הירשמו עם אותו אימייל
          שהמורה הזין/ה עבורכם — כך תצורפו לכיתה אוטומטית.
        </p>
        <Alert variant="brand" className="mb-5">
          מורים אינם נרשמים כאן — חשבון מורה נפתח על ידי מנהל/ת המערכת.
        </Alert>
        <StudentSignUpForm />
      </GlassCard>
    </main>
  );
}
