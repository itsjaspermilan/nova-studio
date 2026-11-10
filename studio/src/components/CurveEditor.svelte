<script lang="ts">
  // The curve (graph) editor of an animation: for one part and one property (position, rotation or size) the x, y and z values are drawn against time, and each key
  // is a handle: drag it up or down to change the value of that axis, and sideways to move it in time. Double-click empty space to add a key at that time.
  import { findTrack, removeKey, setKey } from "../lib/model-anim";
  import { curvePoints, dragKey, pickKey, rangeOf, timeAt, trackValue, valueAt, xOf, yOf, type GraphBox } from "../lib/model-graph";
  import { PROPS, type Clip, type ModelDoc, type Prop, type Track, type Vec3 } from "../lib/model-doc";

  let { doc, clipIndex, part, time, oncommit, ontime }: { doc: ModelDoc; clipIndex: number; part: string[]; time: number; oncommit: (next: ModelDoc, keep: boolean, label?: string) => void; ontime: (t: number) => void } = $props();

  let prop = $state<Prop>("position");
  const clip = $derived(doc.clips?.[clipIndex] as Clip | undefined);
  const track = $derived(clip ? findTrack(clip, part, prop) : undefined);
  const W = 520;
  const H = 180;
  const range = $derived(rangeOf(track, prop === "rotation" ? 45 : 2));
  const box: GraphBox = $derived({ w: W, h: H, duration: clip?.duration ?? 1, lo: range.lo, hi: range.hi, pad: 14 });
  const COLORS = ["#ff6b6b", "#6fcf8e", "#5aa9ff"];
  let drag: { axis: 0 | 1 | 2; index: number; start: Track; moved: boolean } | null = $state(null);
  let svg: SVGSVGElement | undefined = $state();

  const local = (e: PointerEvent) => {
    const r = svg!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
  };
  function down(e: PointerEvent) {
    if (!track || !clip) return;
    const [x, y] = local(e);
    for (const axis of [0, 1, 2] as const) {
      const index = pickKey(track, axis, box, x, y);
      if (index >= 0) {
        drag = { axis, index, start: track, moved: false };
        svg!.setPointerCapture(e.pointerId);
        ontime(track.keys[index]!.t);
        return;
      }
    }
    ontime(timeAt(box, x));
  }
  function move(e: PointerEvent) {
    if (!drag || !clip) return;
    const [x, y] = local(e);
    const next = dragKey(drag.start, drag.index, drag.axis, timeAt(box, x), valueAt(box, y), clip.duration);
    const doc2: ModelDoc = JSON.parse(JSON.stringify(doc));
    const c = doc2.clips![clipIndex]!;
    const at = c.tracks.findIndex((t) => t.prop === prop && t.part.join("/") === part.join("/"));
    if (at < 0) return;
    c.tracks[at] = next;
    oncommit(doc2, drag.moved, "Drag a key");
    drag.moved = true;
  }
  function up() {
    drag = null;
  }
  function add(e: MouseEvent) {
    if (!clip) return;
    const r = svg!.getBoundingClientRect();
    const t = timeAt(box, ((e.clientX - r.left) / r.width) * W);
    const base: Vec3 = prop === "scale" ? [1, 1, 1] : [0, 0, 0];
    const value = (track ? ([0, 1, 2] as const).map((a) => trackValue(track, a, t)) : base) as Vec3;
    oncommit(setKey(doc, clipIndex, part, prop, t, value), false, "Add a key");
  }
  function removeAt(index: number) {
    if (!track) return;
    oncommit(removeKey(doc, clipIndex, part, prop, track.keys[index]!.t), false, "Delete a key");
  }
  const path = (axis: 0 | 1 | 2) =>
    track && clip ? curvePoints(clip, track, (t) => trackValue(track, axis, t)).map(([t, v], i) => `${i ? "L" : "M"}${xOf(box, t).toFixed(1)},${yOf(box, v).toFixed(1)}`).join(" ") : "";
</script>

<div class="curves" role="group" aria-label="Curves of {part.join('/')}">
  <div class="bar">
    <span class="seg" role="group" aria-label="Property">
      {#each PROPS as p (p)}<button class:on={prop === p} onclick={() => (prop = p)}>{p === "scale" ? "size" : p}</button>{/each}
    </span>
    <span class="dim small"><b style="color:{COLORS[0]}">x</b> <b style="color:{COLORS[1]}">y</b> <b style="color:{COLORS[2]}">z</b> · drag a dot, double-click to add a key, right-click a dot to delete it</span>
  </div>
  {#if !track}
    <p class="dim small">{part.join(" / ")} has no {prop === "scale" ? "size" : prop} keys in this animation yet: double-click the picture to add one, or set a key with the inspector.</p>
  {/if}
  <svg bind:this={svg} viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Curve editor" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} ondblclick={add} oncontextmenu={(e) => e.preventDefault()}>
    <rect x="0" y="0" width={W} height={H} class="bg" />
    {#if range.lo < 0 && range.hi > 0}<line x1="0" x2={W} y1={yOf(box, 0)} y2={yOf(box, 0)} class="zero" />{/if}
    <line x1={xOf(box, time)} x2={xOf(box, time)} y1="0" y2={H} class="now" />
    {#each [0, 1, 2] as a (a)}
      {#if track}<path d={path(a as 0 | 1 | 2)} fill="none" stroke={COLORS[a]} stroke-width="1.6" />{/if}
      {#each track?.keys ?? [] as k, i (i)}
        <circle cx={xOf(box, k.t)} cy={yOf(box, k.value[a as 0 | 1 | 2])} r="4.5" fill={COLORS[a]} stroke="#111" role="presentation" oncontextmenu={(e) => { e.stopPropagation(); e.preventDefault(); removeAt(i); }} />
      {/each}
    {/each}
  </svg>
</div>

<style>
  .curves { padding: 4px 10px 6px; border-top: 1px solid var(--line); background: var(--panel); }
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
  .seg { display: inline-flex; } .seg button { border-radius: 0; } .seg button:first-child { border-radius: 6px 0 0 6px; } .seg button:last-child { border-radius: 0 6px 6px 0; } .seg button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  svg { max-height: 200px; cursor: crosshair; touch-action: none; display: block; }
  .bg { fill: #15171c; }
  .zero { stroke: #3a4050; stroke-dasharray: 3 3; }
  .now { stroke: #ffd166; stroke-width: 1; }
  .small { font-size: 11px; }
</style>
