import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StudentSignUpForm from "./StudentSignUpForm";

export default async function StudentSignUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email) {
    redirect(user.user_metadata?.role === "student" ? "/student" : "/dashboard");
  }

  return <StudentSignUpForm />;
}
