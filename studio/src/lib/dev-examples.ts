// Development only (never in a production build): fills the browser preview's in-memory project with the text files of a shipped
// example, to try the editors on a real project: `await __loadExample("pine-ridge-rally")` in the browser console.
import type { Api } from "./types";

const files = import.meta.glob("../../../examples/*/**/*.{lua,json}", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

export async function loadExample(api: Api, name: string): Promise<number> {
  let n = 0;
  for (const [path, load] of Object.entries(files)) {
    const marker = `/examples/${name}/`;
    const at = path.indexOf(marker);
    if (at < 0) continue;
    const rel = path.slice(at + marker.length);
    const text = await load();
    try {
      await api.writeFile(rel, text);
    } catch {
      await api.createFile(rel, text);
    }
    n++;
  }
  return n;
}
