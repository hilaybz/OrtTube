"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";

export function StudentSignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    try {
      // 1. Create the (invite-gated) student account.
      await apiFetch("/api/auth/sign-up-student", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          displayName: form.get("displayName"),
        }),
      });
      // 2. Sign-up does not set a session; sign in to establish it, then route.
      const { route } = await apiFetch<{ route: string }>("/api/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
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
      <Field label="שם מלא" name="displayName" autoComplete="name" required />
      <Field label="אימייל" name="email" type="email" autoComplete="email" required />
      <Field
        label="סיסמה (6 תווים לפחות)"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={6}
        required
      />
      <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
        {busy ? <Spinner size={18} /> : "יצירת חשבון"}
      </Button>
      <p className="text-center text-sm text-[var(--body)]">
        כבר יש לך חשבון?{" "}
        <Link href="/sign-in" className="font-medium text-[var(--fg-brand)] underline">
          התחברות
        </Link>
      </p>
    </form>
  );
}
