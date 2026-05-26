"use client";

import { useState } from "react";

export default function CopyLinkButton({ shareCode }: { shareCode: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/s/${shareCode}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
    >
      {copied ? (
        <>
          <span className="text-green-400">✓</span>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <span>🔗</span>
          Copy student link
        </>
      )}
    </button>
  );
}
