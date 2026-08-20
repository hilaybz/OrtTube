/**
 * Maps stable error-envelope codes (raised by the RPC/service layer and passed
 * through the `/api/**` handlers as `{ error: { code, message } }`) to
 * user-facing Hebrew messages. The HTTP status is already derived server-side
 * from the code; this is presentation only.
 */
const MESSAGES: Record<string, string> = {
  unauthorized: "יש להתחבר כדי להמשיך.",
  invalid_credentials: "אימייל או סיסמה שגויים.",
  invalid_request: "הבקשה אינה תקינה.",
  not_member: "אינך רשום/ה לכיתה זו.",
  not_your_attempt: "אין לך גישה לניסיון זה.",
  not_assigned: "המבחן אינו מוקצה לכיתה זו.",
  quiz_not_found: "המבחן לא נמצא.",
  attempt_not_found: "הניסיון לא נמצא.",
  no_attempts_left: "לא נותרו ניסיונות נוספים.",
  already_answered: "כבר ענית על שאלה זו.",
  attempt_completed: "הניסיון כבר הושלם.",
  tutor_off: "OrtAI כבוי בחידון זה.",
  // Platform guardrails on the tutor. The first is temporary and says so; the
  // second is a lifetime budget for this quiz, so it must not imply that waiting
  // helps — the student needs to know it will not come back.
  rate_limited: "שלחת יותר מדי שאלות ברצף. נסו שוב בעוד דקה.",
  question_limit_reached: "הגעת למספר השאלות המרבי למורה־AI במבחן זה.",
  // The window closed exactly as this request landed; the attempt was
  // finalized server-side with whatever was already answered. Must not
  // imply retrying helps — a retry only ever hits attempt_completed.
  window_closed: "חלון הזמן למבחן הסתיים. הניסיון הוגש באופן אוטומטי.",
  invalid_schedule_window:
    "טווח הזמנים אינו תקין. תחילת הזמינות חייבת להיות לפני סיומה.",
  not_owner: "אין לך הרשאה לפעולה זו.",
  not_authorized: "אין לך הרשאה לפעולה זו.",
  cross_school: "התלמיד/ה שייך/ת לבית ספר אחר.",
  is_teacher: "לא ניתן לרשום מורה כתלמיד.",
  invalid_email: "כתובת אימייל לא תקינה.",
  invalid_max_attempts: "מספר הניסיונות אינו תקין.",
  invalid_tutor_mode: "מצב OrtAI אינו תקין.",
  lookup_failed: "אירעה תקלה זמנית. נסו שוב בעוד רגע.",
  // Deliberately covers BOTH causes in one sentence. A fetch that YouTube blocks
  // is often indistinguishable from a video that genuinely has no captions, so
  // asserting either one would frequently be wrong. Retrying is worthwhile, and
  // manual authoring always works.
  transcript_unavailable:
    "לסרטון זה אין כתוביות או שלא הצלחנו לקרוא אותם כרגע. נסו שוב או הוסיפו שאלות ידנית.",
  generation_failed: "יצירת השאלות עם AI נכשלה. נסו שוב או הוסיפו שאלות ידנית.",
  forbidden: "אין לך הרשאה לפעולה זו.",
  not_found: "הפריט המבוקש לא נמצא.",
};

export function messageForCode(code: string | undefined): string {
  return (code && MESSAGES[code]) || "אירעה שגיאה. נסו שוב.";
}
