"use client";

import { useState } from "react";
import type { SavedCheckpoint } from "./VideoEditor";
import { fmtSec, parseMinSec } from "./VideoEditor";

interface Props {
  videoId: string;
  duration: number;
  onDone: (checkpoints: SavedCheckpoint[]) => void;
  onClose: () => void;
}

export default function GenerateModal({ videoId, duration, onDone, onClose }: Props) {
  const [mode, setMode] = useState<"every" | "at_times">("every");
  const [intervalMin, setIntervalMin] = useState("5");
  const [times, setTimes] = useState(["", ""]);
  const [count, setCount] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalSec = Math.max(60, (parseInt(intervalMin) || 5) * 60);
  const everyPositions =
    duration > 0
      ? Array.from(
          { length: Math.floor((duration - 30) / intervalSec) },
          (_, i) => (i + 1) * intervalSec
        ).filter((t) => t < duration - 30)
      : [];

  function addTime() {
    if (times.length < 8) setTimes((t) => [...t, ""]);
  }

  function removeTime(i: number) {
    setTimes((t) => t.filter((_, idx) => idx !== i));
  }

  function setTime(i: number, val: string) {
    setTimes((t) => t.map((v, idx) => (idx === i ? val : v)));
  }

  async function handleGenerate() {
    setError(null);
    setGenerating(true);

    let body: object;
    if (mode === "every") {
      if (!duration) {
        setError("Wait for the video to load first.");
        setGenerating(false);
        return;
      }
      body = {
        mode: "every",
        intervalSeconds: intervalSec,
        totalSeconds: Math.round(duration),
        count,
      };
    } else {
      const positions = times
        .map(parseMinSec)
        .filter((t): t is number => t !== null && t > 0);
      if (positions.length === 0) {
        setError("Enter at least one valid time.");
        setGenerating(false);
        return;
      }
      body = { mode: "at_times", positions, count };
    }

    try {
      const res = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const { checkpoints } = (await res.json()) as {
        checkpoints: SavedCheckpoint[];
      };
      onDone(checkpoints);
    } catch {
      setError("Generation failed. Try again.");
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold">Generate Quizzes</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Mode tabs */}
          <div className="flex bg-[#0f1117] rounded-xl p-1 gap-1">
            {(["every", "at_times"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-sm py-2 rounded-lg transition-colors ${
                  mode === m
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {m === "every" ? "Every X minutes" : "At specific times"}
              </button>
            ))}
          </div>

          {mode === "every" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 shrink-0">Every</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(e.target.value)}
                  className="w-20 bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm text-center focus:outline-none focus:border-blue-500"
                />
                <span className="text-sm text-gray-400">minutes</span>
              </div>
              {duration > 0 && everyPositions.length > 0 ? (
                <p className="text-xs text-gray-500">
                  Will create {everyPositions.length} checkpoint
                  {everyPositions.length !== 1 ? "s" : ""} at:{" "}
                  {everyPositions.slice(0, 6).map(fmtSec).join(", ")}
                  {everyPositions.length > 6 ? "…" : ""}
                </p>
              ) : duration > 0 ? (
                <p className="text-xs text-yellow-600">
                  Interval too large — no checkpoints would be created.
                </p>
              ) : (
                <p className="text-xs text-gray-600">
                  Load the video first to preview checkpoints.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">
                Times (mm:ss)
              </label>
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={t}
                    onChange={(e) => setTime(i, e.target.value)}
                    placeholder="3:24"
                    className="flex-1 bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTime(i)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {times.length < 8 && (
                <button
                  type="button"
                  onClick={addTime}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + Add time
                </button>
              )}
            </div>
          )}

          {/* Questions per checkpoint */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-gray-400 shrink-0">
              Questions per checkpoint
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`w-8 h-8 rounded-lg text-sm transition-colors ${
                    count === n
                      ? "bg-blue-600 text-white"
                      : "bg-[#0f1117] text-gray-400 hover:text-white hover:bg-gray-800"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors flex items-center gap-2"
          >
            {generating ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              "⚡ Generate"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
