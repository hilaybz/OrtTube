import { type NextRequest } from "next/server";
import { getTranscript, buildCheckpoints } from "@/lib/transcript";
import { QUIZ_CHECKPOINTS } from "@/lib/demoQuiz";

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");

  if (!videoId) {
    return Response.json({ checkpoints: QUIZ_CHECKPOINTS });
  }

  const segments = await getTranscript(videoId);

  if (!segments || segments.length === 0) {
    return Response.json({ checkpoints: QUIZ_CHECKPOINTS, source: "demo" });
  }

  try {
    const checkpoints = await buildCheckpoints(segments);
    return Response.json({ checkpoints, source: "ai", transcript: segments });
  } catch {
    return Response.json({ checkpoints: QUIZ_CHECKPOINTS, source: "demo", transcript: segments });
  }
}
