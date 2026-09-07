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
  source: "authored",
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
    expect(screen.queryByRole("button", { name: "עריכת השאלה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מחיקת השאלה" })).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "עריכת השאלה" }));
    await userEvent.click(screen.getByRole("button", { name: "מחיקת השאלה" }));
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
