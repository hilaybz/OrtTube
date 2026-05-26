"use client";

import { useRef, useState } from "react";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import GenerateModal from "./GenerateModal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  ai_generated: boolean;
  order_index: number;
}

export interface SavedCheckpoint {
  id: string;
  position_seconds: number;
  label: string | null;
  order_index: number;
  questions: SavedQuestion[];
}

interface Props {
  video: {
    id: string;
    youtube_video_id: string;
    title: string | null;
    transcript_status: string;
  };
  initialCheckpoints: SavedCheckpoint[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtSec(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function parseMinSec(s: string): number | null {
  const colonMatch = s.trim().match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  const numMatch = s.trim().match(/^\d+$/);
  if (numMatch) return parseInt(s.trim());
  return null;
}

// ─── VideoEditor ──────────────────────────────────────────────────────────────

export default function VideoEditor({ video, initialCheckpoints }: Props) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [checkpoints, setCheckpoints] = useState<SavedCheckpoint[]>(initialCheckpoints);
  const [duration, setDuration] = useState(0);
  const [expandedCpId, setExpandedCpId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [busyCpId, setBusyCpId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasTranscript = video.transcript_status === "ready";
  const sorted = [...checkpoints].sort((a, b) => a.position_seconds - b.position_seconds);

  function onPlayerReady(e: YouTubeEvent) {
    playerRef.current = e.target;
    setDuration(e.target.getDuration());
  }

  async function handleDelete(cpId: string) {
    setError(null);
    const res = await fetch(`/api/checkpoints/${cpId}`, { method: "DELETE" });
    if (!res.ok) { setError("Failed to delete."); return; }
    setCheckpoints((prev) => prev.filter((c) => c.id !== cpId));
    if (expandedCpId === cpId) setExpandedCpId(null);
  }

  async function handleRegenerate(cpId: string) {
    setBusyCpId(cpId);
    setError(null);
    try {
      const res = await fetch(`/api/checkpoints/${cpId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 2 }),
      });
      if (!res.ok) throw new Error();
      const { questions } = (await res.json()) as { questions: SavedQuestion[] };
      setCheckpoints((prev) =>
        prev.map((c) => (c.id === cpId ? { ...c, questions } : c))
      );
    } catch {
      setError("Regeneration failed. Try again.");
    } finally {
      setBusyCpId(null);
    }
  }

  function handleCheckpointsAdded(newCps: SavedCheckpoint[]) {
    setCheckpoints((prev) =>
      [...prev, ...newCps].sort((a, b) => a.position_seconds - b.position_seconds)
    );
    setShowGenerate(false);
  }

  function handleManualAdd(cp: SavedCheckpoint) {
    setCheckpoints((prev) =>
      [...prev, cp].sort((a, b) => a.position_seconds - b.position_seconds)
    );
    setShowAddManual(false);
    setExpandedCpId(cp.id);
  }

  function handleQuestionsChange(cpId: string, questions: SavedQuestion[]) {
    setCheckpoints((prev) =>
      prev.map((c) => (c.id === cpId ? { ...c, questions } : c))
    );
  }

  return (
    <div className="space-y-6">
      {/* Player + timeline */}
      <div className="rounded-xl overflow-hidden border border-gray-800">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <YouTube
            videoId={video.youtube_video_id}
            onReady={onPlayerReady}
            opts={{
              width: "100%",
              height: "100%",
              playerVars: { rel: 0, modestbranding: 1 },
            }}
            className="absolute inset-0 w-full h-full"
            iframeClassName="w-full h-full"
          />
        </div>
        <div className="px-4 py-3 bg-[#161920] border-t border-gray-800">
          <TimelineBar
            checkpoints={sorted}
            duration={duration}
            expandedCpId={expandedCpId}
            onSelect={(id) =>
              setExpandedCpId(expandedCpId === id ? null : id)
            }
          />
        </div>
      </div>

      {/* Quiz controls */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">
            Quizzes
            {checkpoints.length > 0 && (
              <span className="ml-2 text-sm text-gray-500 font-normal">
                ({checkpoints.length})
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddManual((v) => !v)}
              className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Add manually
            </button>
            {hasTranscript && (
              <button
                onClick={() => setShowGenerate(true)}
                className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>⚡</span> Generate
              </button>
            )}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {showAddManual && (
          <AddManualForm
            videoId={video.id}
            onAdd={handleManualAdd}
            onCancel={() => setShowAddManual(false)}
          />
        )}

        {sorted.length === 0 && !showAddManual ? (
          <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
            <p className="text-gray-500 text-sm">No quizzes yet.</p>
            <p className="text-gray-600 text-xs mt-1">
              {hasTranscript
                ? "Generate quizzes automatically or add them manually."
                : "No transcript found — add quizzes manually."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((cp) => (
              <CheckpointRow
                key={cp.id}
                cp={cp}
                expanded={expandedCpId === cp.id}
                busy={busyCpId === cp.id}
                hasTranscript={hasTranscript}
                onToggle={() =>
                  setExpandedCpId(expandedCpId === cp.id ? null : cp.id)
                }
                onDelete={() => handleDelete(cp.id)}
                onRegenerate={() => handleRegenerate(cp.id)}
                onQuestionsChange={(qs) => handleQuestionsChange(cp.id, qs)}
              />
            ))}
          </div>
        )}
      </div>

      {showGenerate && (
        <GenerateModal
          videoId={video.id}
          duration={duration}
          onDone={handleCheckpointsAdded}
          onClose={() => setShowGenerate(false)}
        />
      )}
    </div>
  );
}

// ─── Timeline bar ─────────────────────────────────────────────────────────────

function TimelineBar({
  checkpoints,
  duration,
  expandedCpId,
  onSelect,
}: {
  checkpoints: SavedCheckpoint[];
  duration: number;
  expandedCpId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative h-1.5 bg-gray-700 rounded-full mt-1 mb-2">
      {checkpoints.map((cp) => {
        const pct =
          duration > 0
            ? Math.min(98, (cp.position_seconds / duration) * 100)
            : 0;
        const active = expandedCpId === cp.id;
        return (
          <button
            key={cp.id}
            title={`${fmtSec(cp.position_seconds)} — ${cp.questions.length} Q`}
            style={{ left: `${pct}%` }}
            onClick={() => onSelect(cp.id)}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group z-10"
          >
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ring-2 ring-[#161920] transition-colors ${
                active
                  ? "bg-blue-400 text-white"
                  : "bg-gray-500 text-gray-300 group-hover:bg-blue-500 group-hover:text-white"
              }`}
            >
              {cp.questions.length}
            </div>
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 pointer-events-none">
              {fmtSec(cp.position_seconds)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Add manual checkpoint form ───────────────────────────────────────────────

function AddManualForm({
  videoId,
  onAdd,
  onCancel,
}: {
  videoId: string;
  onAdd: (cp: SavedCheckpoint) => void;
  onCancel: () => void;
}) {
  const [time, setTime] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const seconds = parseMinSec(time);
    if (seconds === null || seconds < 0) {
      setError("Enter a valid time (e.g. 3:24)");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_seconds: seconds, label: label || undefined }),
      });
      if (!res.ok) throw new Error();
      const { checkpoint } = (await res.json()) as { checkpoint: SavedCheckpoint };
      onAdd(checkpoint);
    } catch {
      setError("Failed to create.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 bg-[#161920] border border-gray-700 rounded-xl p-4 space-y-3"
    >
      <p className="text-sm font-medium text-white">Add quiz manually</p>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Time (mm:ss)</label>
          <input
            type="text"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="3:24"
            className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>
        <div className="flex-[2]">
          <label className="block text-xs text-gray-500 mb-1">
            Label (optional)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Mid-video check"
            className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!time.trim() || saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Checkpoint row ───────────────────────────────────────────────────────────

function CheckpointRow({
  cp,
  expanded,
  busy,
  hasTranscript,
  onToggle,
  onDelete,
  onRegenerate,
  onQuestionsChange,
}: {
  cp: SavedCheckpoint;
  expanded: boolean;
  busy: boolean;
  hasTranscript: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onQuestionsChange: (qs: SavedQuestion[]) => void;
}) {
  return (
    <div className="bg-[#161920] border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <span className="text-gray-600 text-xs shrink-0">
            {expanded ? "▼" : "►"}
          </span>
          <span className="text-white text-sm font-mono shrink-0">
            {fmtSec(cp.position_seconds)}
          </span>
          <span className="text-gray-400 text-sm truncate">
            {cp.label ?? `Quiz at ${fmtSec(cp.position_seconds)}`}
          </span>
          <span className="text-xs text-gray-600 shrink-0">
            {cp.questions.length}Q
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {hasTranscript && (
            <button
              onClick={onRegenerate}
              disabled={busy}
              title="Regenerate questions with AI"
              className="p-1.5 text-gray-600 hover:text-blue-400 disabled:opacity-40 transition-colors rounded-lg hover:bg-gray-800 text-sm"
            >
              {busy ? (
                <span className="inline-block w-3.5 h-3.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                "↻"
              )}
            </button>
          )}
          <button
            onClick={onDelete}
            title="Delete checkpoint"
            className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-800 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <QuestionList checkpoint={cp} onQuestionsChange={onQuestionsChange} />
      )}
    </div>
  );
}

// ─── Question list ────────────────────────────────────────────────────────────

function QuestionList({
  checkpoint,
  onQuestionsChange,
}: {
  checkpoint: SavedCheckpoint;
  onQuestionsChange: (qs: SavedQuestion[]) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);

  async function handleDelete(qId: string) {
    const res = await fetch(`/api/questions/${qId}`, { method: "DELETE" });
    if (!res.ok) return;
    onQuestionsChange(checkpoint.questions.filter((q) => q.id !== qId));
  }

  function handleUpdated(updated: SavedQuestion) {
    onQuestionsChange(
      checkpoint.questions.map((q) => (q.id === updated.id ? updated : q))
    );
  }

  function handleAdded(q: SavedQuestion) {
    onQuestionsChange([...checkpoint.questions, q]);
    setShowAddForm(false);
  }

  return (
    <div className="border-t border-gray-800 px-4 py-3 space-y-3">
      {checkpoint.questions.length === 0 && !showAddForm && (
        <p className="text-gray-600 text-xs">No questions yet.</p>
      )}
      {checkpoint.questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          onDelete={() => handleDelete(q.id)}
          onUpdated={handleUpdated}
        />
      ))}
      {showAddForm ? (
        <QuestionForm
          checkpointId={checkpoint.id}
          onSaved={handleAdded}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          + Add question
        </button>
      )}
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

const LETTERS = ["A", "B", "C", "D"];

function QuestionCard({
  question: q,
  index,
  onDelete,
  onUpdated,
}: {
  question: SavedQuestion;
  index: number;
  onDelete: () => void;
  onUpdated: (q: SavedQuestion) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <QuestionForm
        checkpointId={q.id}
        questionId={q.id}
        initialValues={q}
        onSaved={(updated) => {
          onUpdated(updated);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="bg-[#0f1117] rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-white leading-snug">
          <span className="text-gray-600 text-xs mr-1">Q{index + 1}.</span>
          {q.question}
        </p>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-gray-600 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {q.options.map((opt, i) => (
          <div
            key={i}
            className={`text-xs px-2 py-1 rounded ${
              i === q.correct_index
                ? "bg-green-900/30 text-green-400 border border-green-800/50"
                : "text-gray-500"
            }`}
          >
            <span className="font-mono mr-1">{LETTERS[i]}.</span>
            {opt}
          </div>
        ))}
      </div>
      {q.explanation && (
        <p className="text-xs text-gray-600 italic">{q.explanation}</p>
      )}
    </div>
  );
}

// ─── Question form (add or edit) ──────────────────────────────────────────────

function QuestionForm({
  checkpointId,
  questionId,
  initialValues,
  onSaved,
  onCancel,
}: {
  checkpointId: string;
  questionId?: string;
  initialValues?: SavedQuestion;
  onSaved: (q: SavedQuestion) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(initialValues?.question ?? "");
  const [options, setOptions] = useState<string[]>(
    initialValues?.options.length === 4
      ? initialValues.options
      : ["", "", "", ""]
  );
  const [correct, setCorrect] = useState(initialValues?.correct_index ?? 0);
  const [explanation, setExplanation] = useState(
    initialValues?.explanation ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setOption(i: number, val: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)));
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!question.trim() || options.some((o) => !o.trim())) {
      setError("Fill in all fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = questionId
        ? `/api/questions/${questionId}`
        : `/api/checkpoints/${checkpointId}/questions`;
      const res = await fetch(url, {
        method: questionId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          correct_index: correct,
          explanation: explanation || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { question: SavedQuestion };
      onSaved(data.question);
    } catch {
      setError("Failed to save.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#0f1117] border border-gray-700 rounded-lg p-3 space-y-3"
    >
      <div>
        <label className="block text-xs text-gray-500 mb-1">Question</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What is…?"
          className="w-full bg-[#161920] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCorrect(i)}
              title={`Mark ${LETTERS[i]} as correct`}
              className={`shrink-0 w-5 h-5 rounded-full border text-[10px] font-mono transition-colors ${
                correct === i
                  ? "border-green-500 bg-green-500/20 text-green-400"
                  : "border-gray-600 text-gray-600 hover:border-gray-400"
              }`}
            >
              {LETTERS[i]}
            </button>
            <input
              type="text"
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${LETTERS[i]}`}
              className="flex-1 min-w-0 bg-[#161920] border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Explanation (optional)
        </label>
        <input
          type="text"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          className="w-full bg-[#161920] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : questionId ? "Save changes" : "Add question"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
