import { type JSX, For } from "solid-js";

// ─── Inline parser ─────────────────────────────────────────────────────────
// **bold**   → primary text (bright)
// *italic*   → accent color
// _italic_   → accent color
// `code`     → inline code span

function parseInline(text: string): JSX.Element {
  const segments: JSX.Element[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push(<span>{text.slice(cursor, match.index)}</span>);
    }
    if (match[1] !== undefined) {
      segments.push(<span class="md-bold">{match[1]}</span>);
    } else if (match[2] !== undefined) {
      segments.push(<span class="md-italic">{match[2]}</span>);
    } else if (match[3] !== undefined) {
      segments.push(<span class="md-italic">{match[3]}</span>);
    } else if (match[4] !== undefined) {
      segments.push(<span class="md-code">{match[4]}</span>);
    }
    cursor = re.lastIndex;
  }

  if (cursor < text.length) {
    segments.push(<span>{text.slice(cursor)}</span>);
  }

  return <>{segments}</>;
}

// ─── Line parser ───────────────────────────────────────────────────────────

function parseLine(line: string): JSX.Element {
  // Headings
  if (line.startsWith("### ")) {
    return <div class="md-heading">{parseInline(line.slice(4))}</div>;
  }
  if (line.startsWith("## ")) {
    return <div class="md-heading">{parseInline(line.slice(3))}</div>;
  }
  if (line.startsWith("# ")) {
    return <div class="md-heading">{parseInline(line.slice(2))}</div>;
  }

  // Unordered bullet
  if (/^[-*] /.test(line)) {
    return (
      <div class="md-list-item">
        <span class="md-bullet" />
        <span>{parseInline(line.slice(2))}</span>
      </div>
    );
  }

  // Ordered list
  const orderedMatch = line.match(/^(\d+)\. /);
  if (orderedMatch) {
    return (
      <div class="md-list-item">
        <span class="md-list-num">{orderedMatch[1]}.</span>
        <span>{parseInline(line.slice(orderedMatch[0].length))}</span>
      </div>
    );
  }

  // Empty line
  if (line === "") {
    return <div class="md-gap" />;
  }

  // Plain text with inline formatting
  return <div>{parseInline(line)}</div>;
}

// ─── Public component ──────────────────────────────────────────────────────

interface Props {
  content: string;
  class?: string;
}

export default function MarkdownText(props: Props) {
  const lines = () => props.content.split("\n");

  return (
    <div class={`md-root ${props.class ?? ""}`}>
      <For each={lines()}>{(line) => parseLine(line)}</For>
    </div>
  );
}
