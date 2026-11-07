<script lang="ts">
  import { untrack } from "svelte";
  import {
    ROADS, ROAD_WIDTH, WARN_CLOSE, WARN_RADIUS, MIN_POINTS, addPoint, analyse, callOut, curvatureColour, movePoint, newTrack, parseTrack, pointAt, removePoint,
    roadOf, sceneOf, serializeTrack, setField, trackName, type TrackDoc,
  } from "../lib/track-doc";
  import { studio } from "../lib/store.svelte";

  let { path, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const name = untrack(() => trackName(path));
  const parsed = untrack(() => parseTrack(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: TrackDoc = $state.raw(parsed.ok ? parsed.doc : newTrack());
  let selected: number | null = $state(null);
  const stats = $derived(analyse(doc));

  // ---- undo -----------------------------------------------------------------------------------------------
  const past: TrackDoc[] = [];
  let future: TrackDoc[] = [];
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && past.length > 0);
  const canRedo = $derived(tick >= 0 && future.length > 0);
  function commit(next: TrackDoc, keep = false) {
    if (!keep) {
      past.push(doc);
      if (past.length > 200) past.shift();
      future = [];
    }
    doc = next;
    tick++;
    studio.edit(path, serializeTrack(next));
  }
  const undo = () => {
    const p = past.pop();
    if (!p) return;
    future.push(doc);
    commit(p, true);
    if (selected !== null && selected >= doc.control.length) selected = null;
  };
  const redo = () => {
    const n = future.pop();
    if (!n) return;
    past.push(doc);
    commit(n, true);
  };

  // ---- the map: x is east, z is north (up the screen) ---------------------------------------------------------
  let W = $state(800);
  let H = $state(600);
  let cx = $state(0);
  let cz = $state(0);
  let scale = $state(0.8); // pixels per metre
  const sx = (x: number) => W / 2 + (x - cx) * scale;
  const sy = (z: number) => H / 2 - (z - cz) * scale;
  function fit() {
    const xs = doc.control.map((p) => p[0]), zs = doc.control.map((p) => p[1]);
    if (!xs.length) return;
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    cx = (x0 + x1) / 2;
    cz = (z0 + z1) / 2;
    scale = Math.max(0.05, Math.min(3, Math.min((W - 80) / Math.max(60, x1 - x0), (H - 80) / Math.max(60, z1 - z0))));
  }
  let fitted = false;
  $effect(() => {
    if (!fitted && W > 100 && H > 100) {
      fitted = true;
      untrack(fit);
    }
  });

  let svg: SVGSVGElement | undefined = $state();
  function world(e: { clientX: number; clientY: number }): [number, number] {
    const r = svg!.getBoundingClientRect();
    return [cx + (e.clientX - r.left - W / 2) / scale, cz - (e.clientY - r.top - H / 2) / scale];
  }
  type Drag = { kind: "point"; index: number; moved: boolean } | { kind: "pan"; x: number; y: number; moved: boolean };
  let drag: Drag | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    svg!.setPointerCapture(e.pointerId);
    svg!.focus();
    const [x, z] = world(e);
    const hit = pointAt(doc, x, z, 11 / scale);
    if (hit >= 0) {
      selected = hit;
      drag = { kind: "point", index: hit, moved: false };
    } else drag = { kind: "pan", x: e.clientX, y: e.clientY, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === "point") {
      const [x, z] = world(e);
      // the first movement is one undo step; the rest of the same drag joins it
      commit(movePoint(doc, drag.index, x, z), drag.moved);
      drag.moved = true;
    } else {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      cx -= dx / scale;
      cz += dy / scale;
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  }
  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (d?.kind === "pan" && !d.moved) {
      // a click on empty ground adds a point
      const [x, z] = world(e);
      const r = addPoint(doc, x, z, 14 / scale);
      commit(r.doc);
      selected = r.index;
    }
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, z] = world(e);
    scale = Math.max(0.05, Math.min(6, scale * Math.exp(-e.deltaY * 0.0015)));
    const r = svg!.getBoundingClientRect();
    cx = x - (e.clientX - r.left - W / 2) / scale;
    cz = z + (e.clientY - r.top - H / 2) / scale;
  }
  function remove() {
    if (selected === null) return;
    const next = removePoint(doc, selected);
    if (next === doc) return studio.say("info", "A route needs at least two points.");
    commit(next);
    selected = null;
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === "Escape") selected = null;
  }

  // a grid of round-numbered metres
  const gridStep = $derived([10, 20, 50, 100, 200, 500, 1000].find((s) => s * scale >= 60) ?? 1000);
  const gridLines = $derived.by(() => {
    const out: { v: number; x: boolean }[] = [];
    const [x0, x1] = [cx - W / 2 / scale, cx + W / 2 / scale];
    const [z0, z1] = [cz - H / 2 / scale, cz + H / 2 / scale];
    for (let x = Math.ceil(x0 / gridStep) * gridStep; x <= x1; x += gridStep) out.push({ v: x, x: true });
    for (let z = Math.ceil(z0 / gridStep) * gridStep; z <= z1; z += gridStep) out.push({ v: z, x: false });
    return out;
  });

  const roadColour = $derived(ROADS.find((r) => r.id === doc.road)?.colour ?? "#444");
  const linePath = $derived(stats ? stats.line.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.z).toFixed(1)}`).join(" ") + (doc.open ? "" : " Z") : "");
  // a bar across the road at a point of the route
  const bar = (i: number, half = ROAD_WIDTH / 2 + 2) => {
    const p = stats!.line[i]!;
    return { x1: sx(p.x - p.tz * half), y1: sy(p.z + p.tx * half), x2: sx(p.x + p.tz * half), y2: sy(p.z - p.tx * half), x: sx(p.x), y: sy(p.z) };
  };

  // ---- the scenery panel ------------------------------------------------------------------------------------
  const entities = $derived(studio.files.filter((f) => !f.dir && f.path.startsWith("entities/") && f.path.endsWith(".lua")).map((f) => f.path.slice(9, -4).replaceAll("/", ".")).sort());
  let group: "trees" | "small" | "rock" = $state("trees");
  let filter = $state("");
  const GROUPS = [
    { id: "trees", label: "Trees", hint: "Tall things that line the road." },
    { id: "small", label: "Bushes", hint: "Small things close to the road." },
    { id: "rock", label: "Rocks", hint: "Big things, now and then." },
  ] as const;
  const shown = $derived(entities.filter((e) => e.toLowerCase().includes(filter.trim().toLowerCase())));
  function toggle(kind: string) {
    const list = doc[group];
    commit(setField(doc, group, list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]));
  }
  const number = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const set = <K extends keyof TrackDoc>(key: K, value: TrackDoc[K]) => commit(setField(doc, key, value));

  // ---- making the scene ------------------------------------------------------------------------------------
  let busy = $state(false);
  let result = $state("");
  async function generate() {
    if (!studio.api || busy) return;
    busy = true;
    try {
      result = await studio.api.generateTrack(name, doc);
      const tab = studio.tabs.find((t) => t.path === path);
      if (tab) tab.saved = serializeTrack(doc); // (the track file was written with the scene)
      await studio.refreshFiles();
      await studio.checkExternal(); // an open copy of the scene or the road reloads
      studio.say("info", `Made ${sceneOf(name)} and ${roadOf(name)}.`);
    } catch (e) {
      studio.say("error", String(e));
    } finally {
      busy = false;
    }
  }
  const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
  const mmss = (m: number) => `${Math.round(m)} m`;
</script>

{#if error}
  <div class="bad">
    <p><strong>{path}</strong> is not a track file: {error}</p>
    <button onclick={onjson}>Open as text</button>
  </div>
{:else}
  <div class="track">
    <div class="map">
      <div class="bar">
        <span class="hint dim">Click the ground to add a point · drag a point to move it · select a point and press Delete · scroll to zoom · drag the ground to pan</span>
        <span class="spacer"></span>
        <button class="ghost" onclick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶ Undo</button>
        <button class="ghost" onclick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷ Redo</button>
        <button class="ghost" onclick={remove} disabled={selected === null}>Delete point</button>
        <button class="ghost" onclick={fit}>Fit</button>
        <button class="ghost" onclick={onjson}>{"{ } Text"}</button>
      </div>
      <div class="canvas" bind:clientWidth={W} bind:clientHeight={H}>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <svg bind:this={svg} width={W} height={H} tabindex="0" role="application" aria-label="Track map" onpointerdown={down} onpointermove={move} onpointerup={up} onwheel={wheel} onkeydown={key}>
          {#each gridLines as g (`${g.x}${g.v}`)}
            {#if g.x}
              <line class="grid" x1={sx(g.v)} y1="0" x2={sx(g.v)} y2={H} />
            {:else}
              <line class="grid" x1="0" y1={sy(g.v)} x2={W} y2={sy(g.v)} />
            {/if}
          {/each}
          {#if stats}
            <path d={linePath} fill="none" stroke={roadColour} stroke-width={Math.max(3, ROAD_WIDTH * scale)} stroke-linejoin="round" stroke-linecap="butt" opacity="0.75" />
            {#each stats.line as p, i (i)}
              {@const q = stats.line[(i + 1) % stats.line.length]!}
              {#if doc.open ? i < stats.line.length - 1 : true}
                <line x1={sx(p.x)} y1={sy(p.z)} x2={sx(q.x)} y2={sy(q.z)} stroke={curvatureColour(stats.curv[i]!)} stroke-width="3" stroke-linecap="round" />
              {/if}
            {/each}
            {#if stats.minRadius < WARN_RADIUS}
              <circle cx={sx(stats.tightestAt[0])} cy={sy(stats.tightestAt[1])} r="14" class="warnring" />
            {/if}
            {@const s = bar(stats.marks.start)}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} class="startline" />
            <text x={s.x2 + 6} y={s.y2 - 6} class="tag">Start</text>
            {#if stats.marks.finish !== null}
              {@const f = bar(stats.marks.finish)}
              <line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} class="finishline" />
              <text x={f.x2 + 6} y={f.y2 - 6} class="tag">Finish</text>
            {/if}
            {#each stats.marks.gates as gi, k (k)}
              {#if gi !== stats.marks.finish && k < stats.marks.gates.length - 1}
                {@const g = bar(gi)}
                <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} class="gate" />
                <text x={g.x2 + 5} y={g.y2 - 4} class="gatenum">{k + 1}</text>
              {/if}
            {/each}
          {/if}
          {#if doc.control.length > 1}
            <polyline points={doc.control.map((p) => `${sx(p[0])},${sy(p[1])}`).join(" ")} class="guide" />
          {/if}
          {#each doc.control as p, i (i)}
            <circle cx={sx(p[0])} cy={sy(p[1])} r={selected === i ? 8 : 6} class="pt" class:sel={selected === i} class:first={i === 0} />
            <text x={sx(p[0]) + 9} y={sy(p[1]) - 9} class="ptnum">{i + 1}</text>
          {/each}
        </svg>
        <div class="scalebar dim">grid: {gridStep} m</div>
        <div class="legend dim"><span class="ramp"></span> gentle → tight</div>
      </div>
    </div>

    <aside class="side">
      <section>
        <h3>Route</h3>
        <div class="seg" role="group" aria-label="Kind of route">
          <button class:on={!doc.open} onclick={() => set("open", false)} title="The road goes round and comes back to the start">Circuit (a loop)</button>
          <button class:on={doc.open} onclick={() => set("open", true)} title="The road goes from a start to a finish">Stage (start to finish)</button>
        </div>
        <label>Road
          <select value={doc.road} onchange={(e) => set("road", e.currentTarget.value as TrackDoc["road"])}>
            {#each ROADS as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
          </select>
        </label>
        {#if doc.open}
          <label>Sections
            <input type="number" min="1" max="20" value={doc.sections} onchange={(e) => set("sections", Math.max(1, Math.min(20, Math.round(number(e)) || 1)))} />
          </label>
          <label>Road before the start
            <span class="unit"><input type="number" min="10" max="500" step="10" value={doc.leadIn} onchange={(e) => set("leadIn", Math.max(10, number(e) || 40))} /> m</span>
          </label>
          <label>Road after the finish
            <span class="unit"><input type="number" min="10" max="500" step="10" value={doc.runout} onchange={(e) => set("runout", Math.max(10, number(e) || 90))} /> m</span>
          </label>
        {/if}
        <p class="dim small">The route starts at point 1 heading for point 2{doc.open ? ", so give a stage a straight start" : ""}.</p>
      </section>

      <section>
        <h3>How it drives</h3>
        {#if stats}
          <dl>
            <dt>Length</dt><dd>{metres(stats.length)}</dd>
            <dt>Tightest bend</dt><dd class:warn={stats.minRadius < WARN_RADIUS}>{Number.isFinite(stats.minRadius) ? `${stats.minRadius} m across` : "none"}</dd>
            <dt>Road closest to itself</dt><dd class:warn={stats.closest !== null && stats.closest < WARN_CLOSE}>{stats.closest === null ? "–" : `${stats.closest} m`}</dd>
            <dt>Points</dt><dd>{doc.control.length}</dd>
          </dl>
          {#each stats.warnings as w (w)}<p class="warning">⚠ {w}</p>{/each}
          {#if !stats.warnings.length}<p class="ok small">No problems found.</p>{/if}
        {:else}
          <p class="dim">Add {doc.open ? 2 : 3} or more points to see the road.</p>
        {/if}
      </section>

      <section>
        <h3>Scenery</h3>
        <div class="seg" role="group" aria-label="Kinds of scenery">
          {#each GROUPS as g (g.id)}
            <button class:on={group === g.id} onclick={() => (group = g.id)} title={g.hint}>{g.label}{doc[g.id].length ? ` (${doc[g.id].length})` : ""}</button>
          {/each}
        </div>
        {#if entities.length}
          <input class="find" placeholder="find an entity…" aria-label="Find an entity" bind:value={filter} />
          <ul class="kinds">
            {#each shown as k (k)}
              <li><label><input type="checkbox" checked={doc[group].includes(k)} onchange={() => toggle(k)} /> {k}</label></li>
            {/each}
          </ul>
        {:else}
          <p class="dim small">The project has no entities yet. Scenery is made from the things in <code>entities/</code>: add some first.</p>
        {/if}
        <label>Trees
          <input type="range" min="0" max="1" step="0.05" value={doc.density} oninput={(e) => set("density", number(e))} disabled={!doc.trees.length} />
        </label>
        <label>Rocks
          <input type="range" min="0" max="0.5" step="0.01" value={doc.rocks} oninput={(e) => set("rocks", number(e))} disabled={!doc.rock.length} />
        </label>
        <label class="row"><input type="checkbox" checked={doc.lamps} onchange={(e) => set("lamps", e.currentTarget.checked)} /> Street lamps</label>
        <label>Seed
          <span class="unit">
            <input type="number" min="0" value={doc.seed} onchange={(e) => set("seed", Math.max(0, Math.round(number(e))))} />
            <button class="ghost" onclick={() => set("seed", Math.floor(Math.random() * 100000))} title="Different scenery, same road">Shuffle</button>
          </span>
        </label>
      </section>

      <section>
        <h3>Make it</h3>
        <button class="primary wide" onclick={generate} disabled={busy || doc.control.length < MIN_POINTS}>{busy ? "Working…" : "Generate scene and road"}</button>
        <p class="dim small">Writes <code>{sceneOf(name)}</code> and <code>{roadOf(name)}</code>, and saves this track. Run it again after any change: it replaces them.</p>
        {#if doc.control.length < MIN_POINTS}<p class="warning">Needs at least {MIN_POINTS} points.</p>{/if}
        {#if result}
          <p class="ok small">{result}</p>
          <button class="ghost" onclick={() => studio.openFile(sceneOf(name))}>Open the scene</button>
        {/if}
      </section>

      <section>
        <h3>Pace notes</h3>
        {#if stats?.corners.length}
          <p class="dim small">What a co-driver would call. 1 is a hairpin, 6 a gentle bend.</p>
          <ol class="notes">
            {#each stats.corners as c, i (i)}
              <li><span class="at">{mmss(c.s)}</span> <span class="grade g{c.grade}">{callOut(c)}</span></li>
            {/each}
          </ol>
        {:else}
          <p class="dim small">{stats ? "No corners on this route." : "Nothing to call yet."}</p>
        {/if}
      </section>
    </aside>
  </div>
{/if}

<style>
  .track { display: grid; grid-template-columns: minmax(0, 1fr) 300px; height: 100%; min-height: 0; }
  .map { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; gap: 4px; align-items: center; padding: 3px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .hint { font-size: 11px; }
  .spacer { flex: 1; }
  .canvas { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--bg); }
  svg { display: block; touch-action: none; cursor: crosshair; outline: none; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .guide { fill: none; stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.6; }
  .pt { fill: var(--panel); stroke: var(--accent); stroke-width: 2; cursor: grab; }
  .pt.first { stroke: var(--ok); }
  .pt.sel { fill: var(--accent); }
  .ptnum { fill: var(--text); font-size: 10px; pointer-events: none; }
  .startline { stroke: #fff; stroke-width: 5; }
  .finishline { stroke: #fff; stroke-width: 5; stroke-dasharray: 5 5; }
  .gate { stroke: var(--warn); stroke-width: 3; }
  .gatenum { fill: var(--warn); font-size: 12px; font-weight: 700; }
  .tag { fill: var(--text); font-size: 11px; font-weight: 700; }
  .warnring { fill: none; stroke: var(--error); stroke-width: 2; }
  .scalebar { position: absolute; left: 8px; bottom: 6px; font-size: 11px; }
  .legend { position: absolute; right: 8px; bottom: 6px; font-size: 11px; display: flex; align-items: center; gap: 6px; }
  .ramp { width: 70px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, hsl(120 80% 50%), hsl(60 80% 50%), hsl(0 80% 50%)); }
  .side { overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 4px 12px 16px; }
  section { padding: 8px 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  label.row { justify-content: flex-start; }
  select, input[type="number"] { width: 130px; }
  .unit { display: flex; align-items: center; gap: 4px; }
  .unit input { width: 80px; }
  .find { width: 100%; }
  input[type="range"] { width: 130px; }
  .seg { display: flex; }
  .seg button { flex: 1; border-radius: 0; padding: 3px 4px; }
  .seg button.on { background: var(--accent-2); color: #fff; }
  .wide { width: 100%; }
  .kinds { list-style: none; margin: 0; padding: 4px 6px; max-height: 150px; overflow-y: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
  .kinds label { justify-content: flex-start; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; margin: 0; }
  dt { color: var(--dim); }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  dd.warn { color: var(--error); font-weight: 700; }
  .warning { margin: 0; color: var(--warn); }
  .ok { margin: 0; color: var(--ok); }
  .small { font-size: 11px; margin: 0; }
  .notes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  .at { color: var(--dim); font-variant-numeric: tabular-nums; display: inline-block; width: 52px; }
  .grade.g1, .grade.g2 { color: var(--error); font-weight: 700; }
  .grade.g3, .grade.g4 { color: var(--warn); }
  .bad { padding: 24px; }
</style>
