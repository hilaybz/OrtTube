/**
 * `QuestionListItem` — extracted out of `QuizEditor.tsx` (backlog 1.3) so the
 * read-only quiz preview renders through the exact same component. The one
 * behavioral branch the extraction introduces: `onEdit`/`onDelete` are
 * optional, and their buttons must not render at all when omitted, not just
 * be disabled — a preview must never show edit affordances for a quiz the
 * viewer doesn't own.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QuestionListItem } from "@/components/teacher/editor/QuestionListItem";
import type { AuthorQuestion } from "@/lib/quizAuthor";

const QUESTION: AuthorQuestion = {
  id: "q1",
  kind: "single",
  position_seconds: 90,
  order_index: 0,
  prompt: "מה נכון?",
  explanation: "כי ככה זה עובד.",
  options: [
    { id: "o1", is_correct: true, order_index: 0, text: "אלף" },
    { id: "o2", is_correct: false, order_index: 1, text: "בית" },
  ],
};

function renderInList(ui: React.ReactElement) {
  return render(<ul>{ui}</ul>);
}

describe("QuestionListItem", () => {
  it("renders the prompt, options with correctness, and explanation", () => {
    renderInList(<QuestionListItem question={QUESTION} active={false} />);
    expect(screen.getByText("מה נכון?")).toBeInTheDocument();
    expect(screen.getByText("אלף")).toBeInTheDocument();
    expect(screen.getByText("בית")).toBeInTheDocument();
    expect(screen.getByText(/כי ככה זה עובד/)).toBeInTheDocument();
  });

  it("renders no edit/delete buttons when the callbacks are omitted (read-only)", () => {
    renderInList(<QuestionListItem question={QUESTION} active={false} />);
    expect(screen.queryByRole("button", { name: "עריכה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקה" })).not.toBeInTheDocument();
  });

  it("renders and wires the edit/delete buttons when the callbacks are supplied", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderInList(
      <QuestionListItem
        question={QUESTION}
        active={false}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "עריכה" }));
    await userEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("omits the explanation line when there is none", () => {
    renderInList(
      <QuestionListItem question={{ ...QUESTION, explanation: null }} active={false} />
    );
    expect(screen.queryByText(/הסבר:/)).not.toBeInTheDocument();
  });
});
