"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";
import { LANGUAGE_LABELS } from "./labels";

/**
 * "כיתה חדשה" action: opens a form modal that creates a class
 * (POST /api/classes) and refreshes the server-rendered list on success.
 */
export function CreateClassButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Language>("he");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("יש להזין שם לכיתה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, language }),
      });
      setOpen(false);
      setName("");
      setLanguage("he");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "יצירת הכיתה נכשלה.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Icon name="class" size={16} />
        כיתה חדשה
      </Button>

      <Modal open={open} onClose={close} title="כיתה חדשה">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <Alert variant="danger" title="לא ניתן ליצור את הכיתה">
              {error}
            </Alert>
          )}
          <Field
            label="שם הכיתה"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="למשל: כיתה ז׳ 1"
            autoFocus
            required
          />
          <Select
            label="שפת הכיתה"
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              ביטול
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner size={16} />}
              יצירה
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
