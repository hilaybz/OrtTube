"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { navLabelClass, navRowClass } from "./navRow";

const LABEL = "יציאה";

/**
 * Sign-out, pinned to the bottom of the sidebar and shaped like a nav row (a
 * door glyph plus its label) rather than a topbar button — leaving so it sits
 * with the rest of the account chrome instead of competing with page content.
 * On a collapsed rail the label is visually hidden and a tooltip stands in.
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

  const button = (
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

  return collapsed ? (
    <Tooltip content={LABEL} className="w-full">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
