// A tiny markup for lesson text: blank-line separated blocks, `- ` lists, `> ` tips, `code` and **bold**.
// Parsed into plain data and drawn by Svelte (never as HTML), so lesson text cannot inject anything.

export interface Span {
  text: string;
  code?: boolean;
  bold?: boolean;
}
export type Block = { kind: "p"; spans: Span[] } | { kind: "tip"; spans: Span[] } | { kind: "list"; items: Span[][] };

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], code: true });
    else spans.push({ text: m[2]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

export function parseBody(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.trim().split(/\n\s*\n/)) {
    const lines = raw.split("\n").map((l) => l.trimEnd());
    if (lines.every((l) => l.startsWith("- "))) blocks.push({ kind: "list", items: lines.map((l) => parseInline(l.slice(2))) });
    else if (lines.every((l) => l.startsWith("> "))) blocks.push({ kind: "tip", spans: parseInline(lines.map((l) => l.slice(2)).join(" ")) });
    else blocks.push({ kind: "p", spans: parseInline(lines.map((l) => l.trim()).join(" ")) });
  }
  return blocks.filter((b) => b.kind === "list" || b.spans.length > 0);
}
