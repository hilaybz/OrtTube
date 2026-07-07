import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrtTube — לומדים חכם יותר",
  description: "צופים בסרטון, עונים על שאלות ושואלים את ה-AI — פלטפורמת למידה לבתי ספר",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
