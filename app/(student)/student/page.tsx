import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listStudentFeed } from "@/lib/classes";
import { StudentFeed } from "@/components/student/StudentFeed";

export default async function StudentFeedPage() {
  const client = (await createClient()) as unknown as SupabaseClient;
  const items = await listStudentFeed(client);

  return (
    <div className="mx-auto max-w-5xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">הפיד שלי</h1>
      <p className="mb-6 text-[var(--body)]">החידונים שהוקצו לך.</p>
      <StudentFeed items={items} />
    </div>
  );
}
