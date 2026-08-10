"use client";
import { useState } from "react";
import { Field } from "./Field";

/**
 * Password input with a show/hide toggle.
 *
 * Typing a password blind is the usual cause of a failed sign-in, so both auth
 * forms use this rather than a bare `type="password"` field. The toggle is a
 * `type="button"` so it can never submit the form it sits inside, and its
 * `aria-label` reflects the action it will perform.
 */
export function PasswordField({
  label,
  name,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  name: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Field
      {...props}
      label={label}
      name={name}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "הסתר סיסמה" : "הצג סיסמה"}
          aria-pressed={visible}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--body)] hover:bg-[var(--neutral-quaternary)] hover:text-[var(--heading)]"
        >
          {visible ? "הסתר" : "הצג"}
        </button>
      }
    />
  );
}
