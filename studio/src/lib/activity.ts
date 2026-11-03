// What an assistant working through the Nova MCP server has done to the project: the server appends one JSON line per tool
// call to `.nova/activity.jsonl` (see `logActivity` in mcp/server.ts) and the Activity panel reads it back.

export interface Activity {
  /// When the call finished, in milliseconds since 1970.
  t: number;
  tool: string;
  /// Project files the call wrote.
  files: string[];
  /// The first line of what the tool answered (or the error).
  note: string;
  error?: boolean;
}

export const ACTIVITY_FILE = ".nova/activity.jsonl";

/// Reads the log: newest first, at most `limit`; a line that is not a call is skipped (a log can be cut off mid-write).
export function parseActivity(text: string | null | undefined, limit = 100): Activity[] {
  const out: Activity[] = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Partial<Activity>;
      if (typeof v.t !== "number" || typeof v.tool !== "string") continue;
      out.push({
        t: v.t,
        tool: v.tool,
        files: Array.isArray(v.files) ? v.files.filter((f): f is string => typeof f === "string") : [],
        note: typeof v.note === "string" ? v.note : "",
        ...(v.error ? { error: true } : {}),
      });
    } catch {
      // not a line we wrote
    }
  }
  return out.reverse().slice(0, limit);
}

/// "just now", "12 s ago", "3 min ago", "2 h ago", "4 days ago".
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/// The tool's name in words: "model_write" is "wrote a model", "check" is "checked the project".
export function toolWords(tool: string): string {
  const known: Record<string, string> = {
    project_create: "created the project", project_info: "looked at the project", read_file: "read a file", write_file: "wrote a file",
    model_write: "wrote a model", model_preview: "looked at a model", sfx_write: "made a sound", song_write: "made a song", sprite_write: "drew a sprite",
    scene_write: "laid out a scene", check: "checked the project", screenshot: "took a screenshot",
  };
  return known[tool] ?? tool.replace(/_/g, " ");
}
