import type { ApiEntry } from "./completions";

/// Entries matching every word of the query, best first: names first, then signatures, then the explanation.
export function searchApi(query: string, entries: ApiEntry[], limit = 40): ApiEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: ApiEntry; score: number }[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const signature = entry.signature.toLowerCase();
    const doc = `${entry.doc} ${entry.group}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const short = name.slice(name.lastIndexOf(".") + 1);
      if (name === w || short === w) score += 100;
      else if (short.startsWith(w) || name.startsWith(w)) score += 60;
      else if (name.includes(w)) score += 40;
      else if (signature.includes(w)) score += 15;
      else if (doc.includes(w)) score += 5;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ entry, score: score - name.length * 0.01 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.entry);
}

/// Entries by group, in the order groups first appear.
export function byGroup(entries: ApiEntry[]): [string, ApiEntry[]][] {
  const map = new Map<string, ApiEntry[]>();
  for (const e of entries) map.set(e.group, [...(map.get(e.group) ?? []), e]);
  return [...map];
}
