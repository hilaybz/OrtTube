# API

OrtTube's HTTP API is a set of Next.js App Router route handlers under
`app/api/**`. The handlers are thin: they authenticate the caller, validate the
request, and delegate to a `@/lib/*` wrapper that calls a `SECURITY DEFINER`
Postgres RPC. Business rules (ownership, tenant isolation, the reveal gate,
correctness) live in the database, not the handler.

## Conventions

- **Errors** use a uniform envelope: `{ "error": { "code", "message" } }`. The
  `code` is the stable code the RPC/service raised (e.g. `not_owner`,
  `cross_school`, `no_attempts_left`); the HTTP status is mapped from it.
- **Auth** is a Supabase session cookie. User-facing endpoints resolve the
  signed-in user via the SSR client, so every RPC runs with the caller's
  `auth.uid()` and RLS applies. Admin and job endpoints are guarded by a bearer
  secret instead (see below).
- **Language** is resolved server-side (`preferred → class → base`); clients never
  choose which stored translation they receive.

## Teacher & student endpoints

### Auth
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/sign-in` | Role-agnostic sign-in; returns the post-login route (`/dashboard` or `/student`) and rejects deactivated users. |
| POST | `/api/auth/sign-up-student` | Student self-signup, gated by a pending class invite; cleans up the auth user on failure. |

### Quiz authoring
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/quizzes` | Create a quiz: upsert the canonical video and author the first quiz on it. |
| POST | `/api/quizzes/[id]/questions` | Create or edit a question with its options + answer key. |
| POST | `/api/quizzes/[id]/generate` | AI-generate questions from the transcript in the quiz's base language. |
| POST | `/api/quizzes/[id]/translate` | Lazily fill a target-language translation of the quiz's text. |

### Sharing
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/quizzes/share` | Browse the same-school shared-quiz catalog. |
| POST | `/api/quizzes/share` | Deep-clone a readable quiz into a new private copy. |

### Classes, roster, assignment
| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/classes` | List the teacher's classes / create a class. |
| PATCH / DELETE | `/api/classes/[id]` | Rename or re-language / delete a class. |
| GET | `/api/classes/[id]/roster` | Members + pending invites. |
| POST | `/api/classes/[id]/students` | Add a student by email (enroll or create a pending invite). |
| DELETE | `/api/classes/[id]/students/[studentId]` | Remove a student. |
| DELETE | `/api/classes/[id]/invites` | Revoke a pending invite. |
| GET / POST | `/api/classes/[id]/quizzes` | List assignments / assign a quiz (`tutorMode`, `maxAttempts`) with best-effort eager translation. |
| DELETE | `/api/classes/[id]/quizzes/[quizId]` | Unassign a quiz. |
| GET | `/api/classes/assigned` | A student's class-tabbed feed of assigned quizzes. |

### Attempts
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/attempts/quiz` | The answer-free quiz view for a student in a class. |
| POST | `/api/attempts` | Start a new attempt or resume the incomplete one; enforces `max_attempts`. |
| POST | `/api/attempts/[attemptId]/answers` | Submit an answer (graded server-side). |
| POST | `/api/attempts/[attemptId]/complete` | Finalize the attempt and return the score. |
| GET | `/api/attempts/[attemptId]/review` | Reveal-gated review — per-question detail only once no retake remains. |

### AI tutor
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/ask` | Streaming tutor answer, bounded by the class `tutor_mode` and the transcript sliced to the current playhead; never reveals the answer key. Logged to `tutor_questions`. |

### Analytics (teacher, owner-checked)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/analytics/quiz/[quizId]` | Completion / attempt / score summary for a quiz. |
| GET | `/api/analytics/class/[classId]` | Per-assigned-quiz stats for a class. |
| GET | `/api/analytics/tutor` | Tutor-interaction stats for a quiz or class. |

## Admin endpoints (`ADMIN_SECRET`)

Guarded by `Authorization: Bearer <ADMIN_SECRET>` — a separate secret from the
cron secret, so a leaked cron token cannot create or delete users.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/seed-teacher` | Provision a teacher (auth user + profile), resolving or creating the school. |
| POST | `/api/admin/delete-user` | Delete a user by role: students are removed and their behavioural rows anonymized; a teacher who still owns content returns `must_reassign`. |

## Scheduled jobs (`CRON_SECRET`)

Guarded by `Authorization: Bearer <CRON_SECRET>`. Each runs privileged
maintenance via the service role and returns a JSON summary.

| Method | Path | Purpose | Suggested cadence |
| --- | --- | --- | --- |
| POST | `/api/jobs/purge-content` | Hard-delete quizzes soft-deleted past the retention window (cascades their content). | daily |
| POST | `/api/jobs/gc-videos` | Delete orphan videos (no referencing quiz) past a grace window, plus their cached transcript objects. | hourly |
| POST | `/api/jobs/reconcile-auth` | Delete orphan `auth.users` with no profile (crash-safety net for interrupted signups). | ~15 min |
| POST | `/api/jobs/sweep-transcripts` | Delete cached transcript objects older than the TTL (Storage has no native expiry). | weekly |

## RPC layer

The wrappers in `@/lib/*` call these Postgres functions. Grouped by area:

- **Authoring** — `create_quiz_for_video`, `upsert_question`, `update_quiz`,
  `soft_delete_quiz`, `soft_delete_question`, `soft_delete_option`.
- **Translation** — `claim_translation_job`, `release_translation_job`.
- **Classes / roster** — `add_student_to_class`, `remove_student_from_class`,
  `revoke_invite`, `list_class_roster`.
- **Assignment** — `assign_quiz_to_class`, `unassign_quiz`, `list_class_quizzes`,
  `list_assigned_for_student`.
- **Student play** — `get_quiz_for_student`, `start_or_resume_attempt`,
  `submit_answer`, `complete_attempt`, `get_attempt_review`.
- **Tutor** — `get_tutor_mode`.
- **Sharing** — `list_shared_quizzes`, `clone_quiz`, `list_my_quizzes`.
- **Analytics** — `quiz_stats`, `question_stats`, `class_stats`, `tutor_stats`.
- **Lifecycle** — `deactivate_teacher`, `reassign_ownership`, and the delete-user
  flow.
- **Maintenance** — `purge_soft_deleted_quizzes`, `gc_orphan_videos`,
  `list_orphan_auth_users`.

See [`data-model.md`](./data-model.md) for the tables these operate on.
