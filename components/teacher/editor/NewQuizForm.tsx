"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { SegmentedToggle, type Segment } from "@/components/ui/SegmentedToggle";
import { apiFetch, ApiError } from "@/lib/http";
import { SUPPORTED_LANGUAGES, type Language } from "@/lib/lang";
import type { CreatedQuiz } from "./types";
import { LANGUAGE_LABELS, isBareYouTubeId, parseYouTubeVideoId } from "./format";

const LANGUAGE_SEGMENTS: ReadonlyArray<Segment<Language>> = SUPPORTED_LANGUAGES.map(
  (l) => ({ value: l, label: LANGUAGE_LABELS[l] })
);

// How the quiz's length is decided — the same two states the editor offers, so
// a teacher meets one vocabulary for this in both places.
type DurationMode = "estimated" | "restricted";
const DURATION_SEGMENTS: ReadonlyArray<Segment<DurationMode>> = [
  { value: "estimated", label: "הערכה מהסרטון" },
  { value: "restricted", label: "הגבלת זמן" },
];

/**
 * Create-a-quiz flow, in two steps a teacher can see at once: identify the
 * video, then name it. The link box is `dir="ltr"` — its content is a URL, so
 * it reads and edits left-to-right with the caret at its own inline start —
 * while its hint stays a normal RTL Hebrew sentence with the English example
 * isolated in a `<bdi>` so the bidi algorithm can't scramble it.
 *
 * The pasted link is resolved to a video id as it is typed and echoed back as
 * the real thumbnail, so a wrong paste is caught here rather than after a quiz,
 * a video row and a transcript fetch already exist.
 *
 * A title is REQUIRED here even though `create_quiz_for_video` accepts null:
 * an untitled quiz falls back to the video's title everywhere it is listed,
 * which makes two quizzes on one video indistinguishable. That is a form-level
 * rule, enforced in the client, with the server contract left alone.
 */
