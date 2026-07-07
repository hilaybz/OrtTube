import { type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

function fmtTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  const { question, quizContext, videoSummary, currentTimeSeconds } =
    (await req.json()) as {
      question: string;
      quizContext?: string;
      videoSummary?: string;
      currentTimeSeconds?: number;
    };

  if (!question?.trim()) {
    return new Response("Question is required", { status: 400 });
  }

  const client = new Anthropic();

  const currentTimeLabel =
    typeof currentTimeSeconds === "number"
      ? fmtTimestamp(currentTimeSeconds)
      : null;

  const contextParts = [
    videoSummary
      ? `Video summary (timestamped, chronological):\n${videoSummary}`
      : "",
    currentTimeLabel
      ? `Student's current position in the video: ${currentTimeLabel}`
      : "",
    quizContext ? `Quiz question the student just answered:\n${quizContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system:
      "You are a helpful AI tutor for students watching an educational video. " +
      "You may be given a timestamped summary of the video and the student's current position in it. " +
      "Only use summary content up to and including the student's current position, unless they explicitly ask about the whole video — don't spoil what comes later. " +
      "When it's helpful, mention the approximate time (mm:ss) in the video where something was covered. " +
      "The student may ask about a quiz question they just answered, or about anything else in the lesson — use the provided context as background when relevant, but answer their actual question. " +
      "Answer concisely in 2–4 sentences. Always respond in the same language the student's question is written in. Most students are Hebrew speakers, so if the question's language is ambiguous, default to Hebrew.",
    messages: [
      {
        role: "user",
        content: `${contextParts}\n\nStudent question: ${question}`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
