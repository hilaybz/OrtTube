import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignInForm from "./SignInForm";

interface Props {
  searchParams: Promise<{ role?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { role } = await searchParams;
  const expectedRole =
    role === "student" || role === "teacher" ? role : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email) {
    redirect(user.user_metadata?.role === "student" ? "/student" : "/dashboard");
  }

  return <SignInForm expectedRole={expectedRole} />;
}
