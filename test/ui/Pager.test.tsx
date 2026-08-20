import { render, renderHook, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { Pager } from "@/components/ui/Pager";
import { usePagedList, usePagedRpc } from "@/components/ui/usePagedList";

describe("Pager", () => {
  const props = { page: 1, pageCount: 3, total: 25, pageSize: 10 };

  it("reads out the visible range and disables the edges", () => {
    const { rerender } = render(<Pager {...props} page={0} onPageChange={() => {}} />);
    expect(screen.getByText(/מתוך 25/)).toHaveTextContent("1–10 מתוך 25");
    expect(screen.getByRole("button", { name: "העמוד הקודם" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "העמוד הבא" })).toBeEnabled();

    rerender(<Pager {...props} page={2} onPageChange={() => {}} />);
    expect(screen.getByText(/מתוך 25/)).toHaveTextContent("21–25 מתוך 25");
    expect(screen.getByRole("button", { name: "העמוד הבא" })).toBeDisabled();
  });

  it("steps the page in both directions", async () => {
    const onPageChange = vi.fn();
    render(<Pager {...props} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole("button", { name: "העמוד הבא" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    await userEvent.click(screen.getByRole("button", { name: "העמוד הקודם" }));
    expect(onPageChange).toHaveBeenLastCalledWith(0);
  });

  it("renders nothing for a list that fits on one page", () => {
    const { container } = render(
      <Pager page={0} pageCount={1} total={4} pageSize={10} onPageChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("usePagedList", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);

  it("slices the current page and steps through", () => {
    const { result } = renderHook(() => usePagedList(items, { pageSize: 10 }));
    expect(result.current.slice).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.current.pageCount).toBe(3);

    act(() => result.current.onPageChange(2));
    expect(result.current.slice).toEqual([20, 21, 22, 23, 24]);
  });

  it("clamps to a page that still exists when the list shrinks", () => {
    const { result, rerender } = renderHook(
      ({ list }: { list: number[] }) => usePagedList(list, { pageSize: 10 }),
      { initialProps: { list: items } }
    );
    act(() => result.current.onPageChange(2));
    rerender({ list: items.slice(0, 12) });
    expect(result.current.page).toBe(1);
    expect(result.current.slice).toEqual([10, 11]);
  });

  it("returns to the first page when the reset key changes", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => usePagedList(items, { pageSize: 10, resetKey: key }),
      { initialProps: { key: "a" } }
    );
    act(() => result.current.onPageChange(2));
    rerender({ key: "b" });
    expect(result.current.page).toBe(0);
  });
});

describe("usePagedRpc", () => {
  it("requests one window at a time and exposes the server total", async () => {
    const load = vi.fn(async ({ offset }: { limit: number; offset: number }) => ({
      rows: [`row-${offset}`],
      total: 30,
    }));
    const { result } = renderHook(() => usePagedRpc(load, { pageSize: 10 }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(load).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(result.current.slice).toEqual(["row-0"]);
    expect(result.current.pageCount).toBe(3);

    act(() => result.current.onPageChange(1));
    await waitFor(() => expect(result.current.slice).toEqual(["row-10"]));
    expect(load).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });
  });

  it("surfaces a failed load as an error state", async () => {
    const load = vi.fn(async () => {
      throw new Error("אין הרשאה");
    });
    const { result } = renderHook(() => usePagedRpc(load, { pageSize: 10 }));

    await waitFor(() => expect(result.current.error).toBe("אין הרשאה"));
    expect(result.current.slice).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
