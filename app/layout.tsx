import type { Metadata } from "next";
import { Rubik, Heebo } from "next/font/google";
import "./globals.css";

// Rubik carries headings, Heebo carries body text — both were designed
// with first-class Hebrew. next/font self-hosts them at build time.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  variable: "--font-display",
  display: "swap",
});
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrtTube — לומדים חכם יותר",
  description: "צופים בסרטון, עונים על שאלות ושואלים את ה-AI — פלטפורמת למידה לבתי ספר",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${heebo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
