<script lang="ts">
  // More mesh tools for the element being edited: merge and dissolve points, dissolve an edge, triangulate, smooth, move with a soft falloff,
  // spin or screw the picked points, reduce the triangle count, roughen the surface and bend or twist it. Each is one undo step.
  import type { Cube, Vec3 } from "../lib/model-doc";
  import { DEFORMS, FALLOFFS, decimate, displace, dissolveEdge, dissolveVerts, lodChain, mergeVerts, proportionalMove, simpleDeform, smoothVerts, spinChain, triangulate, type DeformKind, type Falloff, type MergeAt } from "../lib/mesh-ops";
  import { statsOf } from "../lib/mesh-stats";

  let { cube, selVerts, selFace, selEdge, onchange, onlods }: {
    cube: Cube;
    selVerts: number[];
    selFace: number | null;
    selEdge: [number, number] | null;
    onchange: (next: Cube, reset?: boolean) => void;
    onlods: (copies: Cube[]) => void;
  } = $props();

  let mergeAt = $state<MergeAt>("centre");
  let smoothBy = $state(0.5);
  let smoothPasses = $state(2);
  let move = $state<Vec3>([0, 1, 0]);
  let radius = $state(4);
  let falloff = $state<Falloff>("smooth");
  let connected = $state(false);
  let axis = $state<0 | 1 | 2>(1);
  let angle = $state(360);
  let steps = $state(12);
  let rise = $state(0);
  let ratio = $state(0.5);
  let amount = $state(0.5);
  let bump = $state(4);
  let seed = $state(1);
  let deform = $state<DeformKind>("bend");
  let deformAxis = $state<0 | 1 | 2>(1);
  let deformBy = $state(45);
  let note = $state("");

  const stats = $derived(statsOf(cube));
  const say = (s: string) => (note = s);
  const picked = $derived(selVerts.length);

  function merge() {
    const r = mergeVerts(cube, selVerts, mergeAt);
    if (!r) return say("Pick at least two points first.");
    onchange(r.cube, true);
    say("Merged.");
  }
  function dissolvePoints() {
    const before = cube.verts?.length ?? 0;
    const next = dissolveVerts(cube, selVerts);
    onchange(next, true);
    say(`Dissolved ${before - (next.verts?.length ?? 0)} point${before - (next.verts?.length ?? 0) === 1 ? "" : "s"}. Points on the border cannot be dissolved.`);
  }
  function dissolveTheEdge() {
    if (!selEdge) return;
    const r = dissolveEdge(cube, selEdge[0], selEdge[1]);
    if (!r) return say("That edge does not have a face on each side.");
    onchange(r, true);
    say("The two faces are one now.");
  }
  function spin() {
    const r = spinChain(cube, selVerts, axis, angle, steps, rise);
    if (!r) return say("Pick two or more points in order along the profile first.");
    onchange(r.cube, true);
    say(`Spun ${selVerts.length} points into ${steps} steps.`);
  }
  function soft() {
    if (!picked) return say("Pick some points first.");
    onchange(proportionalMove(cube, selVerts, move, radius, falloff, connected));
  }
</script>

