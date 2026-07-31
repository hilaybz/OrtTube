import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

// Rubik is the single app font — Google-Sans-adjacent with first-class Hebrew,
// mapped to the design system's typography role. next/font self-hosts it.
const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OrtTube — לומדים חכם יותר",
  description:
    "צופים בסרטון, עונים על שאלות ושואלים את ה-AI — פלטפורמת למידה לבתי ספר",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={rubik.variable}>
      <head>
        {/* Warm up YouTube's hosts so the embedded player boots faster. */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.google.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://s.ytimg.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
