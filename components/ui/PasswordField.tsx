"use client";
import { useState } from "react";
import { Field } from "./Field";
import { IconButton } from "./IconButton";

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