<div class="meshtools">
  <h4>More tools</h4>
  <div class="row">
    <select bind:value={mergeAt} aria-label="Where merged points meet"><option value="centre">at the centre</option><option value="first">at the first</option><option value="last">at the last</option></select>
    <button onclick={merge} disabled={picked < 2} title="Joins the picked points into one">Merge</button>
    <button onclick={dissolvePoints} disabled={!picked} title="Removes the picked points and joins the faces round them">Dissolve</button>
    <button onclick={dissolveTheEdge} disabled={!selEdge} title="Joins the two faces either side of the picked edge">Dissolve edge</button>
  </div>
  <div class="row">
    <button onclick={() => { onchange(triangulate(cube, selFace !== null ? [selFace] : undefined), true); say("Triangulated."); }} title="Cuts four-sided and bigger faces into triangles (the picked face, or all)">Triangulate{selFace !== null ? " face" : ""}</button>
  </div>
  <div class="row">
    <label class="inline">Smooth <input type="number" min="0.1" max="1" step="0.1" bind:value={smoothBy} /></label>
    <label class="inline">× <input type="number" min="1" max="20" bind:value={smoothPasses} /></label>
    <button onclick={() => onchange(smoothVerts(cube, picked ? selVerts : undefined, smoothBy, smoothPasses))} title="Relaxes the picked points (or all) towards their neighbours; the border stays put">Smooth</button>
  </div>
  <p class="dim small">Move the picked points, and the ones near them less:</p>
  <div class="vec">{#each move as v, i (i)}<input type="number" step="0.5" value={v} aria-label={"xyz"[i] + " move"} onchange={(e) => { move = move.map((m, k) => (k === i ? Number(e.currentTarget.value) : m)) as Vec3; }} />{/each}</div>
  <div class="row">
    <label class="inline">Radius <input type="number" min="0.5" step="0.5" bind:value={radius} /></label>
    <select bind:value={falloff} aria-label="Falloff">{#each FALLOFFS as f (f)}<option value={f}>{f}</option>{/each}</select>
    <label class="check" title="Only points joined by edges follow"><input type="checkbox" bind:checked={connected} /> connected</label>
    <button onclick={soft} disabled={!picked}>Soft move</button>
  </div>
  <p class="dim small">Spin or screw the picked points (in order along a profile):</p>
  <div class="row">
    <select bind:value={axis} aria-label="Axis"><option value={0}>x</option><option value={1}>y</option><option value={2}>z</option></select>
    <label class="inline">° <input type="number" min="-720" max="720" step="15" bind:value={angle} /></label>
    <label class="inline">steps <input type="number" min="1" max="128" bind:value={steps} /></label>
    <label class="inline" title="Moves each step along the axis: a screw">rise <input type="number" step="0.25" bind:value={rise} /></label>
    <button onclick={spin} disabled={picked < 2}>Spin</button>
  </div>
  <p class="dim small">The whole element:</p>
  <div class="row">
    <label class="inline">Keep <input type="number" min="0.05" max="1" step="0.05" bind:value={ratio} /></label>
    <button onclick={() => onchange(decimate(cube, ratio), true)} title="Fewer points: groups of close points become one">Reduce</button>
    <button onclick={() => onlods(lodChain(cube, [0.5, 0.25]).slice(1))} title="Adds two more copies of this element at half and a quarter of the detail, named _lod1 and _lod2">Make LODs</button>
  </div>
  <div class="row">
    <label class="inline">Rough <input type="number" step="0.1" bind:value={amount} /></label>
    <label class="inline">size <input type="number" min="0.1" step="0.5" bind:value={bump} /></label>
    <label class="inline">seed <input type="number" min="1" step="1" bind:value={seed} /></label>
    <button onclick={() => onchange(displace(cube, amount, bump, seed))} title="Pushes the surface in and out in a bumpy pattern">Displace</button>
  </div>
  <div class="row">
    <select bind:value={deform} aria-label="Deform">{#each DEFORMS as d (d)}<option value={d}>{d}</option>{/each}</select>
    <select bind:value={deformAxis} aria-label="Along"><option value={0}>along x</option><option value={1}>along y</option><option value={2}>along z</option></select>
    <label class="inline" title="Degrees for bend and twist; a fraction for taper (-1 to 1); units for stretch">by <input type="number" step="5" bind:value={deformBy} /></label>
    <button onclick={() => onchange(simpleDeform(cube, deform, deformAxis, deformBy))}>Deform</button>
  </div>
  <p class="dim small">{stats.triangles.toLocaleString("en")} triangles · {stats.points} points{stats.openEdges ? ` · ${stats.openEdges} open edges` : ""}{stats.degenerate ? ` · ${stats.degenerate} empty faces` : ""}</p>
  {#if note}<p class="dim small" role="status">{note}</p>{/if}
</div>

<style>
  .meshtools { display: flex; flex-direction: column; gap: 6px; }
  h4 { margin: 8px 0 0; }
  .row { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
  .row input[type="number"] { width: 62px; }
  .vec { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .small { font-size: 11px; }
  .inline { display: inline-flex; gap: 4px; align-items: center; }
</style>
