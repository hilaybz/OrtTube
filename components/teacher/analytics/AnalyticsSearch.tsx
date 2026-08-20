"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedToggle } from "@/components/ui/SegmentedToggle";
import { Pager } from "@/components/ui/Pager";
import { usePagedRpc } from "@/components/ui/usePagedList";
import type { AnalyticsScope, AnalyticsSearchHit } from "@/lib/analytics";

/** Copy per scope: what the reader is picking, and how the field asks for it. */
const SCOPES: {
  value: AnalyticsScope;
  label: string;
  icon: IconName;
  placeholder: string;
  /** Shown when the scope has no entities at all. */
  none: string;
  /** Shown when a query matched nothing. */
  noMatch: string;
}[] = [
  {
    value: "student",
    label: "תלמיד/ה",
    icon: "student",
    placeholder: "שם או אימייל של תלמיד/ה",
    none: "אין עדיין תלמידים בכיתות שלך.",
    noMatch: "לא נמצא/ה תלמיד/ה בשם הזה בכיתות שלך.",
  },
  {
    value: "class",
    label: "כיתה",
    icon: "class",
    placeholder: "שם הכיתה",
    none: "עדיין אין לך כיתות.",
    noMatch: "לא נמצאה כיתה בשם הזה.",
  },
  {
    value: "quiz",
    label: "חידון",
    icon: "quiz",
    placeholder: "שם החידון או שם הסרטון",
    none: "עדיין לא יצרת חידונים.",
    noMatch: "לא נמצא חידון בשם הזה.",
  },
];

/** Keeps the RPC off the keyboard's critical path without an effect-body write. */
function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * The analytics hub's way in: pick a scope, type, choose a result.
 *
 * The scope lives in the URL (`?scope=`) and the chosen entity next to it
 * (`&id=`), so a view is linkable and survives a refresh — that contract is what
 * the class screens link into (`components/teacher/analyticsLinks.ts`).
 * The QUERY deliberately does not: putting it in the URL would turn every
 * keystroke into a server navigation, and nobody wants to bookmark a half-typed
 * name.
 *
 * Every state is a real state — loading dims the previous rows instead of
 * collapsing them, an error explains itself and offers a retry, and "no
 * entities" reads differently from "no match for what you typed", because those
 * need different things from the reader.
 *
 * The result list is keyboard-operable: ArrowDown/ArrowUp walk it (from the
 * search field too, so a reader never has to leave the keyboard), Home/End jump
 * to the ends, and each result is a button, so Enter and Space already work.
 */
