"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Accepts a bare share code ("a1b2c3") or a full pasted link
// ("https://orttube.app/s/a1b2c3") and extracts the code.
function extractShareCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const linkMatch = trimmed.match(/\/s\/([a-zA-Z0-9_-]+)/);
  if (linkMatch) return linkMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

export default function EnterCodeForm({ collapsible = false }: { collapsible?: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!collapsible);
  const router = useRouter();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        יש לכם קוד שיעור מהמורה? הזינו אותו כאן
      </button>
    );
  }

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const code = extractShareCode(value);
    if (!code) {
      setError("הקוד לא תקין. בדקו את הקישור שקיבלתם מהמורה.");
      return;
    }
    router.push(`/s/${code}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        dir="ltr"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder="קוד שיעור או קישור"
        className="w-full bg-[#0f1117] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm text-center font-mono focus:outline-none focus:border-blue-500 transition-colors"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={!value.trim()}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium py-3 rounded-xl transition-colors"
      >
        לשיעור ←
      </button>
    </form>
  );
}
