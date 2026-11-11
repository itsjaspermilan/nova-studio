// Fuzzy file search for Quick Open (Cmd/Ctrl-P): the letters typed must appear in the path in that order, not next to each other. Matches at the start of a name or word,
// in a row, and in the file's own name (not its folders) score higher, and shorter paths win ties.

export interface FuzzyHit {
  path: string;
  score: number;
  /// Indices into `path` of the letters that matched, for showing them.
  at: number[];
}

const isBoundary = (path: string, i: number) => i === 0 || /[/._\- ]/.test(path[i - 1]!) || (path[i]! >= "A" && path[i]! <= "Z" && path[i - 1]! >= "a" && path[i - 1]! <= "z");

/// The best way the query's letters appear in the path, or null. (Greedy from the file name first, which is what people type.)
export function fuzzyScore(path: string, query: string): FuzzyHit | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return { path, score: 0, at: [] };
  const lower = path.toLowerCase();
  const nameStart = path.lastIndexOf("/") + 1;
  let best: FuzzyHit | null = null;
  // try the match beginning at each place the first letter occurs, keep the best
  for (let start = lower.indexOf(q[0]!); start >= 0; start = lower.indexOf(q[0]!, start + 1)) {
    const at: number[] = [];
    let i = start;
    let score = 0;
    let run = 0;
    for (const ch of q) {
      const j = lower.indexOf(ch, i);
      if (j < 0) {
        at.length = 0;
        break;
      }
      run = at.length && j === at[at.length - 1]! + 1 ? run + 1 : 0;
      score += 1 + run * 3 + (isBoundary(path, j) ? 6 : 0) + (j >= nameStart ? 4 : 0);
      at.push(j);
      i = j + 1;
    }
    if (at.length !== q.length) break;
    // the whole query inside the file name is worth a lot, and a name that starts with it more
    if (at[0]! >= nameStart) score += 10;
    if (path.slice(nameStart).toLowerCase().startsWith(q)) score += 20;
    score -= (at[at.length - 1]! - at[0]!) * 0.5 + path.length * 0.05;
    if (!best || score > best.score) best = { path, score, at: [...at] };
  }
  return best;
}

/// The paths that match, best first (all of them in the order given when the query is empty), at most `limit`.
export function fuzzyFind(paths: string[], query: string, limit = 50): FuzzyHit[] {
  if (!query.trim()) return paths.slice(0, limit).map((path) => ({ path, score: 0, at: [] }));
  const hits: FuzzyHit[] = [];
  for (const p of paths) {
    const h = fuzzyScore(p, query);
    if (h) hits.push(h);
  }
  return hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path)).slice(0, limit);
}
