"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const { route } = await apiFetch<{ route: string; role: string }>(
        "/api/auth/sign-in",
        {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
          }),
        }
      );
      router.push(route);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "אירעה שגיאה. נסו שוב.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      <Field label="אימייל" name="email" type="email" autoComplete="email" required />
      <Field
        label="סיסמה"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
        {busy ? <Spinner size={18} /> : "התחברות"}
      </Button>
      <p className="text-center text-sm text-[var(--body)]">
        תלמיד/ה שהמורה הוסיף/ה לכיתה?{" "}
        <Link href="/sign-up" className="font-medium text-[var(--fg-brand)] underline">
          יצירת חשבון
        </Link>
      </p>
    </form>
  );
}
