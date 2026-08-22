"use client";
import { cn } from "./cn";
import { IconButton } from "./IconButton";

/**
 * Offset pager for any list that can grow: previous / next plus a page readout
 * ("עמוד 1 מתוך 2"). RTL-correct — "previous" sits at the inline start and its
 * chevron points there — with disabled edges and labelled controls.
 *
 * The readout names the page rather than the row range it happens to contain:
 * where the reader *is* and how much is left is what the control is for, and
 * "מציג 1–12 מתוך 13" made a reader do arithmetic to learn there was one more
 * page. `total` is therefore not a prop — `<Pager {...paged} />` still works,
 * since a spread carries the extra key harmlessly.
 *
 * Built to be fed straight from `usePagedList` / `usePagedRpc`:
 * `<Pager {...paged} />`. It renders nothing for a list that fits on one page,
 * so a caller never has to guard it.
 *
 * `pageSizeOptions` + `setPageSize` (which `usePagedList` already returns) add
 * the rows-per-page control; leave them out for a fixed page size.
 */
export function Pager({
  page,
  pageCount,
  pageSize,
  onPageChange,
  setPageSize,
  pageSizeOptions,
  label = "ניווט בין עמודים",
  className,
}: {
  /** 0-based. */
  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  setPageSize?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  /** Names what is being paged, for screen readers: "ניווט בין תלמידים". */
  label?: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  const showSizes = !!setPageSize && !!pageSizeOptions?.length;

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-[var(--body)]",
        className
      )}
    >
      <div className="flex items-center gap-1">
        <IconButton
          name="chevronRight"
          label="העמוד הקודם"
          size="sm"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        />
        {/* Each number is isolated so the bidi algorithm cannot swap the two
            around inside the RTL sentence. */}
        <span aria-live="polite" className="px-1 tabular-nums">
          עמוד <bdi dir="ltr">{page + 1}</bdi> מתוך <bdi dir="ltr">{pageCount}</bdi>
        </span>
        <IconButton
          name="chevronLeft"
          label="העמוד הבא"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        />
      </div>

      {showSizes && (
        <label className="flex items-center gap-2 text-xs">
          <span>שורות בעמוד</span>
          <select
            aria-label="מספר שורות בעמוד"
            value={pageSize}
            onChange={(e) => setPageSize?.(Number(e.target.value))}
            className="rounded-[var(--radius-sm)] border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-1 text-xs text-[var(--heading)]"
          >
            {pageSizeOptions?.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
