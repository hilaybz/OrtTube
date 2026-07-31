"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Spinner";
import { apiFetch, ApiError } from "@/lib/http";
import type { ClassRoster } from "@/lib/classes";
import { formatDate } from "./labels";

const HEAD_CELL =
  "whitespace-nowrap px-4 py-3 text-start text-sm font-medium text-[var(--body)]";
const BODY_CELL = "px-4 py-4 text-sm";

/**
 * Class roster management: add a student by email, list current members (with
 * un-enroll), and list pending invites (with revoke). All mutations go through
 * `apiFetch` and `router.refresh()` to re-pull the server-rendered roster.
 */
export function RosterSection({
  classId,
  roster,
}: {
  classId: string;
  roster: ClassRoster;
}) {
  const router = useRouter();
  const { members, invites } = roster;

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addNotice, setAddNotice] = useState<
    { variant: "success" | "brand"; text: string } | null
  >(null);

  // Per-row pending id so only the acted-on button shows a spinner.
  const [pending, setPending] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setAddError("יש להזין כתובת אימייל.");
      return;
    }
    setAdding(true);
    setAddError("");
    setAddNotice(null);
    try {
      const result = await apiFetch<
        { status: "added"; student_id: string } | { status: "invited"; email: string }
      >(`/api/classes/${classId}/students`, {
        method: "POST",
        body: JSON.stringify({ email: trimmed }),
      });
      setEmail("");
      if (result.status === "added") {
        setAddNotice({ variant: "success", text: "התלמיד/ה צורף/ה לכיתה." });
      } else {
        setAddNotice({
          variant: "brand",
          text: `נשלחה הזמנה ל־${result.email}. התלמיד/ה יצורף/תצורף אוטומטית עם ההרשמה.`,
        });
      }
      router.refresh();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "הוספת התלמיד/ה נכשלה.");
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(studentId: string) {
    setPending(studentId);
    setRowError("");
    try {
      await apiFetch(`/api/classes/${classId}/students/${studentId}`, {
        method: "DELETE",
      });
      router.refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "הסרת התלמיד/ה נכשלה.");
    } finally {
      setPending(null);
    }
  }

  async function revoke(inviteEmail: string) {
    setPending(inviteEmail);
    setRowError("");
    try {
      await apiFetch(
        `/api/classes/${classId}/invites?email=${encodeURIComponent(inviteEmail)}`,
        { method: "DELETE" }
      );
      router.refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "ביטול ההזמנה נכשל.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Add student */}
      <section className="glass p-5">
        <h3 className="mb-1 text-lg font-semibold text-[var(--heading)]">
          הוספת תלמיד/ה
        </h3>
        <p className="mb-4 text-sm text-[var(--body)]">
          תלמיד/ה מאותו בית ספר יצורף/תצורף מיד; אחרת תישלח הזמנה שתמומש עם ההרשמה.
        </p>
        <form onSubmit={addStudent} className="flex flex-col gap-3">
          {addError && (
            <Alert variant="danger" title="לא ניתן להוסיף">
              {addError}
            </Alert>
          )}
          {addNotice && (
            <Alert variant={addNotice.variant}>{addNotice.text}</Alert>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="אימייל התלמיד/ה"
                name="email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@example.com"
              />
            </div>
            <Button type="submit" disabled={adding}>
              {adding && <Spinner size={16} />}
              הוספה
            </Button>
          </div>
        </form>
      </section>

      {rowError && (
        <Alert variant="danger" title="שגיאה">
          {rowError}
        </Alert>
      )}

      {/* Members */}
      <section className="glass">
        <div className="flex items-center justify-between px-5 pt-5">
          <h3 className="text-lg font-semibold text-[var(--heading)]">תלמידים</h3>
          <Badge variant="gray">
            <span className="tabular-nums">{members.length}</span>
          </Badge>
        </div>
        {members.length === 0 ? (
          <p className="px-5 pb-5 pt-3 text-sm text-[var(--body)]">
            עדיין אין תלמידים בכיתה. הוסיפו תלמיד/ה לפי אימייל.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">רשימת התלמידים בכיתה</caption>
              <thead>
                <tr className="border-b border-[var(--glass-border-subtle)]">
                  <th scope="col" className={HEAD_CELL}>
                    תלמיד/ה
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    צורף/ה בתאריך
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    <span className="sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => {
                  const last = i === members.length - 1;
                  const busy = pending === m.student_id;
                  return (
                    <tr
                      key={m.student_id}
                      className={
                        last ? "" : "border-b border-[var(--glass-border-subtle)]"
                      }
                    >
                      <th scope="row" className={`${BODY_CELL} text-start`}>
                        <span className="flex items-center gap-3">
                          <Avatar name={m.display_name ?? m.email} size={36} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium text-[var(--heading)]">
                              {m.display_name ?? m.email}
                            </span>
                            {m.display_name && (
                              <span className="truncate text-xs font-normal text-[var(--body-subtle)]">
                                {m.email}
                              </span>
                            )}
                          </span>
                        </span>
                      </th>
                      <td
                        className={`${BODY_CELL} whitespace-nowrap tabular-nums text-[var(--body)]`}
                      >
                        {formatDate(m.joined_at)}
                      </td>
                      <td className={`${BODY_CELL} text-end`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[var(--fg-danger)]"
                          disabled={busy}
                          onClick={() => removeMember(m.student_id)}
                        >
                          {busy ? <Spinner size={16} /> : "הסרה"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="glass p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--heading)]">
              הזמנות ממתינות
            </h3>
            <Badge variant="warning">
              <span className="tabular-nums">{invites.length}</span>
            </Badge>
          </div>
          <ul className="flex flex-col gap-2">
            {invites.map((inv) => {
              const busy = pending === inv.email;
              return (
                <li
                  key={inv.email}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--glass-border-subtle)] px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-[var(--heading)]">
                      {inv.email}
                    </span>
                    <span className="text-xs tabular-nums text-[var(--body-subtle)]">
                      הוזמן/ה {formatDate(inv.created_at)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[var(--fg-danger)]"
                    disabled={busy}
                    onClick={() => revoke(inv.email)}
                  >
                    {busy ? <Spinner size={16} /> : "ביטול הזמנה"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
