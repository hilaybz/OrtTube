"use client";
import { Fragment, memo, useMemo } from "react";
import { cn } from "@/components/ui/cn";
import { parseBlock, splitBlocks, type Inline } from "./markdown";

/**
 * Renders the tutor's Markdown subset as React elements — never as HTML. Model
 * output is only ever placed in text positions, so there is nothing to
 * sanitise: an unrecognised construct stays visible as the characters the model
 * wrote.
 */
function InlineRun({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case "strong":
            return (
              <strong key={i} className="font-semibold text-[var(--heading)]">
                {part.text}
              </strong>
            );
          case "em":
            return <em key={i}>{part.text}</em>;
          case "code":
            return (
              <code
                key={i}
                dir="ltr"
                className="rounded-[var(--radius-sm)] bg-[var(--neutral-tertiary)] px-1 py-0.5 font-mono text-[0.85em]"
              >
                {part.text}
              </code>
            );
          case "break":
            return <br key={i} />;
          default:
            // A Fragment, not a span: plain text belongs directly in the block.
            return <Fragment key={i}>{part.text}</Fragment>;
        }
      })}
    </>
  );
}

/**
 * One settled block. Memoized on its raw source — a primitive — so a streaming
 * answer re-parses and re-renders only the block currently being written, and
 * the blocks already on screen are left untouched (no flicker, no re-entry
 * animation, no wasted work per token).
 */
const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  const block = parseBlock(source);
  if (block.kind === "heading") {
    return (
      <p className="font-semibold text-[var(--heading)]">
        <InlineRun parts={block.inline} />
      </p>
    );
  }
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List
        className={cn(
          "flex flex-col gap-1 ps-5",
          block.ordered ? "list-decimal" : "list-disc"
        )}
      >
        {block.items.map((item, i) => (
          <li key={i}>
            <InlineRun parts={item} />
          </li>
        ))}
      </List>
    );
  }
  return (
    <p>
      <InlineRun parts={block.inline} />
    </p>
  );
});

/**
 * The tutor's answer. Each block fades and lifts into place once, on the frame
 * it is inserted (`@starting-style`), which is what makes a streamed answer
 * arrive smoothly: settled blocks never animate again, and the block still
 * being written just grows.
 */
export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {blocks.map((source, i) => (
        <div
          key={i}
          className="transition duration-300 ease-out starting:translate-y-1 starting:opacity-0"
        >
          <MarkdownBlock source={source} />
        </div>
      ))}
    </div>
  );
}
