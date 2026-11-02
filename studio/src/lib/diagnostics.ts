import type { Diagnostic } from "./types";

export interface Marker {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
}

/// Problems grouped by project file; problems that name no file are under "".
export function byFile(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const key = d.file ?? "";
    const list = map.get(key);
    if (list) list.push(d);
    else map.set(key, [d]);
  }
  return map;
}

/// Editor underlines for one file: each problem covers its line (trimmed of indentation), or the
/// whole first line when the checker gave no line. Lines past the end clamp to the last line.
export function markersFor(text: string, diagnostics: Diagnostic[]): Marker[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return diagnostics.map((d) => {
    const index = Math.min(Math.max((d.line ?? 1) - 1, 0), starts.length - 1);
    const lineStart = starts[index]!;
    const lineEnd = index + 1 < starts.length ? starts[index + 1]! - 1 : text.length;
    const line = text.slice(lineStart, lineEnd);
    const indent = line.length - line.trimStart().length;
    const from = lineStart + (indent < line.length ? indent : 0);
    return { from, to: Math.max(from, lineEnd), severity: d.severity, message: d.place ? `${d.place}: ${d.message}` : d.message };
  });
}

export function summary(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  if (!diagnostics.length) return "No problems";
  const parts = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}
