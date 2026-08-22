"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { navLabelClass, navRowClass } from "./navRow";

const LABEL = "יציאה";

/**
 * Sign-out, pinned to the bottom of the sidebar and shaped like a nav row (a
 * door glyph plus its label) rather than a topbar button — leaving so it sits
 * with the rest of the account chrome instead of competing with page content.
 * On the resting icon rail the label is only visually hidden — hovering the
 * rail expands it and brings the label back, so no tooltip stands in for it.
 */
export function SignOutButton({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/auth/sign-out", { method: "POST" });
      router.push("/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy || undefined}
      className={navRowClass({ collapsed, danger: true })}
    >
      {busy ? (
        <Spinner size={20} />
      ) : (
        <Icon name="logout" size={20} className="flex-none" />
      )}
      <span className={navLabelClass(collapsed)}>{LABEL}</span>
    </button>
  );
}
