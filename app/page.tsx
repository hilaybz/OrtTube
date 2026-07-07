import Link from "next/link";
import EnterCodeForm from "./EnterCodeForm";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-[#0f1117]">
      <div className="w-full max-w-3xl space-y-10">
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            Ort<span className="text-blue-400">Tube</span>
          </h1>
          <p className="text-gray-400 text-lg">
            צופים בסרטון, עונים על שאלות ושואלים את ה-AI — לומדים באמת.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Student card */}
          <div className="bg-[#161920] border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-2xl">🎓</p>
              <h2 className="text-white font-semibold text-lg">תלמידים</h2>
              <p className="text-gray-500 text-sm leading-relaxed">
                קיבלתם קישור לשיעור מהמורה? הדביקו אותו כאן או הקלידו את קוד
                השיעור.
              </p>
            </div>
            <EnterCodeForm />
          </div>

          {/* Teacher card */}
          <div className="bg-[#161920] border border-gray-800 rounded-2xl p-6 flex flex-col space-y-4">
            <div className="space-y-1 flex-1">
              <p className="text-2xl">🧑‍🏫</p>
              <h2 className="text-white font-semibold text-lg">מורים</h2>
              <p className="text-gray-500 text-sm leading-relaxed">
                מוסיפים סרטון יוטיוב, ה-AI יוצר שאלות לאורך הצפייה, ואתם
                עוקבים אחרי ההתקדמות של התלמידים.
              </p>
            </div>
            <div className="space-y-2">
              <Link
                href="/auth/sign-in"
                className="block w-full text-center bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-3 rounded-xl transition-colors"
              >
                כניסת מורים
              </Link>
              <Link
                href="/auth/sign-up"
                className="block w-full text-center text-gray-400 hover:text-white text-sm py-2 transition-colors"
              >
                עדיין אין לכם חשבון? הרשמה
              </Link>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 text-sm text-gray-600 flex-wrap">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            שאלות במהלך הצפייה
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            מורה AI זמין תמיד
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            מעקב התקדמות למורה
          </span>
        </div>
      </div>
    </main>
  );
}
