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
  // Latest-ref, not a dependency: `onClose` is almost always a fresh inline
  // closure from the caller (e.g. `onClose={() => !busy && setOpen(false)}`),
  // so its identity changes on every parent re-render — including a re-render
  // triggered by typing into a controlled input inside this modal. If the
  // effect below depended on `onClose` directly, EVERY keystroke would tear
  // the effect down (running the cleanup's `restoreRef.current?.focus?.()`,
  // yanking focus back to whatever was focused before the modal opened) and
  // re-run it (moving focus to the panel div) — the exact "type one letter,
  // focus vanishes, click back into the field" bug this was causing on every
  // Modal-wrapped form in the app. Reading the latest callback through a ref
  // keeps the effect's identity tied to `open` alone, which is the only thing
  // that should ever re-trigger the open/close focus management.
  const onCloseRef = useRef(onClose);
  // Sync post-render, not during it (writing a ref mid-render is unsafe/
  // disallowed) — an effect with no dependency array runs after every
  // commit, so the ref is always current by the time a real keypress
  // could reach the handler below.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // Trap Tab within the dialog so focus can't reach the page behind it.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open]);

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
