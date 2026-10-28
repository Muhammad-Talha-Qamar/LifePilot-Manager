"use client";

import { cn } from "@/lib/utils";

type Segment =
  | { kind: "paragraph"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] };

function stripListMarker(line: string): string {
  return line
    .replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, "")
    .trimEnd();
}

/** Split assistant plain text into paragraphs and list blocks for clearer scanning. */
export function segmentReply(content: string): Segment[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").trim();
    if (text) segments.push({ kind: "paragraph", text });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    if (list.items.length) segments.push(list);
    list = null;
  };

  for (const line of lines) {
    const ordered = /^\s*\d+[.)]\s+\S/.test(line);
    const unordered = /^\s*[-*•]\s+\S/.test(line);

    if (ordered || unordered) {
      flushParagraph();
      const kind = ordered ? "ol" : "ul";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(stripListMarker(line));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return segments;
}

export function FormattedReply({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  const segments = segmentReply(content);

  return (
    <div className={cn("relative min-w-0 space-y-2.5", className)}>
      {segments.map((segment, index) => {
        if (segment.kind === "paragraph") {
          return (
            <p
              key={`p-${index}`}
              className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-relaxed text-foreground/95 sm:text-[15px]"
            >
              {segment.text}
              {streaming && index === segments.length - 1 && (
                <StreamingCaret />
              )}
            </p>
          );
        }

        if (segment.kind === "ol") {
          const isLast = streaming && index === segments.length - 1;
          return (
            <ol
              key={`ol-${index}`}
              className="list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-foreground/95 marker:text-muted-foreground sm:text-[15px]"
            >
              {segment.items.map((item, itemIndex) => (
                <li key={itemIndex} className="break-words [overflow-wrap:anywhere] pl-0.5">
                  {item}
                  {isLast && itemIndex === segment.items.length - 1 && <StreamingCaret />}
                </li>
              ))}
            </ol>
          );
        }

        const isLast = streaming && index === segments.length - 1;
        return (
          <ul
            key={`ul-${index}`}
            className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-foreground/95 marker:text-muted-foreground sm:text-[15px]"
          >
            {segment.items.map((item, itemIndex) => (
              <li key={itemIndex} className="break-words [overflow-wrap:anywhere] pl-0.5">
                {item}
                {isLast && itemIndex === segment.items.length - 1 && <StreamingCaret />}
              </li>
            ))}
          </ul>
        );
      })}

      {streaming && content.length === 0 && (
        <p className="text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">
          <StreamingCaret />
        </p>
      )}
    </div>
  );
}

function StreamingCaret() {
  return <span className="ai-stream-caret ml-0.5 inline-block align-baseline" aria-hidden />;
}
