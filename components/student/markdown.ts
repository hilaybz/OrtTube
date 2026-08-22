/**
 * A deliberately tiny Markdown subset parser for the AI tutor's answers.
 *
 * The model writes light Markdown — bold, italics, inline code, bullet and
 * numbered lists, line breaks — and rendering it literally showed the student
 * raw `**asterisks**`. This produces a structure the renderer turns into React
 * elements, so model output NEVER reaches `dangerouslySetInnerHTML`: anything
 * the parser doesn't recognise stays plain text, and text is escaped by React.
 *
 * Splitting is separated from parsing on purpose. `splitBlocks` returns the raw
 * source of each block, so a streaming answer's already-settled blocks are
 * memoizable on a primitive string and are not re-parsed (or re-rendered) on
 * every arriving token — only the block still being written is.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "break" };

export type Block =
  | { kind: "p"; inline: Inline[] }
  | { kind: "heading"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s{0,3}#{1,6}\s+/;

function isListLine(line: string): boolean {
  return BULLET.test(line) || ORDERED.test(line);
}

/**
 * Cut the answer into block sources: paragraphs, headings, and runs of list
 * items (one block per run, so a list renders as one `<ul>`). A blank line ends
 * whatever block is open.
 */
export function splitBlocks(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let bufIsList = false;

  const flush = () => {
    if (buf.length > 0) blocks.push(buf.join("\n"));
    buf = [];
    bufIsList = false;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (HEADING.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    const list = isListLine(line);
    // A list run and a paragraph never share a block, so switching between
    // them closes the open one.
    if (buf.length > 0 && list !== bufIsList) flush();
    bufIsList = list;
    buf.push(line);
  }
  flush();
  return blocks;
}

/** Parse one block source (as returned by `splitBlocks`). */
export function parseBlock(source: string): Block {
  const lines = source.split("\n");
  if (HEADING.test(lines[0]) && lines.length === 1) {
    return { kind: "heading", inline: parseInline(lines[0].replace(HEADING, "")) };
  }
  if (isListLine(lines[0])) {
    const ordered = ORDERED.test(lines[0]) && !BULLET.test(lines[0]);
    return {
      kind: "list",
      ordered,
      items: lines
        .filter(isListLine)
        .map((line) => parseInline(line.replace(ordered ? ORDERED : BULLET, ""))),
    };
  }
  return { kind: "p", inline: parseInline(source) };
}

// One pass over a line's emphasis markers. Inline code comes first so that
// `**` inside a code span is left alone. `_`/`*` emphasis is single-line by
// design — an unterminated marker (mid-stream, or just prose containing an
// asterisk) simply stays literal text.
const INLINE =
  /`([^`\n]+)`|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

/** `_` must stand at a word boundary, or `snake_case_names` would go italic. */
function isWordChar(ch: string | undefined): boolean {
  return ch != null && /[\p{L}\p{N}_]/u.test(ch);
}

function pushText(out: Inline[], text: string): void {
  if (text === "") return;
  const segments = text.split("\n");
  segments.forEach((segment, i) => {
    if (i > 0) out.push({ kind: "break" });
    if (segment !== "") out.push({ kind: "text", text: segment });
  });
}

/** Emphasis, inline code and hard line breaks inside one block. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(source); m != null; m = INLINE.exec(source)) {
    const [raw, code, strongStars, strongUnderscores, emStar, emUnderscore] = m;
    const underscored = strongUnderscores != null || emUnderscore != null;
    if (
      underscored &&
      (isWordChar(source[m.index - 1]) || isWordChar(source[m.index + raw.length]))
    ) {
      continue; // inside a word — not emphasis
    }
    pushText(out, source.slice(cursor, m.index));
    if (code != null) out.push({ kind: "code", text: code });
    else if (strongStars != null) out.push({ kind: "strong", text: strongStars });
    else if (strongUnderscores != null)
      out.push({ kind: "strong", text: strongUnderscores });
    else if (emStar != null) out.push({ kind: "em", text: emStar });
    else if (emUnderscore != null) out.push({ kind: "em", text: emUnderscore });
    cursor = m.index + raw.length;
  }
  pushText(out, source.slice(cursor));
  return out;
}
