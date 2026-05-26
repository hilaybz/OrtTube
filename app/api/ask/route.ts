import { type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  const { question, quizContext, transcriptContext } = (await req.json()) as {
    question: string;
    quizContext: string;
    transcriptContext?: string;
  };

  if (!question?.trim()) {
    return new Response("Question is required", { status: 400 });
  }

  const client = new Anthropic();

  const contextParts = [
    transcriptContext ? `Relevant video content:\n${transcriptContext}` : "",
    `Quiz context:\n${quizContext}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const stream = client.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system:
      "You are a helpful AI tutor. A student is watching an educational video and has a question about a quiz. Answer concisely in 2–4 sentences. If the student writes in Hebrew, respond in Hebrew.",
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
