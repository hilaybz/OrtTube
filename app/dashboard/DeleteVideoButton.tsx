"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteVideoButton({ videoId }: { videoId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
        <span className="text-xs text-gray-400">Delete?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
        >
          {deleting ? "…" : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); setConfirming(true); }}
      title="Delete video"
      className="shrink-0 p-1.5 text-gray-700 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-800 opacity-0 group-hover:opacity-100"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    </button>
  );
}
