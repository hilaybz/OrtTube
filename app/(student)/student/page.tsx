import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { listStudentFeed } from "@/lib/classes";
import { firstName } from "@/lib/datetime";
import { StudentFeed } from "@/components/student/StudentFeed";
import { StudentWelcome } from "@/components/student/StudentWelcome";

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

async function loadGreetingName(client: SupabaseClient): Promise<string | null> {
  try {
    const profile = await getMyProfile(client);
    return firstName(profile?.display_name ?? null);
  } catch {
    return null;
  }
}
