"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Both hooks derive the visible page rather than correcting it in an effect: the
 * page is stored together with the `resetKey` it was chosen under, so a filter
 * change reads back as page 0 with no extra render, and a page beyond the end of
 * a shrunken list is clamped in the same render that shrinks it.
 */
export const DEFAULT_PAGE_SIZE = 10;

export interface PagedList<T> {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  slice: T[];
  onPageChange: (page: number) => void;
  setPageSize: (size: number) => void;
}

export interface PagedListOptions {
  pageSize?: number;
  /**
   * A primitive whose change should send the reader back to the first page — a
   * search string, a filter value, several of them joined. Paging that survives
   * a filter change lands the reader on an empty page. Compared by identity, so
   * pass a string or a number, not a fresh object.
   */
  resetKey?: unknown;
}

interface Cursor {
  key: unknown;
  page: number;
}

function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function usePagedList<T>(
  items: readonly T[],
  { pageSize: initialPageSize = DEFAULT_PAGE_SIZE, resetKey }: PagedListOptions = {}
): PagedList<T> {
  const [cursor, setCursor] = useState<Cursor>({ key: resetKey, page: 0 });
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const total = items.length;
  const pageCount = pageCountOf(total, pageSize);
  const chosen = Object.is(cursor.key, resetKey) ? cursor.page : 0;
  const page = Math.min(Math.max(chosen, 0), pageCount - 1);

  const slice = useMemo(
    () => items.slice(page * pageSize, page * pageSize + pageSize),
    [items, page, pageSize]
  );

  const onPageChange = useCallback(
    (next: number) => setCursor({ key: resetKey, page: Math.max(next, 0) }),
    [resetKey]
  );
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(Math.max(1, size));
      setCursor({ key: resetKey, page: 0 });
    },
    [resetKey]
  );

  return { page, pageSize, total, pageCount, slice, onPageChange, setPageSize };
}

export interface PagedPage<T> {
  rows: T[];
  total: number;
}

export interface PagedRpc<T> extends PagedList<T> {
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Loaded<T> {
  token: string;
  rows: T[];
  total: number;
  error: string | null;
}

/**
 * already gives back. A response for a window the reader has already left is
 * discarded, so pages resolving out of order cannot flash the wrong rows.
 */
export function usePagedRpc<T>(
  load: (window: { limit: number; offset: number }) => Promise<PagedPage<T>>,
  { pageSize: initialPageSize = DEFAULT_PAGE_SIZE, resetKey }: PagedListOptions = {}
): PagedRpc<T> {
  const [cursor, setCursor] = useState<Cursor>({ key: resetKey, page: 0 });
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  const total = loaded?.total ?? 0;
  const pageCount = pageCountOf(total, pageSize);
  const chosen = Object.is(cursor.key, resetKey) ? cursor.page : 0;
  const page = Math.min(Math.max(chosen, 0), pageCount - 1);
  const offset = page * pageSize;
  // Identifies the window on screen. A settled response is only adopted when it
  // answers the current token, and a new token is what triggers a fetch.
  const token = `${String(resetKey)}|${pageSize}|${offset}|${nonce}`;

  // Latest-ref: `load` is almost always a fresh closure from the caller, so
  // depending on it directly would re-fetch on every parent re-render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef
      .current({ limit: pageSize, offset })
      .then((result) => {
        if (!cancelled) {
          setLoaded({ token, rows: result.rows, total: result.total, error: null });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "שגיאה בטעינה";
        // Keep the last known total: zeroing it would clamp the page to 0 and
        // fire a second doomed request.
        setLoaded((prev) => ({
          token,
          rows: [],
          total: prev?.total ?? 0,
          error: message,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [token, pageSize, offset]);

  const settled = !!loaded && loaded.token === token;
  const onPageChange = useCallback(
    (next: number) => setCursor({ key: resetKey, page: Math.max(next, 0) }),
    [resetKey]
  );
  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(Math.max(1, size));
      setCursor({ key: resetKey, page: 0 });
    },
    [resetKey]
  );
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    page,
    pageSize,
    total,
    pageCount,
    slice: loaded?.rows ?? [],
    onPageChange,
    setPageSize,
    loading: !settled,
    error: loaded && settled ? loaded.error : null,
    reload,
  };
}
