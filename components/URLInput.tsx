"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { extractVideoId } from "@/lib/youtube";

export default function URLInput() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const videoId = extractVideoId(url.trim());
    if (!videoId) {
      setError("Please paste a valid YouTube URL");
      return;
    }
    router.push(`/watch/${videoId}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          placeholder="https://www.youtube.com/watch?v=..."
          className="flex-1 bg-[#1c1f26] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-3 rounded-xl transition-colors whitespace-nowrap text-sm"
        >
          Watch
        </button>
      </div>
      {error && <p className="text-red-400 text-sm text-left">{error}</p>}
    </form>
  );
}
