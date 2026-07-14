"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

type ToastVariant = "brand" | "success" | "danger";
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<{
  show: (message: string, variant?: ToastVariant) => void;
} | null>(null);

const VARIANT: Record<ToastVariant, string> = {
  brand: "text-[var(--fg-brand-strong)]",
  success: "text-[var(--fg-success)]",
  danger: "text-[var(--fg-danger)]",
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, variant: ToastVariant = "brand") => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 start-1/2 z-50 flex -translate-x-1/2 flex-col gap-2 rtl:translate-x-1/2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn("glass px-4 py-3 text-sm font-medium", VARIANT[t.variant])}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
