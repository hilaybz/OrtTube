import { YoutubeTranscript } from "youtube-transcript";
import Anthropic from "@anthropic-ai/sdk";
import { QUIZ_CHECKPOINTS, type QuizCheckpoint, type QuizQuestion } from "./demoQuiz";

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

function extractInlineJson(html: string, varName: string): unknown {
  const tokens = [`var ${varName} = `, `${varName} = `];
  for (const token of tokens) {
    const startIndex = html.indexOf(token);
    if (startIndex === -1) continue;
    const jsonStart = startIndex + token.length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = jsonStart; i < html.length; i++) {
      const ch = html[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    const data = extractInlineJson(html, "ytInitialPlayerResponse") as
      | { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } }
      | null;
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseSrv3(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(m[1], 10);
    const durMs = parseInt(m[2], 10);
    const inner = m[3];
    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    text = decodeHtmlEntities(text).trim();
    if (text) {
      segments.push({ text, offset: startMs, duration: durMs });
    }
  }
  return segments;
}

function parseClassic(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const text = decodeHtmlEntities(m[3]).trim();
    if (text) {
      segments.push({
        text,
        offset: parseFloat(m[1]) * 1000,
        duration: parseFloat(m[2]) * 1000,
      });
    }
  }
  return segments;
}

async function fetchAndParseTranscript(url: string): Promise<TranscriptSegment[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const xml = await res.text();

    const srv3 = parseSrv3(xml);
    if (srv3.length > 0) return srv3;

    const classic = parseClassic(xml);
    if (classic.length > 0) return classic;

    return null;
  } catch {
    return null;
  }
}

async function tryPackage(
  videoId: string,
  lang?: string
): Promise<TranscriptSegment[] | null> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(
      videoId,
      lang ? { lang } : undefined
    );
    if (!raw || raw.length === 0) return null;
    return raw.map((s) => ({
      text: s.text,
      offset: s.offset,
      duration: s.duration,
    }));
  } catch {
    return null;
  }
}

export async function getTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
  for (const lang of ["iw", "he"]) {
    const result = await tryPackage(videoId, lang);
    if (result) {
      console.log(`[transcript] ${videoId}: native ${lang} (${result.length} segments)`);
      return result;
    }
  }

  const tracks = await fetchCaptionTracks(videoId);
  const english = tracks?.find((t) => t.languageCode === "en");
  if (english) {
    const translated = await fetchAndParseTranscript(`${english.baseUrl}&tlang=he`);
    if (translated) {
      console.log(`[transcript] ${videoId}: translated en→he (${translated.length} segments)`);
      return translated;
    }
  }

  const englishOriginal = await tryPackage(videoId, "en");
  if (englishOriginal) {
    console.log(`[transcript] ${videoId}: english fallback (${englishOriginal.length} segments)`);
    return englishOriginal;
  }

  const any = await tryPackage(videoId);
  if (any) {
    console.log(`[transcript] ${videoId}: default fallback (${any.length} segments)`);
    return any;
  }

  console.log(`[transcript] ${videoId}: no transcript available`);
  return null;
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
