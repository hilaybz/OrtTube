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
      </header>

      {/* Player */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 px-4 pb-10">
        <div className="w-full max-w-4xl">
          <div className="rounded-xl overflow-hidden border border-gray-800 shadow-2xl">
            <VideoPlayer videoId={videoId} />
          </div>
        </div>
      </main>
    </div>
  );
}
