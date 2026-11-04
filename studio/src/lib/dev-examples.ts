// Development only (never in a production build): fills the browser preview's in-memory project with the text files of a shipped
// example, to try the editors on a real project: `await __loadExample("pine-ridge-rally")` in the browser console.
import type { Api } from "./types";
import { toBase64 } from "./wav";

const files = import.meta.glob("../../../examples/*/**/*.{lua,json}", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const models = import.meta.glob("../../../examples/*/**/*.glb", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

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
  // the .glb models too, so that a scene's models that have no .model.json can be drawn
  for (const [path, load] of Object.entries(models)) {
    const marker = `/examples/${name}/`;
    const at = path.indexOf(marker);
    if (at < 0) continue;
    const bytes = new Uint8Array(await (await fetch(await load())).arrayBuffer());
    await api.writeModel(path.slice(at + marker.length), `data:model/gltf-binary;base64,${toBase64(bytes)}`).catch(() => undefined);
    n++;
  }
  return n;
}
