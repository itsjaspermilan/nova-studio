<script lang="ts">
  // Reference pictures for modelling: pick a picture from the project, say which view it faces, and it stands in the 3D view to trace over.
  // They are kept with this model on this computer (not in the model file).
  import { VIEW_LABELS, VIEW_NAMES } from "../lib/view-presets";
  import { newReference, type Reference } from "../lib/model-reference";
  import { studio } from "../lib/store.svelte";

  let { refs, onchange }: { refs: Reference[]; onchange: (next: Reference[]) => void } = $props();
  const pictures = $derived(studio.files.filter((f) => !f.dir && /\.(png|jpe?g)$/i.test(f.path) && !f.path.endsWith(".texture.png")).map((f) => f.path));
  let adding = $state("");
  const set = (i: number, change: Partial<Reference>) => onchange(refs.map((r, k) => (k === i ? { ...r, ...change } : r)));
  const num = (raw: string, d: number) => (Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : d);
</script>

<div class="refs">
  <h4>Reference pictures</h4>
  {#each refs as r, i (i)}
    <div class="ref">
      <div class="head">
        <label class="check" title="Show it"><input type="checkbox" checked={r.visible} onchange={(e) => set(i, { visible: e.currentTarget.checked })} /> <span class="name">{r.path.slice(r.path.lastIndexOf("/") + 1)}</span></label>
        <button class="ghost danger" aria-label="Remove {r.path}" onclick={() => onchange(refs.filter((_, k) => k !== i))}>✕</button>
      </div>
      <div class="grid">
        <label>Facing <select value={r.view} onchange={(e) => set(i, { view: e.currentTarget.value as Reference["view"] })}>{#each VIEW_NAMES as v (v)}<option value={v}>{VIEW_LABELS[v]}</option>{/each}</select></label>
        <label title="How tall it is, in model units">Height <input type="number" min="0.1" step="1" value={r.height} onchange={(e) => set(i, { height: Math.max(0.1, num(e.currentTarget.value, r.height)) })} /></label>
        <label title="Slide it right, as seen from its view">Right <input type="number" step="1" value={r.x} onchange={(e) => set(i, { x: num(e.currentTarget.value, r.x) })} /></label>
        <label title="Slide it up">Up <input type="number" step="1" value={r.y} onchange={(e) => set(i, { y: num(e.currentTarget.value, r.y) })} /></label>
        <label title="How far toward the camera of its view: below zero puts it behind the model">Depth <input type="number" step="0.5" value={r.depth} onchange={(e) => set(i, { depth: num(e.currentTarget.value, r.depth) })} /></label>
        <label title="How solid it is">Opacity <input type="range" min="0.05" max="1" step="0.05" value={r.opacity} oninput={(e) => set(i, { opacity: Number(e.currentTarget.value) })} /></label>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" checked={r.flip} onchange={(e) => set(i, { flip: e.currentTarget.checked })} /> Flip left–right</label>
        <label class="check" title="Draw it over the model instead of behind it"><input type="checkbox" checked={r.front} onchange={(e) => set(i, { front: e.currentTarget.checked })} /> On top</label>
      </div>
    </div>
  {/each}
  <div class="row">
    <select bind:value={adding} aria-label="Add a reference picture" onchange={() => { if (adding) onchange([...refs, newReference(adding)]); adding = ""; }} disabled={refs.length >= 6 || !pictures.length}>
      <option value="">{pictures.length ? "＋ Add a picture…" : "No pictures in the project"}</option>
      {#each pictures as p (p)}<option value={p}>{p}</option>{/each}
    </select>
  </div>
  <p class="dim small">A blueprint to trace: put a side picture in the project, add it here, and turn the view to Right. Not saved in the model file.</p>
</div>

<style>
  .refs { display: flex; flex-direction: column; gap: 6px; }
  h4 { margin: 8px 0 0; }
  .ref { border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column; gap: 4px; background: var(--panel-2); }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .name { font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; }
  .grid label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); min-width: 0; }
  .grid input, .grid select { min-width: 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .small { font-size: 11px; margin: 0; }
</style>
