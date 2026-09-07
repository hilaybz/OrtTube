# API

Next.js route handlers under `app/api/**`. Each authenticates, validates, and
delegates to a `@/lib/*` wrapper that calls a `SECURITY DEFINER` RPC. Business
rules live in the database.

**Conventions**

- Errors: `{ "error": { "code", "message" } }`. The code is stable (for example
  `not_owner`, `cross_school`, `no_attempts_left`); the status is mapped from it.
- Auth: Supabase session cookie; RPCs run as the caller, so RLS applies. Admin
  and job endpoints use bearer secrets instead.
- Language is resolved server-side; clients never pick a translation.

## Endpoints

### Auth
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-in` | Sign in; returns the role's landing route. |
| POST | `/api/auth/sign-up-student` | Create a student against a pending invite (provisioning only). |
| PATCH | `/api/profile` | Update the caller's preferred language. |

### Quizzes
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/quizzes` | Create a quiz on a video. |
| DELETE | `/api/quizzes/[id]` | Soft-delete a quiz. |
| POST | `/api/quizzes/[id]/questions` | Create or edit a question with options. |
| POST | `/api/quizzes/[id]/generate` | AI-generate questions from the transcript. |
| POST | `/api/quizzes/[id]/translate` | Fill a target-language translation. |
| POST | `/api/quizzes/[id]/transcript` | Warm the transcript cache (202). |
| GET | `/api/quizzes/[id]/preview` | Full read of a readable quiz, answer key included. |
| GET / POST | `/api/quizzes/share` | Browse the school catalog / clone a shared quiz. |
| GET / POST | `/api/quizzes/[id]/allocations` | List this quiz's allocations / bulk-assign to classes. |
| GET | `/api/quizzes/allocations` | The caller's quizzes with live and scheduled class tags. |

### Classes
| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/classes` | List / create. |
| PATCH / DELETE | `/api/classes/[id]` | Rename or re-language / delete. |
| GET | `/api/classes/[id]/roster` | Members and pending invites. |
| POST | `/api/classes/[id]/students` | Add a student by email (enroll or invite). |
| DELETE | `/api/classes/[id]/students/[studentId]` | Remove a student. |
| DELETE | `/api/classes/[id]/invites` | Revoke an invite. |
| GET / POST | `/api/classes/[id]/quizzes` | List assignments / assign a quiz. |
| PATCH / DELETE | `/api/classes/[id]/quizzes/[quizId]` | Change publish state or window / unassign. |
| GET | `/api/classes/assigned` | A student's feed of assigned quizzes with status. |

### Attempts
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/attempts/quiz` | Answer-free quiz view for a student. |
| POST | `/api/attempts` | Start or resume an attempt. |
| POST | `/api/attempts/[attemptId]/answers` | Submit an answer; graded server-side. |
| POST | `/api/attempts/[attemptId]/complete` | Finalize and return the score. |
| GET | `/api/attempts/[attemptId]/review` | Reveal-gated review. |

### Tutor
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ask` | Streaming tutor answer, bounded by tutor mode and playhead. |

### Analytics (teacher)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/analytics/quiz/[quizId]` | Quiz summary. |
| GET | `/api/analytics/class/[classId]` | Per-quiz stats for a class. |
| GET | `/api/analytics/class/[classId]/quiz/[quizId]` | One quiz within one class. |
| GET | `/api/analytics/roster/[classId]` | Per-student progress. |
| GET | `/api/analytics/tutor` | Tutor-interaction stats. |
| GET | `/api/analytics/tutor-questions` | Paged tutor-question log. |
| GET | `/api/analytics/search` | Hub search by student, class or quiz. |
| POST | `/api/analytics/insights` | Streaming AI summary of tutor questions. |

### Admin (`ADMIN_SECRET`)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/seed-teacher` | Provision a teacher and school. |
| POST | `/api/admin/delete-user` | Delete a student (anonymizing data) or a content-free teacher. |
| GET | `/api/admin/probe-innertube` | Diagnose YouTube transcript egress. |

### Jobs (`CRON_SECRET`)
| Path | Purpose |
| --- | --- |
| `/api/jobs/purge-content` | Hard-delete quizzes past the retention window. |
| `/api/jobs/gc-videos` | Delete orphan videos and their cached transcripts. |
| `/api/jobs/reconcile-auth` | Delete auth users with no profile. |
| `/api/jobs/sweep-transcripts` | Expire cached transcripts past the TTL. |
| `/api/jobs/close-attempt-windows` | Finalize attempts whose window closed. |

## RPC layer

- **Authoring:** `create_quiz_for_video`, `get_quiz_for_author`, `upsert_question`,
  `update_quiz`, `soft_delete_quiz`, `soft_delete_question`, `soft_delete_option`.
- **Translation:** `claim_translation_job`, `release_translation_job`.
- **Roster:** `add_student_to_class`, `remove_student_from_class`, `revoke_invite`,
  `list_class_roster`.
- **Assignment:** `assign_quiz_to_class`, `set_class_quiz_published`,
  `set_class_quiz_schedule`, `unassign_quiz`, `list_class_quizzes`,
  `list_quiz_allocations`, `list_my_quiz_allocation_tags`, `list_student_feed`.
- **Play:** `get_quiz_for_student`, `start_or_resume_attempt`, `submit_answer`,
  `complete_attempt`, `get_attempt_review`, `list_my_attempts_for_quiz`.
- **Tutor:** `get_tutor_mode`.
- **Sharing:** `list_my_quizzes`, `list_shared_quizzes`, `get_quiz_for_preview`,
  `clone_quiz`.
- **Analytics:** `quiz_stats`, `question_stats`, `class_stats`, `tutor_stats`,
  `class_quiz_analytics`, `class_roster_progress`, `student_quiz_progress`,
  `class_analytics_overview`, `quiz_analytics_overview`, `student_analytics`,
  `teacher_analytics_search`, `tutor_questions_page`, `tutor_prompts_in_scope`.
- **Lifecycle:** `deactivate_teacher`, `reassign_ownership`.
- **Maintenance:** `purge_soft_deleted_quizzes`, `gc_orphan_videos`,
  `list_orphan_auth_users`, `close_expired_attempt_windows`.
