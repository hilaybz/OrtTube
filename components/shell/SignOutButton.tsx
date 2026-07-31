"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await fetch("/auth/sign-out", { method: "POST" });
        router.push("/sign-in");
        router.refresh();
      }}
    >
      יציאה
    </Button>
  );
}
