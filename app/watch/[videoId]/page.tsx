import { notFound } from "next/navigation";
import VideoPlayer from "@/components/VideoPlayer";
import Link from "next/link";

interface Props {
  params: Promise<{ videoId: string }>;
}

const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

export default async function WatchPage({ params }: Props) {
  const { videoId } = await params;

  if (!VALID_VIDEO_ID.test(videoId)) notFound();

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      {/* Nav */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-gray-800">
        <Link href="/" className="text-xl font-bold text-white">
          Ort<span className="text-blue-400">Tube</span>
        </Link>
        <span className="text-xs text-gray-600 bg-gray-800 px-3 py-1 rounded-full">
          Demo mode — quizzes are placeholders
        </span>
      </header>

      {/* Player */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 px-4 pb-10">
        <div className="w-full max-w-4xl">
          <div className="rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
            <VideoPlayer videoId={videoId} />
          </div>
          <p className="mt-4 text-gray-600 text-sm text-center">
            Quizzes appear automatically at 25%, 50%, and 75% of the video.
          </p>
        </div>
      </main>
    </div>
  );
}
