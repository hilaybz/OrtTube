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
  tutor_off: "המורה־AI כבוי במבחן זה.",
  not_owner: "אין לך הרשאה לפעולה זו.",
  not_authorized: "אין לך הרשאה לפעולה זו.",
  cross_school: "התלמיד/ה שייך/ת לבית ספר אחר.",
  is_teacher: "לא ניתן לרשום מורה כתלמיד.",
  invalid_email: "כתובת אימייל לא תקינה.",
  invalid_max_attempts: "מספר הניסיונות אינו תקין.",
  invalid_tutor_mode: "מצב המורה־AI אינו תקין.",
  lookup_failed: "אירעה תקלה זמנית. נסו שוב בעוד רגע.",
  transcript_unavailable:
    "לסרטון זה אין כתוביות, ולכן לא ניתן ליצור שאלות עם AI. הוסיפו שאלות ידנית.",
  generation_failed: "יצירת השאלות עם AI נכשלה. נסו שוב או הוסיפו שאלות ידנית.",
  forbidden: "אין לך הרשאה לפעולה זו.",
  not_found: "הפריט המבוקש לא נמצא.",
};

export function messageForCode(code: string | undefined): string {
  return (code && MESSAGES[code]) || "אירעה שגיאה. נסו שוב.";
}
