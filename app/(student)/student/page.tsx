import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listAssignedForStudent } from "@/lib/classes";
import { listMyAttemptsForQuiz } from "@/lib/attempts";
import { StudentFeed, type FeedClass } from "@/components/student/StudentFeed";

// Feed aggregates the class-tabbed assignment list with per-quiz attempt state.
// The per-quiz state calls fan out in parallel (N round-trips — fine at pilot
// scale; there is no cross-quiz rollup RPC).
async function buildFeed(client: SupabaseClient): Promise<FeedClass[]> {
  const classes = await listAssignedForStudent(client);
  return Promise.all(
    classes.map(async (c) => ({
      class_id: c.class_id,
      class_name: c.class_name,
      quizzes: await Promise.all(
        c.quizzes.map(async (q) => ({
          quiz_id: q.quiz_id,
          title: q.title,
          video_title: q.video_title,
          youtube_video_id: q.youtube_video_id,
          state: await listMyAttemptsForQuiz(client, c.class_id, q.quiz_id).catch(
            () => null
          ),
        }))
      ),
    }))
  );
}

export default async function StudentFeedPage() {
  const client = (await createClient()) as unknown as SupabaseClient;
  const classes = await buildFeed(client);

  return (
    <div className="mx-auto max-w-5xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">הפיד שלי</h1>
      <p className="mb-6 text-[var(--body)]">החידונים שהוקצו לכיתות שלך.</p>
      <StudentFeed classes={classes} />
    </div>
  );
}
