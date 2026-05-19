import URLInput from "@/components/URLInput";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-[#0f1117]">
      <div className="w-full max-w-xl text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            Ort<span className="text-blue-400">Tube</span>
          </h1>
          <p className="text-gray-400 text-lg">
            Paste a YouTube link. Watch. Get quizzed. Actually learn.
          </p>
        </div>

        <URLInput />

        <div className="flex items-center justify-center gap-6 text-sm text-gray-600">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            Quiz at 25%
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            Quiz at 50%
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            Quiz at 75%
          </span>
        </div>
      </div>
    </main>
  );
}
