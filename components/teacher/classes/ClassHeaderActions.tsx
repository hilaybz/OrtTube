"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";
import { LANGUAGE_LABELS } from "./labels";

/**
 * Owner controls on the class header: rename / re-language (PATCH), behind a
 * pencil icon.
 *
 * Deleting a class is deliberately absent. A class is a school-level record —
 * its roster is not the teacher's to assemble or dismantle — so the destructive
 * end of its lifecycle belongs to the school/admin path (the DELETE route and
 * its RPC still exist for that), not to a button one click from a teacher's
 * everyday screen.
 */
export function ClassHeaderActions({
  classId,
  name,
  language,
}: {
  classId: string;
  name: string;
  language: Language;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const [draftName, setDraftName] = useState(name);
  const [draftLang, setDraftLang] = useState<Language>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openEdit() {
    setDraftName(name);
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
        body: JSON.stringify({ name: trimmed, language: draftLang }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "עדכון הכיתה נכשל.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconButton
        name="edit"
        label="עריכת הכיתה"
        onClick={openEdit}
        tooltipPlacement="bottom"
      />

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
    </>
  );
}
