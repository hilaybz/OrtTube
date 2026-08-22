import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listStudentFeed } from "@/lib/classes";
import { firstName } from "@/lib/schoolClock";
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
 * The student's own display name, for the greeting. Read straight off
 * `profiles` (the self-select policy allows it) rather than through
 * `getMyProfile`, which intentionally does not carry the name; a failure just
 * drops the name from the greeting rather than the page.
 */
async function loadGreetingName(client: SupabaseClient): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;
    const { data } = await client
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    return firstName((data as { display_name: string | null } | null)?.display_name ?? null);
  } catch {
    return null;
  }
}
