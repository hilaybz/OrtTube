"use client";
import { useState } from "react";
import { Field } from "./Field";
import { IconButton } from "./IconButton";

/**
 * Password input with a show/hide toggle.
 *
 * Typing a password blind is the usual cause of a failed sign-in, so the auth
 * form uses this rather than a bare `type="password"` field. The toggle is the
 * conventional eye / eye-with-slash icon (an `IconButton`, hence `type="button"`
 * — it can never submit the form it sits inside), and its accessible name states
 * the action it will perform rather than the current state.
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
        <IconButton
          name={visible ? "eyeOff" : "eye"}
          label={visible ? "הסתר סיסמה" : "הצג סיסמה"}
          size="sm"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        />
      }
    />
  );
}
