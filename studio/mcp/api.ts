// The `api` tool: look the Lua API up by word, from the same file the studio's autocomplete reads (src/lib/nova-api.json, kept
// in step with the real API by crates/nova-runtime/tests/api_docs.rs).

import apiData from "../src/lib/nova-api.json";

interface Entry {
  name: string;
  kind: string;
  signature: string;
  doc: string;
  group: string;
}
const documented = apiData as Entry[];

const fields =
  "Fields every entity has (set them in nova.entity { ... } or on self): x, y, z, vx, vy, vz (velocity: the engine adds it to the position every step, so do not also move by it yourself; `velocity = false` in the spec makes these three your own), sx, sy (scale), flip_x, flip_y (mirror the picture, not the hitbox), angle (radians; positive turns clockwise on the screen, since y points down), alpha, visible, tint { r, g, b } (multiplies the picture's colours: it darkens or colours, never brightens, so it cannot flash a sprite white), depth (bigger is further back), frame, id, name (from the scene file). " +
  "These names are the engine's: do not reuse them for something else (nor rx, ry, rz, quat, parts, clip, clip_time, clip_speed, shader, blend, or a name starting with _). Read by the engine from the class: sprite, model, tags, hitbox { x, y, w, h } or { r }, pivot { 0.5, 1 }, screen (draw in the UI layer), anim (a sheet's animation to start with), settings, velocity; and for the 2D effects shadow (true: a soft shadow under the feet), light ({ radius, color, intensity }: a light that goes with it), blend (\"add\": its sprite adds light) and lit (false: not darkened by nova.ambient2d).";

/// Finds API entries by words. Every word must be found in an entry (in its name, signature, group or description); names count most.
export function searchApi(query: string, limit = 12, group?: string): string {
  const words = query.toLowerCase().split(/[^a-z0-9_.:]+/).filter(Boolean);
  const entries: Entry[] = [...documented, { name: "entity fields", kind: "fields", signature: "entity fields (self.x, self.depth, ...)", doc: fields, group: "Scenes and entities" }];
  const pool = group ? entries.filter((e) => e.group.toLowerCase().includes(group.toLowerCase())) : entries;
  if (!words.length && group) {
    // one group, whole: every entry's signature and what it does in a sentence (the full text of one: ask for it by name)
    const own = pool.filter((x) => x.kind !== "fields");
    if (!own.length) return `there is no group "${group}". Groups: ${[...new Set(documented.map((e) => e.group))].join(", ")}`;
    const first = (doc: string) => {
      const m = /^(.*?[.:;])(\s|$)/.exec(doc);
      const s = m && m[1]!.length >= 30 ? m[1]! : doc;
      return s.length > 220 ? `${s.slice(0, 217)}...` : s;
    };
    const byGroup = new Map<string, Entry[]>();
    for (const e of own) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
    const lines: string[] = [];
    for (const [g, list] of byGroup) {
      lines.push(`${g} (${list.length}): each entry's signature and what it does; the whole text of one with { "query": "its name" }`);
      for (const e of list.slice(0, Math.max(limit, 200))) lines.push(`  ${e.signature}\n      ${first(e.doc)}`);
    }
    if (/entit|scene/i.test([...byGroup.keys()].join(" "))) lines.push(fields);
    return lines.join("\n");
  }
  if (!words.length) {
    const groups = new Map<string, string[]>();
    for (const e of pool.filter((x) => x.kind !== "fields")) groups.set(e.group, [...(groups.get(e.group) ?? []), e.kind === "method" ? `self:${e.name}` : e.name]);
    const lines = [`the Lua API has ${documented.length} entries. Search with words ("camera", "tilemap solid", "sound volume"), or list one group with \`group\`.`];
    for (const [g, names] of groups) lines.push(group ? `${g}:\n  ${names.join("\n  ")}` : `${g} (${names.length}): ${names.slice(0, 14).join(", ")}${names.length > 14 ? ", ..." : ""}`);
    lines.push(fields);
    return lines.join("\n");
  }
  const scored = pool
    .map((e) => {
      // (what its namespace is about counts as part of an entry: nova.cam.follow is found by "camera")
      const parents = entries.filter((p) => p.kind === "namespace" && e.name.startsWith(`${p.name}.`)).map((p) => p.doc).join(" ");
      const name = e.name.toLowerCase(), sig = e.signature.toLowerCase(), doc = `${e.doc} ${parents}`.toLowerCase(), grp = e.group.toLowerCase();
      let score = 0;
      for (const w of words) {
        const last = name.split(".").pop()!;
        if (name === w || last === w || `nova.${w}` === name) score += 100;
        else if (name.includes(w)) score += 40;
        else if (sig.includes(w)) score += 15;
        else if (grp.includes(w)) score += 8;
        else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(doc)) score += 5;
        else if (doc.includes(w)) score += 2;
        else return { e, score: 0 };
      }
      return { e, score: score - (e.kind === "namespace" ? 3 : 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  if (!scored.length) {
    // nothing has every word: say what each word alone finds
    const each = words.map((w) => `${w}: ${entries.filter((e) => e.name.toLowerCase().includes(w)).slice(0, 8).map((e) => e.name).join(", ") || "nothing"}`);
    return `nothing in the Lua API matches all of "${query}". By word:\n  ${each.join("\n  ")}\nGroups: ${[...new Set(entries.map((e) => e.group))].join(", ")}`;
  }
  const shown = scored.slice(0, Math.max(1, limit));
  const out = shown.map(({ e }) => `${e.signature}\n  [${e.group}] ${e.doc}`);
  if (scored.length > shown.length) out.push(`... and ${scored.length - shown.length} more: ${scored.slice(shown.length, shown.length + 30).map((s) => (s.e.kind === "method" ? `self:${s.e.name}` : s.e.name)).join(", ")}`);

  return out.join("\n");
}
