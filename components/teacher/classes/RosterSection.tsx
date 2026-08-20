"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { matchesText } from "@/lib/libraryFilters";
import type { ClassRoster, RosterMember, RosterInvite } from "@/lib/classes";
import { formatDate } from "./labels";
import { studentAnalyticsHref } from "../analyticsLinks";

const PAGE_SIZES = [10, 25, 50] as const;

/**
 * The class roster, read-only: who is in the class, searchable and paged, each
 * student a link to their analytics.
 *
 * Membership is deliberately not editable here. A teacher does not enrol or
 * un-enrol anyone — the school owns the roster (the `add_student_to_class` /
 * `remove_student_from_class` RPCs and their routes still exist for that
 * path), so this screen answers "who is in my class and how are they doing"
 * and nothing else. Pending invites are shown for the same reason: they
 * explain why a student a teacher expects isn't listed yet.
 *
 * Search runs over the whole roster and paging over what survives it, so a
 * query is never hidden behind a page boundary.
 */
export function RosterSection({ roster }: { roster: ClassRoster }) {
  const { members, invites } = roster;
  const [query, setQuery] = useState("");

  const visibleMembers = useMemo(
    () => members.filter((m) => matchesText([m.display_name, m.email], query)),
    [members, query]
  );
  const visibleInvites = useMemo(
    () => invites.filter((i) => matchesText([i.email], query)),
    [invites, query]
  );

  const pagedMembers = usePagedList(visibleMembers, { resetKey: query });
  const pagedInvites = usePagedList(visibleInvites, { resetKey: query });

  const searchable = members.length + invites.length > 5;

  return (
    <div className="flex flex-col gap-6">
      {searchable && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Field
              label="חיפוש תלמיד/ה"
              name="roster-search"
              placeholder="לפי שם או אימייל"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query !== "" && (
            <IconButton
              name="filterOff"
              label="ניקוי החיפוש"
              onClick={() => setQuery("")}
              className="mb-1"
            />
          )}
        </div>
      )}

      <section className="glass p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[var(--heading)]">תלמידים</h3>
          <Badge variant="gray">
            <span className="tabular-nums">{members.length}</span>
          </Badge>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-[var(--body)]">
            עדיין אין תלמידים בכיתה. צירוף תלמידים נעשה על ידי בית הספר.
          </p>
        ) : visibleMembers.length === 0 ? (
          <p className="text-sm text-[var(--body)]">
            אין תלמיד/ה שתואם/ת את החיפוש.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {pagedMembers.slice.map((m) => (
                <MemberRow key={m.student_id} member={m} />
              ))}
            </ul>
            <Pager {...pagedMembers} label="ניווט בין תלמידים" pageSizeOptions={PAGE_SIZES} />
          </>
        )}
      </section>

      {invites.length > 0 && (
        <section className="glass p-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-[var(--heading)]">
              הזמנות ממתינות
            </h3>
            <Badge variant="warning">
              <span className="tabular-nums">{invites.length}</span>
            </Badge>
          </div>
          <p className="mb-3 text-sm text-[var(--body-subtle)]">
            יצטרפו לכיתה אוטומטית עם ההרשמה לאורטיוב.
          </p>
          {visibleInvites.length === 0 ? (
            <p className="text-sm text-[var(--body)]">אין הזמנה שתואמת את החיפוש.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {pagedInvites.slice.map((inv) => (
                  <InviteRow key={inv.email} invite={inv} />
                ))}
              </ul>
              <Pager {...pagedInvites} label="ניווט בין הזמנות" />
            </>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * One student. The whole row is the link — a roster exists to be drilled into,
 * and there is exactly one thing to do with a student here, so a separate
 * "open analytics" control would just be a smaller target for the same action.
 */
function MemberRow({ member }: { member: RosterMember }) {
  const name = member.display_name ?? member.email;
  return (
    <li>
      <Link
        href={studentAnalyticsHref(member.student_id)}
        className="group flex items-center gap-3 rounded-[var(--radius-d)] border border-transparent px-3 py-2.5 transition-colors hover:border-[var(--glass-border-subtle)] hover:bg-[var(--neutral-secondary-soft)]"
      >
        <Avatar name={name} size={36} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-[var(--heading)]">{name}</span>
          {member.display_name && (
            <span className="truncate text-xs text-[var(--body-subtle)]">
              {member.email}
            </span>
          )}
        </span>
        <span className="ms-auto flex flex-none items-center gap-1.5 text-sm font-medium text-[var(--fg-brand)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Icon name="chart" size={16} />
          אנליטיקה
        </span>
      </Link>
    </li>
  );
}

function InviteRow({ invite }: { invite: RosterInvite }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-d)] border border-[var(--glass-border-subtle)] px-3 py-2.5 opacity-75">
      <span className="flex min-w-0 items-center gap-2">
        <Icon name="mail" size={16} className="flex-none text-[var(--body-subtle)]" />
        <span className="truncate text-sm text-[var(--heading)]">{invite.email}</span>
      </span>
      <span className="text-xs tabular-nums text-[var(--body-subtle)]">
        הוזמן/ה {formatDate(invite.created_at)}
      </span>
    </li>
  );
}
