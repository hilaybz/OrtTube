"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
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
      <PasswordField
        label="סיסמה"
        name="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
        {busy ? <Spinner size={18} /> : "התחברות"}
      </Button>
    </form>
  );
}
