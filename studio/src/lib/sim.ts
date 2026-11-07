// The simulation harness: run a recorded input script headless several times, each time with other options, and read the
// lines the game prints into a table. Nothing here knows about any one game: a script, a pattern and column names are all it needs.

/// A choice with several values to try, such as `car`: Redline, Cab. In the script, `{{car}}` is replaced by each value in turn.
export interface SimOption {
  name: string;
  values: string[];
}

export interface SimSetup {
  /// The input script's path in the project (JSON, see docs/project-format.md).
  script: string;
  frames: number;
  options: SimOption[];
  /// How many times each combination runs (useful when a game uses chance).
  repeat: number;
  /// A regular expression matched against every line the game prints; its groups are the columns.
  pattern: string;
  /// A name for each group of the pattern, in order.
  columns: string[];
}

export interface SimRun {
  /// Which value each option had.
  values: Record<string, string>;
  /// 1-based, for `repeat`.
  attempt: number;
}

export const MAX_RUNS = 500;

/// Every combination of the options' values, each `repeat` times; an empty option list is a single run.
export function expandRuns(options: SimOption[], repeat: number): SimRun[] {
  const used = options.filter((o) => o.name.trim() && o.values.length);
  let combos: Record<string, string>[] = [{}];
  for (const o of used) combos = combos.flatMap((c) => o.values.map((v) => ({ ...c, [o.name.trim()]: v })));
  const runs: SimRun[] = [];
  const times = Math.max(1, Math.floor(repeat) || 1);
  for (const values of combos) for (let attempt = 1; attempt <= times; attempt++) runs.push({ values, attempt });
  return runs;
}

/// The script text for one run: `{{name}}` becomes the run's value of that option. A `{{name}}` with no such option is an error,
/// so a typo does not quietly run the wrong thing.
export function fillScript(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_ -]+?)\s*\}\}/g, (_all, name: string) => {
    if (!(name in values)) throw new Error(`the script uses {{${name}}} but there is no option called "${name}"`);
    return values[name]!;
  });
}

/// The pattern as a regular expression, or why it is not one.
export function compilePattern(pattern: string): { ok: true; re: RegExp } | { ok: false; error: string } {
  if (!pattern.trim()) return { ok: false, error: "Say which lines to keep, for example: lap (\\d+): ([0-9.]+)" };
  try {
    return { ok: true, re: new RegExp(pattern) };
  } catch (e) {
    return { ok: false, error: `That pattern is not valid: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/// The groups of a pattern in each matching line (the whole match if the pattern has no groups).
export function matchLines(log: string[], re: RegExp): string[][] {
  const rows: string[][] = [];
  for (const line of log) {
    const m = re.exec(line);
    if (m) rows.push(m.length > 1 ? m.slice(1).map((g) => g ?? "") : [m[0]]);
  }
  return rows;
}

export interface SimTable {
  head: string[];
  rows: string[][];
}

/// One row for each matching line of each run: the option values first, then the groups.
export function buildTable(setup: Pick<SimSetup, "options" | "columns" | "repeat">, results: { run: SimRun; rows: string[][] }[]): SimTable {
  const used = setup.options.filter((o) => o.name.trim() && o.values.length).map((o) => o.name.trim());
  const width = Math.max(0, ...results.flatMap((r) => r.rows.map((row) => row.length)));
  const names = Array.from({ length: width }, (_, i) => setup.columns[i]?.trim() || `column ${i + 1}`);
  const withAttempt = setup.repeat > 1;
  const head = [...used, ...(withAttempt ? ["run"] : []), ...names];
  const rows = results.flatMap(({ run, rows }) =>
    rows.map((row) => [...used.map((n) => run.values[n] ?? ""), ...(withAttempt ? [String(run.attempt)] : []), ...Array.from({ length: width }, (_, i) => row[i] ?? "")]),
  );
  return { head, rows };
}

/// The table as comma-separated text (for a spreadsheet).
export function toCsv(table: SimTable): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [table.head, ...table.rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/// `{{name}}` placeholders a script mentions (to offer them as options).
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([A-Za-z0-9_ -]+?)\s*\}\}/g)].map((m) => m[1]!))];
}
