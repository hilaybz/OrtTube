"use client";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";

type PreferredLanguage = "he" | "ar" | "en" | null;

interface ProfileView {
  email: string;
  role: "teacher" | "student";
  preferred_language: PreferredLanguage;
}

const ROLE_LABEL: Record<ProfileView["role"], string> = {
  teacher: "מורה",
  student: "תלמיד/ה",
};

// `""` is the "no preference" sentinel used by the <select>; it maps to null.
const LANG_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "ברירת מחדל (לפי הכיתה)" },
  { value: "he", label: "עברית" },
  { value: "ar", label: "ערבית" },
  { value: "en", label: "אנגלית" },
];

type Status = "idle" | "saving" | "saved" | "error";

/**
 * Self-service settings shared by the teacher and student pages: a read-only
 * identity summary (email + role, both immutable) plus the one editable
 * preference — the language a person reads quizzes in. Saving PATCHes
 * `/api/profile`, which persists via the RLS self-update policy.
 */
export function SettingsForm({ profile }: { profile: ProfileView }) {
  const [selected, setSelected] = useState(profile.preferred_language ?? "");
  const [persisted, setPersisted] = useState(profile.preferred_language ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = selected !== persisted;

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const value: PreferredLanguage = selected === "" ? null : (selected as "he" | "ar" | "en");
      const res = await apiFetch<{ preferred_language: PreferredLanguage }>(
        "/api/profile",
        { method: "PATCH", body: JSON.stringify({ preferred_language: value }) }
      );
      setPersisted(res.preferred_language ?? "");
      setStatus("saved");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "אירעה שגיאה. נסו שוב.");
      setStatus("error");
    }
  }

  const busy = status === "saving";

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-[var(--heading)]">אימייל</dt>
          <dd className="text-sm text-[var(--body)]">{profile.email}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-[var(--heading)]">תפקיד</dt>
          <dd className="text-sm text-[var(--body)]">{ROLE_LABEL[profile.role]}</dd>
        </div>
      </dl>

      <Select
        label="שפת תצוגה של החידונים"
        name="preferred_language"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          if (status !== "idle") setStatus("idle");
          setError(null);
        }}
        disabled={busy}
      >
        {LANG_OPTIONS.map((o) => (
          <option key={o.value || "default"} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <p className="text-sm text-[var(--body-subtle)]">
        קובע את השפה שבה יוצגו לך שאלות החידון. ללא בחירה, נעשה שימוש בשפת הכיתה.
      </p>

      {status === "error" && error && <Alert variant="danger">{error}</Alert>}
      {status === "saved" && !dirty && (
        <Alert variant="success">ההעדפה נשמרה.</Alert>
      )}

      <div>
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? <Spinner size={16} /> : null}
          שמירה
        </Button>
      </div>
    </div>
  );
}
