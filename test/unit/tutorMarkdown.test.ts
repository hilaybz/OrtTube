/**
 * The tutor answer's Markdown subset. The bug this parser exists for: the model
 * writes `**חשוב**` and the student saw the asterisks. Everything here is pure
 * — no React, no DOM — and the renderer only ever places these nodes in text
 * positions, so nothing in a model's answer can become markup.
 */
import { describe, it, expect } from "vitest";
import { parseInline, parseBlock, splitBlocks } from "@/components/student/markdown";

describe("parseInline", () => {
  it("turns **bold** into a strong run instead of literal asterisks", () => {
    expect(parseInline("זה **חשוב** מאוד")).toEqual([
      { kind: "text", text: "זה " },
      { kind: "strong", text: "חשוב" },
      { kind: "text", text: " מאוד" },
    ]);
  });

  it("handles __bold__, *italics* and _italics_", () => {
    expect(parseInline("__א__ *ב* _ג_")).toEqual([
      { kind: "strong", text: "א" },
      { kind: "text", text: " " },
      { kind: "em", text: "ב" },
      { kind: "text", text: " " },
      { kind: "em", text: "ג" },
    ]);
  });

  it("keeps inline code verbatim, asterisks included", () => {
    expect(parseInline("use `a ** b` here")).toEqual([
      { kind: "text", text: "use " },
      { kind: "code", text: "a ** b" },
      { kind: "text", text: " here" },
    ]);
  });

  it("leaves underscores inside a word alone", () => {
    expect(parseInline("some_var_name")).toEqual([
      { kind: "text", text: "some_var_name" },
    ]);
  });

  it("leaves an unterminated marker literal — mid-stream text must not flicker", () => {
    expect(parseInline("זה **חש")).toEqual([{ kind: "text", text: "זה **חש" }]);
  });

  it("turns a newline inside a paragraph into a break", () => {
    expect(parseInline("שורה\nשנייה")).toEqual([
      { kind: "text", text: "שורה" },
      { kind: "break" },
      { kind: "text", text: "שנייה" },
    ]);
  });
});

describe("splitBlocks", () => {
  it("splits paragraphs on blank lines", () => {
    expect(splitBlocks("ראשון\nהמשך\n\nשני")).toEqual(["ראשון\nהמשך", "שני"]);
  });

  it("keeps a run of list items as one block, separate from prose around it", () => {
    expect(splitBlocks("לפני\n- א\n- ב\nאחרי")).toEqual(["לפני", "- א\n- ב", "אחרי"]);
  });

  it("gives a heading its own block", () => {
    expect(splitBlocks("## כותרת\nגוף")).toEqual(["## כותרת", "גוף"]);
  });

  it("ignores trailing blank lines a stream leaves behind", () => {
    expect(splitBlocks("אחד\n\n\n")).toEqual(["אחד"]);
  });
});

describe("parseBlock", () => {
  it("reads a bullet list, stripping the markers", () => {
    expect(parseBlock("- א\n* ב")).toEqual({
      kind: "list",
      ordered: false,
      items: [[{ kind: "text", text: "א" }], [{ kind: "text", text: "ב" }]],
    });
  });

  it("reads a numbered list as ordered", () => {
    const block = parseBlock("1. ראשון\n2. שני");
    expect(block).toEqual({
      kind: "list",
      ordered: true,
      items: [
        [{ kind: "text", text: "ראשון" }],
        [{ kind: "text", text: "שני" }],
      ],
    });
  });

  it("reads a heading without its hashes", () => {
    expect(parseBlock("### נושא")).toEqual({
      kind: "heading",
      inline: [{ kind: "text", text: "נושא" }],
    });
  });

  it("falls back to a paragraph, emphasis parsed", () => {
    expect(parseBlock("שים **לב**")).toEqual({
      kind: "p",
      inline: [
        { kind: "text", text: "שים " },
        { kind: "strong", text: "לב" },
      ],
    });
  });

  it("does not mistake a leading *italic* for a bullet", () => {
    expect(parseBlock("*חשוב* להבין")).toEqual({
      kind: "p",
      inline: [
        { kind: "em", text: "חשוב" },
        { kind: "text", text: " להבין" },
      ],
    });
  });
});
