"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import YouTube, { type YouTubeEvent, type YouTubePlayer } from "react-youtube";
import GenerateModal from "./GenerateModal";
import Timeline from "./Timeline";
import {
  fmtSec,
  parseMinSec,
  type SavedCheckpoint,
  type SavedQuestion,
} from "./shared";

interface Props {
  video: {
    id: string;
    youtube_video_id: string;
    title: string | null;
    transcript_status: string;
  };
  initialCheckpoints: SavedCheckpoint[];
}

const PLAYHEAD_POLL_MS = 500;

// ─── VideoEditor ──────────────────────────────────────────────────────────────

export default function VideoEditor({ video, initialCheckpoints }: Props) {
  const router = useRouter();
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [checkpoints, setCheckpoints] = useState<SavedCheckpoint[]>(initialCheckpoints);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [expandedCpId, setExpandedCpId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [busyCpId, setBusyCpId] = useState<string | null>(null);
  const [addingAtTime, setAddingAtTime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNoTranscriptGate, setShowNoTranscriptGate] = useState(
    video.transcript_status === "unavailable"
  );
  const [deleting, setDeleting] = useState(false);

  const hasTranscript = video.transcript_status === "ready";
  const sorted = [...checkpoints].sort((a, b) => a.position_seconds - b.position_seconds);

  useEffect(() => {
    const tick = setInterval(() => {
      const t = playerRef.current?.getCurrentTime?.();
      if (typeof t === "number" && Number.isFinite(t)) setCurrentTime(t);
    }, PLAYHEAD_POLL_MS);
    return () => clearInterval(tick);
  }, []);

  async function handleDeleteVideo() {
    setDeleting(true);
    const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setDeleting(false);
      setError("מחיקת הסרטון נכשלה.");
    }
  }

  if (showNoTranscriptGate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
        <div className="w-full max-w-md bg-[#161920] border border-gray-700 rounded-2xl shadow-2xl overflow-hidden animate-modal-in">
          <div className="px-6 py-5 border-b border-gray-700 flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 flex items-center justify-center text-base">
              !
            </span>
            <h3 className="text-white font-semibold">לא נמצא תמלול</h3>
          </div>
          <div className="px-6 py-5 space-y-3 text-sm text-gray-300 leading-relaxed">
            <p>לא מצאנו תמלול לסרטון הזה. תכונות ה-AI לא יעבדו עבורו:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 text-xs">
              <li>לא ניתן ליצור שאלות אוטומטית</li>
              <li>לא ניתן ליצור שאלות מחדש</li>
              <li>למורה ה-AI של התלמידים לא יהיה הקשר</li>
            </ul>
            <p>
              עדיין אפשר להוסיף שאלות ידנית, או למחוק את הסרטון ולנסות סרטון
              אחר.
            </p>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700">
            <button
              onClick={handleDeleteVideo}
              disabled={deleting}
              className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors px-3 py-2"
            >
              {deleting ? "מוחק…" : "מחיקת הסרטון"}
            </button>
            <button
              onClick={() => setShowNoTranscriptGate(false)}
              disabled={deleting}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
            >
              אישור והמשך
            </button>
          </div>
          {error && (
            <p className="text-red-400 text-xs px-6 pb-3">{error}</p>
          )}
        </div>
      </div>
    );
  }

  function onPlayerReady(e: YouTubeEvent) {
    playerRef.current = e.target;
    setDuration(e.target.getDuration());
  }

  function seekTo(seconds: number) {
    playerRef.current?.seekTo(seconds, true);
    setCurrentTime(seconds);
  }

  async function handleDelete(cpId: string) {
    setError(null);
    const res = await fetch(`/api/checkpoints/${cpId}`, { method: "DELETE" });
    if (!res.ok) { setError("המחיקה נכשלה."); return; }
    setCheckpoints((prev) => prev.filter((c) => c.id !== cpId));
    if (expandedCpId === cpId) setExpandedCpId(null);
  }

  async function handleMove(cpId: string, seconds: number) {
    setError(null);
    const previous = checkpoints;
    setCheckpoints((prev) =>
      prev.map((c) => (c.id === cpId ? { ...c, position_seconds: seconds } : c))
    );
    const res = await fetch(`/api/checkpoints/${cpId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position_seconds: seconds }),
    });
    if (!res.ok) {
      setCheckpoints(previous);
      setError("הזזת השאלה נכשלה. נסו שוב.");
    }
  }

  async function handleAddAtCurrentTime() {
    setAddingAtTime(true);
    setError(null);
    try {
      const seconds = Math.floor(currentTime);
      const res = await fetch(`/api/videos/${video.id}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_seconds: seconds }),
      });
      if (!res.ok) throw new Error();
      const { checkpoint } = (await res.json()) as { checkpoint: SavedCheckpoint };
      setCheckpoints((prev) => [...prev, checkpoint]);
      setExpandedCpId(checkpoint.id);
    } catch {
      setError("הוספת השאלה נכשלה.");
    } finally {
      setAddingAtTime(false);
    }
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
      setError("יצירת השאלות מחדש נכשלה. נסו שוב.");
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
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Left: player + timeline + actions (sticky on desktop) */}
      <div className="w-full lg:w-[55%] lg:sticky lg:top-6 space-y-4">
        <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#161920]">
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
          <div className="px-4 pt-1 pb-2 border-t border-gray-800">
            <Timeline
              checkpoints={sorted}
              duration={duration}
              selectedCpId={expandedCpId}
              currentTime={currentTime}
              onSelect={(id) => setExpandedCpId(id)}
              onSeek={seekTo}
              onMove={handleMove}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasTranscript && (
            <button
              onClick={() => setShowGenerate(true)}
              className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <span>⚡</span> יצירה אוטומטית
            </button>
          )}
          <button
            onClick={handleAddAtCurrentTime}
            disabled={addingAtTime || duration === 0}
            className="text-sm text-white bg-gray-700/60 hover:bg-gray-600/60 disabled:opacity-50 border border-gray-700 px-3 py-2 rounded-lg transition-colors"
          >
            {addingAtTime
              ? "מוסיף…"
              : `+ שאלה ב-${fmtSec(Math.floor(currentTime))}`}
          </button>
          <button
            onClick={() => setShowAddManual((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-2 transition-colors"
          >
            או הזנת זמן ידנית
          </button>
        </div>

        {showAddManual && (
          <AddManualForm
            videoId={video.id}
            onAdd={handleManualAdd}
            onCancel={() => setShowAddManual(false)}
          />
        )}

        <p className="text-xs text-gray-600">
          טיפ: גררו סמן על ציר הזמן כדי להזיז שאלה. לחיצה על הציר מקפיצה את
          הסרטון לאותה נקודה.
        </p>
      </div>

      {/* Right: quiz list */}
      <div className="w-full lg:flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">
            שאלות
            {checkpoints.length > 0 && (
              <span className="ms-2 text-sm text-gray-500 font-normal">
                ({checkpoints.length})
              </span>
            )}
          </h3>
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {sorted.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
            <p className="text-gray-500 text-sm">עדיין אין שאלות.</p>
            <p className="text-gray-600 text-xs mt-1">
              {hasTranscript
                ? "צרו שאלות אוטומטית, או עצרו את הסרטון והוסיפו שאלה בנקודה הנוכחית."
                : "לא נמצא תמלול — עצרו את הסרטון והוסיפו שאלות ידנית."}
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
                onToggle={() => {
                  const opening = expandedCpId !== cp.id;
                  setExpandedCpId(opening ? cp.id : null);
                  if (opening) seekTo(cp.position_seconds);
                }}
                onDelete={() => handleDelete(cp.id)}
                onRegenerate={() => handleRegenerate(cp.id)}
                onMoveTime={(sec) => handleMove(cp.id, sec)}
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
      setError("הזינו זמן תקין (למשל 3:24)");
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
      setError("היצירה נכשלה.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#161920] border border-gray-700 rounded-xl p-4 space-y-3"
    >
      <p className="text-sm font-medium text-white">הוספת שאלות ידנית</p>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">זמן (דקות:שניות)</label>
          <input
            type="text"
            dir="ltr"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="3:24"
            className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>
        <div className="flex-[2]">
          <label className="block text-xs text-gray-500 mb-1">
            כותרת (לא חובה)
          </label>
          <input
            type="text"
            dir="auto"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="בדיקת אמצע שיעור"
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
          {saving ? "יוצר…" : "יצירה"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}

// ─── Editable time chip ───────────────────────────────────────────────────────

function TimeChip({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (sec: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    const parsed = parseMinSec(value);
    if (parsed !== null && parsed >= 0 && parsed !== seconds) onChange(parsed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        type="text"
        dir="ltr"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-14 bg-[#0f1117] border border-blue-500 rounded px-1.5 py-0.5 text-white text-sm font-mono focus:outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setValue(fmtSec(seconds));
        setEditing(true);
      }}
      title="לחצו לעריכת הזמן"
      className="text-white text-sm font-mono px-1.5 py-0.5 rounded border border-transparent hover:border-gray-600 hover:bg-gray-800 transition-colors"
    >
      {fmtSec(seconds)}
    </button>
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
  onMoveTime,
  onQuestionsChange,
}: {
  cp: SavedCheckpoint;
  expanded: boolean;
  busy: boolean;
  hasTranscript: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onMoveTime: (sec: number) => void;
  onQuestionsChange: (qs: SavedQuestion[]) => void;
}) {
  return (
    <div
      className={`bg-[#161920] border rounded-xl overflow-hidden transition-colors ${
        expanded ? "border-blue-500/40" : "border-gray-800"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <TimeChip seconds={cp.position_seconds} onChange={onMoveTime} />
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 text-start min-w-0"
        >
          <span dir="auto" className="text-gray-400 text-sm truncate">
            {cp.label ?? `שאלות ב-${fmtSec(cp.position_seconds)}`}
          </span>
          <span className="text-xs text-gray-600 shrink-0">
            {cp.questions.length} שאלות
          </span>
          <span className="text-gray-600 text-xs shrink-0 ms-auto">
            {expanded ? "▼" : "◄"}
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {hasTranscript && (
            <button
              onClick={onRegenerate}
              disabled={busy}
              title="יצירת שאלות מחדש עם AI"
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
            title="מחיקת נקודת העצירה"
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
        <p className="text-gray-600 text-xs">עדיין אין שאלות.</p>
      )}
      {checkpoint.questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          checkpointId={checkpoint.id}
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
          + הוספת שאלה
        </button>
      )}
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

const LETTERS = ["A", "B", "C", "D"];

function QuestionCard({
  checkpointId,
  question: q,
  index,
  onDelete,
  onUpdated,
}: {
  checkpointId: string;
  question: SavedQuestion;
  index: number;
  onDelete: () => void;
  onUpdated: (q: SavedQuestion) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <QuestionForm
        checkpointId={checkpointId}
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
        <p dir="auto" className="text-sm text-white leading-snug">
          <span className="text-gray-600 text-xs me-1">{index + 1}.</span>
          {q.question}
        </p>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          >
            עריכה
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
            dir="auto"
            className={`text-xs px-2 py-1 rounded ${
              i === q.correct_index
                ? "bg-green-900/30 text-green-400 border border-green-800/50"
                : "text-gray-500"
            }`}
          >
            <span className="font-mono me-1">{LETTERS[i]}.</span>
            {opt}
          </div>
        ))}
      </div>
      {q.explanation && (
        <p dir="auto" className="text-xs text-gray-600 italic">{q.explanation}</p>
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
      setError("מלאו את כל השדות.");
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
      setError("השמירה נכשלה.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#0f1117] border border-gray-700 rounded-lg p-3 space-y-3"
    >
      <div>
        <label className="block text-xs text-gray-500 mb-1">שאלה</label>
        <input
          type="text"
          dir="auto"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="מה…?"
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
              title={`סימון ${LETTERS[i]} כתשובה הנכונה`}
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
              dir="auto"
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`תשובה ${LETTERS[i]}`}
              className="flex-1 min-w-0 bg-[#161920] border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          הסבר (לא חובה)
        </label>
        <input
          type="text"
          dir="auto"
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
          {saving ? "שומר…" : questionId ? "שמירת שינויים" : "הוספת שאלה"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 transition-colors"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
