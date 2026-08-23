import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { listStudentFeed } from "@/lib/classes";
import { firstName } from "@/lib/datetime";
import { StudentFeed } from "@/components/student/StudentFeed";
import { StudentWelcome } from "@/components/student/StudentWelcome";

/**
 * The student's homepage: a greeting with what is due next, then the feed
 * itself. `list_student_feed` hands over every assigned quiz in one query, so
 * the header's "what's next" and the feed's sections are two readings of the
 * same rows — no second fetch, and nothing that can disagree with itself.
 */
export default async function StudentFeedPage() {
  const client = (await createClient()) as unknown as SupabaseClient;
  const now = new Date();
  const [items, name] = await Promise.all([
    listStudentFeed(client),
    loadGreetingName(client),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 py-2">
      <StudentWelcome name={name} items={items} now={now} />
      <StudentFeed items={items} />
    </div>
  );
}

/**
 * The student's own display name, for the greeting. Comes off the same memoized
 * profile the enclosing layout already read, so the name costs no extra round
 * trip. A failure just drops the name from the greeting rather than the page.
 */
async function loadGreetingName(client: SupabaseClient): Promise<string | null> {
  try {
    const profile = await getMyProfile(client);
    return firstName(profile?.display_name ?? null);
  } catch {
    return null;
  }
}
