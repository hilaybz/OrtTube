"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { Icon } from "./Icon";

/**
 * Glass dialog (per modals.md). Fixed backdrop (blur 8px), glass content,
 * Escape + backdrop-click close, focus moved inside on open and restored on
 * close. `role="dialog" aria-modal`.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4 backdrop-blur-[8px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn("glass w-full max-w-lg p-5 outline-none", className)}
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border-subtle)] pb-4">
          <h2 className="text-lg font-semibold text-[var(--heading)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--body)] hover:bg-[var(--neutral-quaternary)]"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="pt-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
