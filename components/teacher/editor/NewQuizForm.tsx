"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import { SUPPORTED_LANGUAGES } from "@/lib/lang";
import type { CreatedQuiz } from "./types";
import { LANGUAGE_LABELS } from "./format";

/**
 * Create-a-quiz flow: paste a YouTube URL, pick the base language, optionally
 * name it. POSTs `/api/quizzes` (which upserts the canonical video and creates
 * the quiz), then routes to the editor. Transcript fetching is asynchronous, so
 * the editor surfaces the pending/unavailable status once open.
 */
export function NewQuizForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timeRestricted, setTimeRestricted] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (timeRestricted) {
      const n = Number(durationMinutes);
      if (!Number.isInteger(n) || n < 1) {
        setError("משך הזמן חייב להיות מספר שלם גדול מ־0.");
        return;
      }
    }
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const { quiz } = await apiFetch<{ quiz: CreatedQuiz }>("/api/quizzes", {
        method: "POST",
        body: JSON.stringify({
          youtubeUrl: String(form.get("youtubeUrl") ?? "").trim(),
          baseLanguage: form.get("baseLanguage"),
          title: String(form.get("title") ?? "").trim() || undefined,
          timeRestricted,
          durationMinutes: timeRestricted ? Number(durationMinutes) : undefined,
        }),
      });
      router.push(`/dashboard/quizzes/${quiz.quiz_id}/edit`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "יצירת החידון נכשלה. בדקו את הקישור ונסו שוב."
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass flex flex-col gap-5 p-5">
      {error && <Alert variant="danger">{error}</Alert>}
      <Field
        label="קישור ל-YouTube"
        name="youtubeUrl"
        placeholder="https://www.youtube.com/watch?v=…"
        inputMode="url"
        required
      />
      <Select label="שפת המקור" name="baseLanguage" defaultValue="he">
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_LABELS[l]}
          </option>
        ))}
      </Select>
      <Field label="כותרת (אופציונלי)" name="title" placeholder="שם החידון" />

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--body)]">
          <input
            type="checkbox"
            checked={timeRestricted}
            onChange={(e) => setTimeRestricted(e.target.checked)}
            className="h-4 w-4 rounded-[var(--radius-sm)] border border-[var(--glass-border)] accent-[var(--brand)]"
          />
          הגבלת זמן
        </label>
        {timeRestricted && (
          <Field
            label="משך מוקצב (דקות)"
            name="durationMinutes"
            type="number"
            min={1}
            step={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        )}
        {!timeRestricted && (
          <p className="text-xs text-[var(--body-subtle)]">
            ללא הגבלת זמן, משך החידון יוצג כהערכה המבוססת על אורך הסרטון.
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={busy} className="mt-1 self-start">
        {busy ? <Spinner size={18} /> : "יצירת חידון"}
      </Button>
    </form>
  );
}
