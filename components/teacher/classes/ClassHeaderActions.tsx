"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";
import { SUPPORTED_SUBJECTS, type Subject } from "@/lib/subjects";
import { LANGUAGE_LABELS, SUBJECT_LABELS } from "./labels";

/**
 * Owner controls on the class header: edit name / subject / language (PATCH) and
 * delete (DELETE, behind a confirmation). A successful edit refreshes the server
 * page; a successful delete returns to the classes index.
 */
export function ClassHeaderActions({
  classId,
  name,
  subject,
  language,
}: {
  classId: string;
  name: string;
  subject: Subject;
  language: Language;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [draftName, setDraftName] = useState(name);
  const [draftSubject, setDraftSubject] = useState<Subject>(subject);
  const [draftLang, setDraftLang] = useState<Language>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openEdit() {
    setDraftName(name);
    setDraftSubject(subject);
    setDraftLang(language);
    setError("");
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError("יש להזין שם לכיתה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/classes/${classId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: trimmed,
          subject: draftSubject,
          language: draftLang,
        }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "עדכון הכיתה נכשל.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/classes/${classId}`, { method: "DELETE" });
      router.push("/dashboard/classes");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "מחיקת הכיתה נכשלה.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" onClick={openEdit}>
          עריכה
        </Button>
        <Button
          variant="ghost"
          className="text-[var(--fg-danger)]"
          onClick={() => {
            setError("");
            setConfirming(true);
          }}
        >
          מחיקה
        </Button>
      </div>

      <Modal
        open={editing}
        onClose={() => !busy && setEditing(false)}
        title="עריכת כיתה"
      >
        <form onSubmit={saveEdit} className="flex flex-col gap-4">
          {error && (
            <Alert variant="danger" title="לא ניתן לעדכן">
              {error}
            </Alert>
          )}
          <Field
            label="שם הכיתה"
            name="name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
            required
          />
          <Select
            label="מקצוע"
            name="subject"
            value={draftSubject}
            onChange={(e) => setDraftSubject(e.target.value as Subject)}
          >
            {SUPPORTED_SUBJECTS.map((sub) => (
              <option key={sub} value={sub}>
                {SUBJECT_LABELS[sub]}
              </option>
            ))}
          </Select>
          <Select
            label="שפת הכיתה"
            name="language"
            value={draftLang}
            onChange={(e) => setDraftLang(e.target.value as Language)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner size={16} />}
              שמירה
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title="מחיקת כיתה"
      >
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="danger" title="לא ניתן למחוק">
              {error}
            </Alert>
          )}
          <p className="text-[var(--body)]">
            למחוק את הכיתה &rdquo;{name}&ldquo;? הפעולה תסיר את רשימת התלמידים,
            ההזמנות הממתינות והקצאות החידונים בכיתה. לא ניתן לבטל את הפעולה.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={confirmDelete}
              disabled={busy}
            >
              {busy && <Spinner size={16} />}
              מחיקה
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
