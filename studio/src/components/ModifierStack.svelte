<script lang="ts">
  // The list of modifiers on a mesh: add, show/hide, reorder, remove, apply and edit each one's settings.
  import { DEFORMS, MAX_MODIFIERS, MODIFIER_LABELS, MODIFIER_TYPES, MOD_AXES, newModifier, type DeformKind, type ModAxis, type Modifier, type ModifierType } from "../lib/modifiers";

  let { mods, onchange, onapply }: { mods: Modifier[]; onchange: (next: Modifier[]) => void; onapply: (index: number) => void } = $props();

  const set = (i: number, change: Partial<Modifier>) => onchange(mods.map((m, k) => (k === i ? ({ ...m, ...change } as Modifier) : m)));
  const num = (raw: string, fallback: number) => {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= mods.length) return;
    const next = [...mods];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onchange(next);
  }
  let adding = $state<ModifierType | "">("");
  function add() {
    if (!adding) return;
    onchange([...mods, newModifier(adding)]);
    adding = "";
  }
  const vec = (m: { offset?: [number, number, number]; relative?: [number, number, number] }, key: "offset" | "relative") => m[key] ?? [0, 0, 0];
</script>

<div class="stack">
  {#each mods as m, i (i)}
    <section class="mod" class:off={m.show === false}>
      <header>
        <button class="eye" class:on={m.show !== false} title={m.show === false ? "Hidden in the editor: click to show" : "Shown in the editor: click to hide"} aria-label={`show ${MODIFIER_LABELS[m.type]} in the editor`} onclick={() => set(i, { show: m.show === false ? undefined : false })}>{m.show === false ? "◌" : "◉"}</button>
        <button class="eye" class:on={m.render !== false} title={m.render === false ? "Left out of the exported .glb: click to include" : "Included in the exported .glb: click to leave out"} aria-label={`export ${MODIFIER_LABELS[m.type]}`} onclick={() => set(i, { render: m.render === false ? undefined : false })}>{m.render === false ? "▫" : "▣"}</button>
        <strong>{MODIFIER_LABELS[m.type]}</strong>
        <span class="grow"></span>
        <button title="Up in the list (runs earlier)" aria-label="move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
        <button title="Down in the list (runs later)" aria-label="move down" disabled={i === mods.length - 1} onclick={() => move(i, 1)}>↓</button>
        <button title={i === 0 ? "Bakes this modifier into the mesh itself" : "Bakes this modifier and the ones above it into the mesh itself"} onclick={() => onapply(i)}>Apply</button>
        <button class="danger" title="Remove this modifier" aria-label={`remove ${MODIFIER_LABELS[m.type]}`} onclick={() => onchange(mods.filter((_, k) => k !== i))}>✕</button>
      </header>
      {#if m.type === "mirror"}
        <div class="grid">
          <label>Axis
            <select value={m.axis} onchange={(e) => set(i, { axis: e.currentTarget.value as ModAxis })}>{#each MOD_AXES as a (a)}<option value={a}>{a.toUpperCase()}</option>{/each}</select>
          </label>
          <label title="Where the mirror plane is along the axis">Centre <input type="number" step="0.5" value={m.center ?? 0} onchange={(e) => set(i, { center: num(e.currentTarget.value, 0) })} /></label>
          <label title="Points this close to their own reflection become one, closing the seam">Merge <input type="number" step="0.01" min="0" value={m.merge ?? 0.01} onchange={(e) => set(i, { merge: Math.max(0, num(e.currentTarget.value, 0.01)) })} /></label>
          <label class="check" title="Points near the plane are held exactly on it"><input type="checkbox" checked={m.clip !== false} onchange={(e) => set(i, { clip: e.currentTarget.checked })} /> Clipping</label>
        </div>
      {:else if m.type === "subsurf"}
        <div class="grid">
          <label title="How many times the editor rounds the shape off">Editor level <input type="number" min="0" max="4" step="1" value={m.levels ?? 1} onchange={(e) => set(i, { levels: Math.max(0, Math.min(4, Math.round(num(e.currentTarget.value, 1)))) })} /></label>
          <label title="How many times the exported .glb is rounded off">Export level <input type="number" min="0" max="4" step="1" value={m.renderLevels ?? 2} onchange={(e) => set(i, { renderLevels: Math.max(0, Math.min(4, Math.round(num(e.currentTarget.value, 2)))) })} /></label>
          <label class="check"><input type="checkbox" checked={m.smooth !== false} onchange={(e) => set(i, { smooth: e.currentTarget.checked })} /> Smooth shading</label>
        </div>
      {:else if m.type === "bevel"}
        <div class="grid">
          <label title="How far the rounding reaches into each face">Width <input type="number" min="0" step="0.25" value={m.width ?? 1} onchange={(e) => set(i, { width: Math.max(0, num(e.currentTarget.value, 1)) })} /></label>
          <label title="Steps across the rounding: 1 is a flat cut">Segments <input type="number" min="1" max="16" step="1" value={m.segments ?? 2} onchange={(e) => set(i, { segments: Math.max(1, Math.min(16, Math.round(num(e.currentTarget.value, 2)))) })} /></label>
          <label title="Only edges where the faces meet at least this sharply (degrees) are rounded">Angle ° <input type="number" min="0" max="180" step="5" value={m.angle ?? 30} onchange={(e) => set(i, { angle: Math.max(0, Math.min(180, num(e.currentTarget.value, 30))) })} /></label>
        </div>
      {:else if m.type === "solidify"}
        <div class="grid">
          <label title="How thick the wall is">Thickness <input type="number" step="0.25" value={m.thickness ?? 1} onchange={(e) => set(i, { thickness: num(e.currentTarget.value, 1) })} /></label>
          <label title="-1 grows inwards from the surface, 1 outwards, 0 both ways">Offset <input type="number" min="-1" max="1" step="0.5" value={m.offset ?? -1} onchange={(e) => set(i, { offset: Math.max(-1, Math.min(1, num(e.currentTarget.value, -1))) })} /></label>
          <label class="check" title="Keeps the wall the same thickness round corners"><input type="checkbox" checked={m.even !== false} onchange={(e) => set(i, { even: e.currentTarget.checked })} /> Even thickness</label>
        </div>
      {:else if m.type === "revolve"}
        <p class="dim small">Spins the mesh's points, in order, as a profile: distance from the axis, then position along it.</p>
        <div class="grid">
          <label>Axis
            <select value={m.axis ?? "y"} onchange={(e) => set(i, { axis: e.currentTarget.value as ModAxis })}>{#each MOD_AXES as a (a)}<option value={a}>{a.toUpperCase()}</option>{/each}</select>
          </label>
          <label title="Steps round the turn">Segments <input type="number" min="2" max="128" step="1" value={m.segments ?? 24} onchange={(e) => set(i, { segments: Math.max(2, Math.min(128, Math.round(num(e.currentTarget.value, 24)))) })} /></label>
          <label title="How far it turns, degrees; 360 is all the way round">Angle ° <input type="number" min="1" max="360" step="15" value={m.angle ?? 360} onchange={(e) => set(i, { angle: Math.max(1, Math.min(360, num(e.currentTarget.value, 360))) })} /></label>
          <label title="Corners of the profile sharper than this stay crisp">Sharp ° <input type="number" min="0" max="180" step="5" value={m.sharp ?? 40} onchange={(e) => set(i, { sharp: Math.max(0, Math.min(180, num(e.currentTarget.value, 40))) })} /></label>
          <label class="check" title="Join the last point back to the first"><input type="checkbox" checked={!!m.closed} onchange={(e) => set(i, { closed: e.currentTarget.checked })} /> Closed profile</label>
          <label class="check" title="Turn the faces inside out"><input type="checkbox" checked={!!m.flip} onchange={(e) => set(i, { flip: e.currentTarget.checked })} /> Flip</label>
        </div>
      {:else if m.type === "weld"}
        <div class="grid">
          <label title="Points closer than this are joined">Distance <input type="number" min="0" step="0.01" value={m.distance ?? 0.01} onchange={(e) => set(i, { distance: Math.max(0, num(e.currentTarget.value, 0.01)) })} /></label>
        </div>
      {:else if m.type === "triangulate"}
        <p class="dim small">Cuts every face into triangles, so the exported model has exactly what the game draws.</p>
      {:else if m.type === "decimate"}
        <div class="grid">
          <label title="About the share of points kept">Keep <input type="number" min="0.05" max="1" step="0.05" value={m.ratio ?? 0.5} onchange={(e) => set(i, { ratio: Math.max(0.05, Math.min(1, num(e.currentTarget.value, 0.5))) })} /></label>
        </div>
      {:else if m.type === "displace"}
        <div class="grid">
          <label title="How far the surface moves in and out">Amount <input type="number" step="0.1" value={m.amount ?? 0.5} onchange={(e) => set(i, { amount: num(e.currentTarget.value, 0.5) })} /></label>
          <label title="The size of the bumps, in units">Size <input type="number" min="0.1" step="0.5" value={m.scale ?? 4} onchange={(e) => set(i, { scale: Math.max(0.1, num(e.currentTarget.value, 4)) })} /></label>
          <label title="A different number gives a different pattern">Seed <input type="number" min="1" step="1" value={m.seed ?? 1} onchange={(e) => set(i, { seed: Math.max(1, Math.round(num(e.currentTarget.value, 1))) })} /></label>
        </div>
      {:else if m.type === "deform"}
        <div class="grid">
          <label>Kind
            <select value={m.kind ?? "bend"} onchange={(e) => set(i, { kind: e.currentTarget.value as DeformKind })}>{#each DEFORMS as d (d)}<option value={d}>{d}</option>{/each}</select>
          </label>
          <label>Along
            <select value={m.axis ?? "y"} onchange={(e) => set(i, { axis: e.currentTarget.value as ModAxis })}>{#each MOD_AXES as a (a)}<option value={a}>{a.toUpperCase()}</option>{/each}</select>
          </label>
          <label title="Degrees for bend and twist; a fraction for taper (-1 to 1); units for stretch">Amount <input type="number" step="5" value={m.amount ?? 45} onchange={(e) => set(i, { amount: num(e.currentTarget.value, 45) })} /></label>
        </div>
      {:else if m.type === "smooth"}
        <div class="grid">
          <label title="How far each pass moves the points towards their neighbours">Factor <input type="number" min="0.1" max="1" step="0.1" value={m.factor ?? 0.5} onchange={(e) => set(i, { factor: Math.max(0.1, Math.min(1, num(e.currentTarget.value, 0.5))) })} /></label>
          <label title="How many passes">Passes <input type="number" min="1" max="20" step="1" value={m.passes ?? 2} onchange={(e) => set(i, { passes: Math.max(1, Math.min(20, Math.round(num(e.currentTarget.value, 2)))) })} /></label>
        </div>
      {:else if m.type === "curve"}
        <div class="grid">
          <label title="Which of the mesh's directions is laid along the curve">Along
            <select value={m.axis ?? "x"} onchange={(e) => set(i, { axis: e.currentTarget.value as ModAxis })}>{#each MOD_AXES as a (a)}<option value={a}>{a.toUpperCase()}</option>{/each}</select>
          </label>
          <button onclick={() => set(i, { points: [...(m.points ?? []), [...((m.points ?? [])[(m.points ?? []).length - 1] ?? [0, 0, 0])] as [number, number, number]].slice(0, 16) })} disabled={(m.points?.length ?? 0) >= 16}>＋ Point</button>
        </div>
        {#each m.points ?? [] as pt, pi (pi)}
          <div class="vecs">
            <span class="dim small">{pi + 1}</span>
            {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" aria-label={`curve point ${pi + 1} ${"xyz"[a]}`} value={pt[a]} onchange={(e) => { const list = (m.points ?? []).map((q) => [...q]) as [number, number, number][]; list[pi]![a] = num(e.currentTarget.value, 0); set(i, { points: list }); }} />{/each}
            <button class="ghost" aria-label="Remove curve point {pi + 1}" disabled={(m.points?.length ?? 0) <= 2} onclick={() => set(i, { points: (m.points ?? []).filter((_, k) => k !== pi) })}>✕</button>
          </div>
        {/each}
        <p class="dim small">A smooth path through these points; the mesh is laid along it from the first point. Needs a mesh with some length along that direction.</p>
      {:else if m.type === "remesh"}
        <div class="grid">
          <label title="The side of each cube, in units: smaller is finer and has many more faces">Cube size <input type="number" min="0.1" step="0.5" value={m.voxel ?? 2} onchange={(e) => set(i, { voxel: Math.max(0.01, num(e.currentTarget.value, 2)) })} /></label>
        </div>
        <p class="dim small">Rebuilds a closed solid out of cubes (at most 64 across). Add a Smooth after it to round it.</p>
      {:else if m.type === "boolean"}
        <div class="grid">
          <label>Do
            <select value={m.operation ?? "difference"} onchange={(e) => set(i, { operation: e.currentTarget.value as "union" | "difference" | "intersect" })}><option value="difference">cut it out</option><option value="union">add it</option><option value="intersect">keep only where both are</option></select>
          </label>
          <label>With a
            <select value={m.shape ?? "box"} onchange={(e) => set(i, { shape: e.currentTarget.value as "box" | "cylinder" | "sphere" })}><option value="box">box</option><option value="cylinder">cylinder (along Y)</option><option value="sphere">sphere</option></select>
          </label>
        </div>
        <div class="vecs">
          <span class="dim small">Centre</span>
          {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" aria-label={`cutter centre ${"xyz"[a]}`} value={(m.at ?? [0, 0, 0])[a]} onchange={(e) => { const v = [...(m.at ?? [0, 0, 0])] as [number, number, number]; v[a] = num(e.currentTarget.value, 0); set(i, { at: v }); }} />{/each}
          <span class="dim small">Size</span>
          {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" min="0.1" aria-label={`cutter size ${"xyz"[a]}`} value={(m.size ?? [8, 8, 8])[a]} onchange={(e) => { const v = [...(m.size ?? [8, 8, 8])] as [number, number, number]; v[a] = Math.max(0.1, num(e.currentTarget.value, 8)); set(i, { size: v }); }} />{/each}
        </div>
        <p class="dim small">The shape must be a closed solid. The cutter is only a shape to carve with: it is not drawn.</p>
      {:else if m.type === "wireframe"}
        <div class="grid">
          <label title="How thick each bar is, in units">Thickness <input type="number" min="0.05" step="0.1" value={m.thickness ?? 0.5} onchange={(e) => set(i, { thickness: Math.max(0.001, num(e.currentTarget.value, 0.5)) })} /></label>
        </div>
        <p class="dim small">Every edge becomes a bar and the faces go: a frame of the mesh.</p>
      {:else if m.type === "shrinkwrap"}
        <div class="grid">
          <label>Onto
            <select value={m.kind ?? "sphere"} onchange={(e) => set(i, { kind: e.currentTarget.value as "sphere" | "cylinder" | "plane" })}><option value="sphere">a sphere</option><option value="cylinder">a cylinder</option><option value="plane">a plane</option></select>
          </label>
          <label title="The cylinder's axis, or the direction the plane faces">Axis
            <select value={m.axis ?? "y"} onchange={(e) => set(i, { axis: e.currentTarget.value as ModAxis })}>{#each MOD_AXES as a (a)}<option value={a}>{a.toUpperCase()}</option>{/each}</select>
          </label>
          <label title="0 leaves the mesh as it is; 1 puts every point on the shape">Amount <input type="number" min="0" max="1" step="0.1" value={m.factor ?? 1} onchange={(e) => set(i, { factor: Math.max(0, Math.min(1, num(e.currentTarget.value, 1))) })} /></label>
          {#if (m.kind ?? "sphere") !== "plane"}<label title="0 uses the average distance of the points">Radius <input type="number" min="0" step="0.5" value={m.radius ?? 0} onchange={(e) => set(i, { radius: Math.max(0, num(e.currentTarget.value, 0)) })} /></label>{/if}
        </div>
      {:else if m.type === "lattice"}
        <p class="dim small">Move the corners of the box round the mesh; the points follow. Low is the small end of an axis, high the large end.</p>
        <div class="vecs">
          {#each [0, 1, 2, 3, 4, 5, 6, 7] as k (k)}
            <span class="dim small" title="x {k & 1 ? 'high' : 'low'}, y {k & 2 ? 'high' : 'low'}, z {k & 4 ? 'high' : 'low'}">{k & 1 ? "X+" : "X−"}{k & 2 ? "Y+" : "Y−"}{k & 4 ? "Z+" : "Z−"}</span>
            {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" aria-label={`corner ${k} ${"xyz"[a]}`} value={(m.corners ?? [])[k]?.[a] ?? 0} onchange={(e) => { const c = Array.from({ length: 8 }, (_, j) => [...((m.corners ?? [])[j] ?? [0, 0, 0])]) as [number, number, number][]; c[k]![a] = num(e.currentTarget.value, 0); set(i, { corners: c as never }); }} />{/each}
          {/each}
        </div>
      {:else if m.type === "array"}
        <div class="grid">
          <label>Count <input type="number" min="1" max="64" step="1" value={m.count ?? 2} onchange={(e) => set(i, { count: Math.max(1, Math.min(64, Math.round(num(e.currentTarget.value, 2)))) })} /></label>
          <label title="Joins points of neighbouring copies closer than this (0 is off)">Merge <input type="number" min="0" step="0.01" value={m.merge ?? 0} onchange={(e) => set(i, { merge: Math.max(0, num(e.currentTarget.value, 0)) })} /></label>
        </div>
        <div class="vecs">
          <span class="dim small">Distance</span>
          {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" aria-label={`offset ${"xyz"[a]}`} value={vec(m, "offset")[a]} onchange={(e) => { const v = [...vec(m, "offset")] as [number, number, number]; v[a] = num(e.currentTarget.value, 0); set(i, { offset: v }); }} />{/each}
          <span class="dim small" title="Extra gap as a fraction of the mesh's own size">× size</span>
          {#each [0, 1, 2] as a (a)}<input type="number" step="0.1" aria-label={`relative ${"xyz"[a]}`} value={vec(m, "relative")[a]} onchange={(e) => { const v = [...vec(m, "relative")] as [number, number, number]; v[a] = num(e.currentTarget.value, 0); set(i, { relative: v }); }} />{/each}
        </div>
      {/if}
    </section>
  {/each}
  <div class="row">
    <select bind:value={adding} aria-label="Add a modifier" onchange={add} disabled={mods.length >= MAX_MODIFIERS}>
      <option value="">＋ Add modifier…</option>
      {#each MODIFIER_TYPES as t (t)}<option value={t}>{MODIFIER_LABELS[t]}</option>{/each}
    </select>
  </div>
</div>

<style>
  .stack { display: flex; flex-direction: column; gap: 6px; }
  .mod { border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px 6px; display: flex; flex-direction: column; gap: 4px; background: var(--panel-2); }
  .mod.off { opacity: 0.6; }
  header { display: flex; align-items: center; gap: 3px; }
  header strong { font-size: 12px; margin-left: 2px; }
  header button { padding: 0 5px; min-width: 22px; height: 22px; font-size: 11px; }
  .eye { background: transparent; border-color: transparent; font-size: 14px; opacity: 0.55; }
  .eye.on { opacity: 1; color: var(--accent); }
  .grow { flex: 1; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; }
  .grid label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dim); min-width: 0; }
  .grid input[type="number"], .vecs input { min-width: 0; padding: 2px 4px; }
  .grid .check { flex-direction: row; align-items: center; gap: 4px; }
  .vecs { display: grid; grid-template-columns: auto 1fr 1fr 1fr; gap: 3px 4px; align-items: center; }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
  select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; }
  .small { font-size: 11px; }
</style>
