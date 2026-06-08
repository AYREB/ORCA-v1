import { ReactNode } from "react";

const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+?\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

const FENCE_PATTERN = /^```(\w*)\s*$/;
const TABLE_SEPARATOR_PATTERN = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

const splitTableRow = (line: string): string[] => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const MarkdownContent = ({ content, className }: MarkdownContentProps) => {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-normal">
        {renderInlineMarkdown(text, `p-${blocks.length}`)}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={`${listType === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
        {listItems.map((item, itemIndex) => (
          <li key={`${blocks.length}-${itemIndex}`}>{renderInlineMarkdown(item, `li-${blocks.length}-${itemIndex}`)}</li>
        ))}
      </Tag>
    );
    listType = null;
    listItems = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block — consume verbatim until the closing fence (or EOF).
    const fence = FENCE_PATTERN.exec(trimmed);
    if (fence) {
      flushParagraph();
      flushList();
      const lang = fence[1];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_PATTERN.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence
      blocks.push(
        <pre
          key={`pre-${blocks.length}`}
          className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[0.8em] leading-relaxed"
        >
          <code className={`font-mono text-foreground${lang ? ` language-${lang}` : ""}`}>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // GFM-style table — header row, separator row (---|---), then data rows.
    if (
      trimmed.startsWith("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_PATTERN.test(lines[i + 1].trim())
    ) {
      flushParagraph();
      flushList();
      const headerCells = splitTableRow(trimmed);
      const tableKey = blocks.length;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`table-${tableKey}`} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-[0.85em]">
            <thead>
              <tr className="bg-muted/40">
                {headerCells.map((cell, cellIndex) => (
                  <th key={`th-${tableKey}-${cellIndex}`} className="border-b border-border px-2.5 py-1.5 font-semibold text-foreground">
                    {renderInlineMarkdown(cell, `th-${tableKey}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${tableKey}-${rowIndex}`} className="odd:bg-transparent even:bg-muted/10">
                  {row.map((cell, cellIndex) => (
                    <td key={`td-${tableKey}-${rowIndex}-${cellIndex}`} className="border-b border-border/50 px-2.5 py-1.5 align-top text-muted-foreground">
                      {renderInlineMarkdown(cell, `td-${tableKey}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      blocks.push(
        <Tag key={`h-${i}`} className="font-semibold text-foreground">
          {renderInlineMarkdown(heading[2], `h-${i}`)}
        </Tag>
      );
      i += 1;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      i += 1;
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      i += 1;
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
    i += 1;
  }

  flushParagraph();
  flushList();

  return <div className={className ?? "space-y-2"}>{blocks}</div>;
};

export default MarkdownContent;