export function NewQuizForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<Language>("he");
  // Validation appears only after the first submit attempt, then tracks the
  // fields live — an empty form must not greet a teacher with two errors.
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timeRestricted, setTimeRestricted] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("");

  const videoId = parseYouTubeVideoId(url);
  const urlError = !attempted
    ? undefined
    : url.trim() === ""
      ? "יש להדביק קישור לסרטון."
      : !videoId
        ? "הקישור אינו קישור YouTube מזוהה."
        : undefined;
  const titleError =
    attempted && title.trim() === "" ? "יש להזין כותרת לחידון." : undefined;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempted(true);
    setError(null);
    if (!videoId || title.trim() === "") return;
    if (timeRestricted) {
      const n = Number(durationMinutes);
      if (!Number.isInteger(n) || n < 1) {
        setError("משך הזמן חייב להיות מספר שלם גדול מ־0.");
        return;
      }
    }
    setBusy(true);
    try {
      const { quiz } = await apiFetch<{ quiz: CreatedQuiz }>("/api/quizzes", {
        method: "POST",
        // A pasted URL is sent as-is so the server does the extracting; only a
        // bare id (which it cannot extract from) is sent pre-resolved.
        body: JSON.stringify({
          ...(isBareYouTubeId(url)
            ? { youtubeId: videoId }
            : { youtubeUrl: url.trim() }),
          baseLanguage: language,
          title: title.trim(),
          timeRestricted,
          durationMinutes: timeRestricted ? Number(durationMinutes) : undefined,
        }),
      });
      router.push(`/dashboard/quizzes/${quiz.quiz_id}/edit`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "יצירת החידון נכשלה. בדקו את הקישור ונסו שוב."
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error && <Alert variant="danger">{error}</Alert>}

      <section className="glass flex flex-col gap-4 p-5">
        <StepHeading step={1} title="הסרטון" icon="video" />
        <Field
          label="קישור לסרטון YouTube"
          name="youtubeUrl"
          dir="ltr"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={urlError}
          className="w-full"
        />
        <p className="text-xs leading-relaxed text-[var(--body-subtle)]">
          מדביקים קישור מ-YouTube — למשל{" "}
          <bdi dir="ltr" className="rounded-[var(--radius-sm)] bg-[var(--neutral-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--body)]">
            youtu.be/dQw4w9WgXcQ
          </bdi>{" "}
          — וגם קישור צפייה, Shorts או מזהה סרטון יזוהו.
        </p>
        <VideoEcho videoId={videoId} typing={url.trim() !== ""} />
      </section>

      <section className="glass flex flex-col gap-4 p-5">
        <StepHeading step={2} title="פרטי החידון" icon="quiz" />
        <Field
          label="כותרת החידון"
          name="title"
          placeholder="למשל: מבוא לפונקציות — שיעור 3"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={titleError}
          className="w-full"
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--heading)]">שפת המקור</span>
          <SegmentedToggle<Language>
            segments={LANGUAGE_SEGMENTS}
            value={language}
            onChange={setLanguage}
            ariaLabel="שפת המקור"
            className="self-start"
          />
          <p className="text-xs text-[var(--body-subtle)]">
            השפה שבה ייכתבו השאלות. תלמידים שקוראים בשפה אחרת יקבלו תרגום אוטומטי.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--heading)]">משך החידון</span>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedToggle<DurationMode>
              segments={DURATION_SEGMENTS}
              value={timeRestricted ? "restricted" : "estimated"}
              onChange={(mode) => setTimeRestricted(mode === "restricted")}
              ariaLabel="אופן קביעת משך החידון"
              className="self-start"
            />
            {timeRestricted && (
              <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="דקות"
                  aria-label="משך החידון בדקות"
                  className="w-24 rounded-[var(--radius)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-sm tabular-nums text-[var(--heading)] outline-none backdrop-blur-[20px] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                />
                דקות
              </label>
            )}
          </div>
          <p className="text-xs text-[var(--body-subtle)]">
            {timeRestricted
              ? "התלמידים יראו את המשך שתקבעו."
              : "התלמידים יראו הערכה המבוססת על אורך הסרטון. אפשר לשנות זאת בכל עת."}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <Spinner size={18} /> : <Icon name="sparkle" size={18} />}
          יצירת החידון
        </Button>
        <p className="text-xs text-[var(--body-subtle)]">
          מיד אחר כך תגיעו לעורך, שם אפשר ליצור שאלות עם AI או להוסיף אותן ידנית.
        </p>
      </div>
    </form>
  );
}

/** A numbered step marker + its title, so the flow reads as two ordered steps. */
function StepHeading({
  step,
  title,
  icon,
}: {
  step: number;
  title: string;
  icon: "video" | "quiz";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--brand-softer)] text-xs font-semibold text-[var(--fg-brand-strong)] tabular-nums">
        {step}
      </span>
      <h2 className="flex items-center gap-1.5 text-base font-semibold text-[var(--heading)]">
        <Icon name={icon} size={16} className="text-[var(--body-subtle)]" />
        {title}
      </h2>
    </div>
  );
}

/**
 * The resolved video, echoed back: its thumbnail once a link parses, a quiet
 * "not recognised yet" note while the box holds something that doesn't, and
 * nothing at all for an empty box.
 */
function VideoEcho({ videoId, typing }: { videoId: string | null; typing: boolean }) {
  if (videoId) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-d)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          className="aspect-video w-28 flex-none rounded-[var(--radius-sm)] object-cover"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--fg-success)]">
            <Icon name="checkCircle" size={16} />
            זיהינו את הסרטון
          </span>
          <bdi dir="ltr" className="truncate font-mono text-[11px] text-[var(--body-subtle)]">
            {videoId}
          </bdi>
        </div>
      </div>
    );
  }
  if (!typing) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-[var(--body-subtle)]">
      <Icon name="info" size={14} className="flex-none" />
      עדיין לא זיהינו קישור לסרטון.
    </p>
  );
}
