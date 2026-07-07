"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignUpForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0f1117] px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <h1 className="text-3xl font-bold text-white">
            Ort<span className="text-blue-400">Tube</span>
          </h1>
          <div className="bg-[#161920] border border-gray-800 rounded-2xl p-6 space-y-3">
            <p className="text-white font-medium">בדקו את האימייל שלכם</p>
            <p className="text-gray-400 text-sm">
              שלחנו קישור אישור אל{" "}
              <span dir="ltr" className="text-gray-200">{email}</span>. לחצו
              עליו כדי להפעיל את החשבון.
            </p>
          </div>
          <p className="text-gray-500 text-sm">
            כבר אישרתם?{" "}
            <Link href="/auth/sign-in" className="text-blue-400 hover:text-blue-300 transition-colors">
              כניסה
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0f1117] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">
            Ort<span className="text-blue-400">Tube</span>
          </h1>
          <p className="text-gray-400 mt-2 text-sm">יצירת חשבון מורה</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-[#161920] border border-gray-800 rounded-2xl p-6"
        >
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="text-sm text-gray-300">
              שם
            </label>
            <input
              id="display-name"
              type="text"
              dir="auto"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
              placeholder="השם שלכם"
              className="w-full bg-[#1c1f26] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm text-gray-300">
              אימייל
            </label>
            <input
              id="email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[#1c1f26] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm text-gray-300">
              סיסמה
            </label>
            <input
              id="password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-[#1c1f26] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? "יוצר חשבון…" : "יצירת חשבון"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          כבר יש לכם חשבון?{" "}
          <Link href="/auth/sign-in" className="text-blue-400 hover:text-blue-300 transition-colors">
            כניסה
          </Link>
        </p>
      </div>
    </main>
  );
}
