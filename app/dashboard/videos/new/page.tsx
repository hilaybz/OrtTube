"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { extractVideoId } from "@/lib/youtube";

type Step = "input" | "checking" | "done";

export default function NewVideoPage() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);

    const videoId = extractVideoId(url.trim());
    if (!videoId) {
      setError("Please paste a valid YouTube URL.");
      return;
    }

    setStep("checking");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/sign-in");
        return;
      }

      // Reuse existing row if teacher already added this video
      const { data: existing } = await supabase
        .from("videos")
        .select("id")
        .eq("teacher_id", user.id)
        .eq("youtube_video_id", videoId)
        .maybeSingle();

      let videoRowId: string;

      if (existing) {
        videoRowId = existing.id;
      } else {
        const { data, error: insertError } = await supabase
          .from("videos")
          .insert({ teacher_id: user.id, youtube_video_id: videoId })
          .select("id")
          .single();
        if (insertError) throw insertError;
        videoRowId = data.id;
      }

      // Check transcript (updates status in DB, may take a few seconds)
      await fetch(`/api/videos/${videoRowId}/check-transcript`, {
        method: "POST",
      });

      router.push(`/dashboard/videos/${videoRowId}`);
    } catch (err) {
      setStep("input");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="px-6 py-4 border-b border-gray-800">
        <Link href="/dashboard" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
      </header>

      <main className="max-w-lg mx-auto px-6 py-16">
        {step === "checking" ? (
          <div className="text-center space-y-4">
            <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400">Checking for transcript…</p>
            <p className="text-gray-600 text-sm">This takes a few seconds</p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-white mb-8">Add Video</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="url"
                  className="block text-sm text-gray-400 mb-1.5"
                >
                  YouTube URL
                </label>
                <input
                  id="url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-[#161920] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                  autoFocus
                />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
                >
                  Add Video
                </button>
                <Link
                  href="/dashboard"
                  className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Cancel
                </Link>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