export function AnalyticsSearch({
  scope,
  selectedId,
}: {
  scope: AnalyticsScope;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const listRef = useRef<HTMLUListElement>(null);
  const config = SCOPES.find((s) => s.value === scope) ?? SCOPES[0];

  const paged = usePagedRpc<AnalyticsSearchHit>(
    async ({ limit, offset }) => {
      const res = await fetch(
        `/api/analytics/search?scope=${scope}&q=${encodeURIComponent(
          debouncedQuery
        )}&limit=${limit}&offset=${offset}`
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "טעינת תוצאות החיפוש נכשלה");
      }
      return { rows: body.results as AnalyticsSearchHit[], total: body.total };
    },
    { pageSize: 8, resetKey: `${scope}|${debouncedQuery}` }
  );

  const select = useCallback(
    (id: string) => {
      router.push(`/dashboard/analytics?scope=${scope}&id=${encodeURIComponent(id)}`);
    },
    [router, scope]
  );

  function changeScope(next: AnalyticsScope) {
    setQuery("");
    router.replace(`/dashboard/analytics?scope=${next}`);
  }

  /** Move focus between result buttons; `from` -1 enters the list from the field. */
  function focusResult(from: number, delta: number | "first" | "last") {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-result]") ?? []
    );
    if (buttons.length === 0) return;
    const next =
      delta === "first"
        ? 0
        : delta === "last"
          ? buttons.length - 1
          : Math.min(Math.max(from + delta, 0), buttons.length - 1);
    buttons[next]?.focus();
  }

  const showNoResults = !paged.loading && !paged.error && paged.total === 0;

  return (
    <div className="flex flex-col gap-4">
      <SegmentedToggle
        ariaLabel="סוג הישות לניתוח"
        segments={SCOPES.map((s) => ({ value: s.value, label: s.label }))}
        value={scope}
        onChange={changeScope}
      />

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="חיפוש"
            name="analytics-search"
            type="search"
            value={query}
            placeholder={config.placeholder}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                focusResult(-1, "first");
              }
            }}
          />
        </div>
        {query && (
          <IconButton
            name="filterOff"
            label="ניקוי החיפוש"
            onClick={() => setQuery("")}
          />
        )}
      </div>

      {paged.error ? (
        <Alert variant="danger" title="לא ניתן לטעון את תוצאות החיפוש">
          <div className="flex flex-wrap items-center gap-3">
            <span>{paged.error}</span>
            <IconButton name="refresh" label="נסו שוב" onClick={paged.reload} />
          </div>
        </Alert>
      ) : showNoResults ? (
        <p className="py-6 text-center text-sm text-[var(--body-subtle)]">
          {debouncedQuery ? config.noMatch : config.none}
        </p>
      ) : (
        <>
          <ul
            ref={listRef}
            className={`flex flex-col gap-2 transition-opacity ${
              paged.loading ? "opacity-60" : ""
            }`}
            onKeyDown={(e) => {
              const buttons = Array.from(
                listRef.current?.querySelectorAll<HTMLButtonElement>("[data-result]") ??
                  []
              );
              const current = buttons.findIndex((b) => b === document.activeElement);
              if (current < 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                focusResult(current, 1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                focusResult(current, -1);
              } else if (e.key === "Home") {
                e.preventDefault();
                focusResult(current, "first");
              } else if (e.key === "End") {
                e.preventDefault();
                focusResult(current, "last");
              }
            }}
          >
            {paged.slice.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  data-result
                  aria-current={hit.id === selectedId ? "true" : undefined}
                  onClick={() => select(hit.id)}
                  className={`glass flex w-full items-center gap-3 p-3.5 text-start transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                    hit.id === selectedId ? "ring-1 ring-[var(--brand)]" : ""
                  }`}
                >
                  <Icon
                    name={config.icon}
                    size={18}
                    className="flex-none text-[var(--body-subtle)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[var(--heading)]">
                      {hit.name ?? "ללא שם"}
                    </span>
                    <span className="block truncate text-xs text-[var(--body-subtle)]">
                      {describeHit(scope, hit)}
                    </span>
                  </span>
                  <Icon
                    name="chevronLeft"
                    size={16}
                    className="flex-none text-[var(--body-subtle)]"
                  />
                </button>
              </li>
            ))}
          </ul>

          {paged.loading && paged.slice.length === 0 && (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--body-subtle)]">
              <Spinner size={18} />
              טוען תוצאות…
            </p>
          )}

          <Pager {...paged} label="ניווט בין תוצאות החיפוש" />
        </>
      )}
    </div>
  );
}

/** The one-line supporting fact under a hit, per scope. */
function describeHit(scope: AnalyticsScope, hit: AnalyticsSearchHit): string {
  if (scope === "student") {
    const classes = hit.class_names ? ` · ${hit.class_names}` : "";
    return `${hit.email ?? ""}${classes}`;
  }
  if (scope === "class") {
    return `${hit.member_count ?? 0} תלמידים · ${hit.quiz_count ?? 0} חידונים`;
  }
  const video = hit.video_title ? `${hit.video_title} · ` : "";
  return `${video}${hit.question_count ?? 0} שאלות · ${hit.class_count ?? 0} כיתות`;
}
