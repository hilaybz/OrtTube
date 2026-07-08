"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignInForm({
  expectedRole,
}: {
  expectedRole: "student" | "teacher" | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const actualRole =
      data.user?.user_metadata?.role === "student" ? "student" : "teacher";

    // The landing page has separate teacher/student entrances — using the
    // wrong one with valid credentials is rejected, not silently rerouted.
    if (expectedRole && actualRole !== expectedRole) {
      await supabase.auth.signOut();
      setError(
        expectedRole === "teacher"
          ? "החשבון הזה הוא חשבון תלמיד. היכנסו דרך כניסת תלמידים."
          : "החשבון הזה הוא חשבון מורה. היכנסו דרך כניסת מורים."
      );
      setLoading(false);
      return;
    }

    router.push(actualRole === "student" ? "/student" : "/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0f1117] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">
            Ort<span className="text-blue-400">Tube</span>
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            {expectedRole === "teacher"
              ? "כניסה לחשבון המורה שלך"
              : expectedRole === "student"
                ? "כניסה לחשבון התלמיד שלך"
                : "כניסה לחשבון שלך"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-[#161920] border border-gray-800 rounded-2xl p-6"
        >
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
              autoFocus
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
              className="w-full bg-[#1c1f26] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-sm"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? "מתחבר…" : "כניסה"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          אין לכם חשבון?{" "}
          <Link href="/auth/sign-up-student" className="text-blue-400 hover:text-blue-300 transition-colors">
            הרשמת תלמידים
          </Link>
          {" · "}
          <Link href="/auth/sign-up" className="text-blue-400 hover:text-blue-300 transition-colors">
            הרשמת מורים
          </Link>
        </p>
      </div>
    </main>
  );
}
