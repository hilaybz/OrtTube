import { YoutubeTranscript } from "youtube-transcript";
import Anthropic from "@anthropic-ai/sdk";
import { QUIZ_CHECKPOINTS, type QuizCheckpoint, type QuizQuestion } from "./demoQuiz";

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export async function getTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    return raw.map((s) => ({
      text: s.text,
      offset: s.offset,
      duration: s.duration,
    }));
  } catch {
    return null;
  }
}

function sliceTranscript(
  segments: TranscriptSegment[],
  fromPercent: number,
  toPercent: number
): string {
  if (segments.length === 0) return "";
  const last = segments[segments.length - 1];
  const totalMs = last.offset + last.duration;
  const fromMs = totalMs * (fromPercent / 100);
  const toMs = totalMs * (toPercent / 100);

  return segments
    .filter((s) => s.offset >= fromMs && s.offset < toMs)
    .map((s) => s.text.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

async function generateQuestions(
  client: Anthropic,
  transcriptSection: string
): Promise<QuizQuestion[]> {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system:
      "You are an educational quiz generator. Respond with a JSON array only — no markdown, no explanation, just the raw JSON.",
    messages: [
      {
        role: "user",
        content: `Generate 2 multiple-choice comprehension questions based on this video transcript section:

"""
${transcriptSection.slice(0, 3000)}
"""

Rules:
- Questions must be specific to the content, not generic
- Exactly 4 answer options each
- If the transcript is in Hebrew, generate questions and options in Hebrew
- Return ONLY a JSON array, nothing else

[
  {
    "question": "...",
    "options": ["...", "...", "...", "..."],
    "correct": 0,
    "explanation": "..."
  }
]`,
      },
    ],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in Claude response");

  const parsed = JSON.parse(match[0]) as Array<{
    question: string;
    options: string[];
    correct: number;
    explanation: string;
  }>;

  return parsed.slice(0, 2).map((q, i) => ({
    id: Date.now() + i,
    question: q.question,
    options: q.options,
    correct: Math.max(0, Math.min(3, q.correct)),
    explanation: q.explanation,
  }));
}

const CHECKPOINT_DEFS = [
  { percent: 25 as const, label: "First Quarter Check", from: 0, to: 25 },
  { percent: 50 as const, label: "Halfway Check", from: 25, to: 50 },
  { percent: 75 as const, label: "Third Quarter Check", from: 50, to: 75 },
];

export async function buildCheckpoints(
  segments: TranscriptSegment[]
): Promise<QuizCheckpoint[]> {
  const client = new Anthropic();

  const results = await Promise.all(
    CHECKPOINT_DEFS.map(async (def, i) => {
      const section = sliceTranscript(segments, def.from, def.to);
      if (section.trim().length < 50) return QUIZ_CHECKPOINTS[i];

      try {
        const questions = await generateQuestions(client, section);
        return {
          percent: def.percent,
          label: def.label,
          questions,
          transcriptContext: section.slice(0, 2000),
        } satisfies QuizCheckpoint;
      } catch {
        return QUIZ_CHECKPOINTS[i];
      }
    })
  );

  return results;
}
