"use client";
import { useId } from "react";
import { cn } from "./cn";

/**
 * Labelled text input (per inputs.md): glass surface, 1px glass border. Label is
 * always associated via generated id/htmlFor; error renders an
 * `aria-describedby` message and flips the border to danger.
 *
 * The focused look is not declared here: a browser matches `:focus-visible` on a
 * text input even for a plain click, so a brand border and ring meant an
 * emphatic green box around a field the user had merely clicked into. The quiet
 * border shift in `app/globals.css` covers every input in the app instead. An
 * error keeps its own danger border and ring — that one has to stay loud.
 */
export function Field({
  label,
  name,
  error,
  className,
  trailing,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  /** Control pinned inside the input's trailing edge (e.g. a show-password toggle). */
  trailing?: React.ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const input = (
    <input
      id={id}
      name={name}
      aria-invalid={!!error}
      aria-describedby={error ? errId : undefined}
      className={cn(
        "rounded-[var(--radius)] bg-[var(--glass-bg)] px-3 py-2.5 text-sm text-[var(--heading)]",
        "border outline-none backdrop-blur-[20px] transition-colors placeholder:text-[var(--body)]",
        error
          ? "border-[var(--fg-danger)] focus:ring-1 focus:ring-[var(--fg-danger)]"
          : "border-[var(--glass-border)]",
        // Only reserve room for the control when there is one, so fields without
        // `trailing` keep exactly the padding and width they had before.
        trailing ? "w-full pe-16" : undefined,
        className
      )}
      {...props}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-[var(--heading)]">
        {label}
      </label>
      {trailing ? (
        <div className="relative flex">
          {input}
          <span className="absolute inset-y-0 end-0 flex items-center pe-1.5">
            {trailing}
          </span>
        </div>
      ) : (
        input
      )}
      {error && (
        <p id={errId} className="text-sm text-[var(--fg-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
