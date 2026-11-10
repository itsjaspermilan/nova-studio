<script lang="ts">
  // The arrangement: every track as a lane, with its clips (a pattern placed at a step, repeating to fill its length) drawn to scale. Drag a clip to move it,
  // drag its right edge to resize it, cut it with the knife at the play position, loop it by making it longer, and turn a span of notes into a pattern.
  import { barStarts, clipNotes, type Song } from "../lib/song";
  import { deleteClip, duplicateClip, flattenTrack, makePattern, moveClip, resizeClip, splitClip, unpackClip, updateClip, deletePattern } from "../lib/song-arrange";

  let { song, track, step, commit, onselect, onedit }: { song: Song; track: number; step: number; commit: (next: Song) => void; onselect: (i: number) => void; onedit?: (track: number, pattern: string) => void } = $props();

  let zoom = $state(10); // pixels a step
  let snap = $state(4);
  let sel = $state<{ track: number; index: number } | null>(null);
  let from = $state(0);
  let to = $state(16);
  let name = $state("pattern");
  let note = $state("");
  const HEAD = 90;
  const bars = $derived(barStarts(song));
  const snapTo = (n: number) => Math.max(0, Math.round(n / snap) * snap);
  const chosen = $derived(sel ? song.tracks[sel.track]?.clips?.[sel.index] : undefined);

  type Drag = { track: number; index: number; kind: "move" | "size"; x0: number; origStep: number; origLen: number };
  let drag: Drag | null = null;
  const down = (e: PointerEvent, ti: number, index: number, kind: Drag["kind"]) => {
    const c = song.tracks[ti]!.clips![index]!;
    sel = { track: ti, index };
    onselect(ti);
    drag = { track: ti, index, kind, x0: e.clientX, origStep: c.step, origLen: c.len };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const ds = snapTo(Math.abs(e.clientX - drag.x0) / zoom) * Math.sign(e.clientX - drag.x0);
    if (drag.kind === "move") commit(moveClip(song, drag.track, drag.index, drag.origStep + ds));
    else commit(resizeClip(song, drag.track, drag.index, Math.max(snap, drag.origLen + ds)));
  };
  const up = () => (drag = null);

  const act = (next: Song | null, said: string) => {
    if (!next) return void (note = "That would pass the limit on notes in a song.");
    commit(next);
    note = said;
  };
  const mk = () => {
    const r = makePattern(song, track, from, to, name);
    if (!r) return void (note = "There are no notes of this track in those steps (or the limit on patterns is reached).");
    commit(r.song);
    sel = { track, index: r.song.tracks[track]!.clips!.findIndex((c) => c.pattern === r.name && c.step === Math.round(from)) };
    note = `Made the pattern “${r.name}”: it plays where the notes were. Make a clip longer to repeat it.`;
  };
</script>

<div class="arr" role="group" aria-label="Arrangement">
  <div class="bar">
    <label>Zoom <input type="range" min="3" max="24" bind:value={zoom} aria-label="Zoom" /></label>
    <label>Snap <select bind:value={snap} aria-label="Snap"><option value={1}>1 step</option><option value={2}>2 steps</option><option value={4}>4 steps</option><option value={8}>8 steps</option><option value={16}>16 steps</option></select></label>
    <span class="dim small">Drag a clip to move it, its right edge to resize; a longer clip repeats its pattern.</span>
  </div>
  <div class="scroll">
    <div class="ruler" style:width="{HEAD + song.length * zoom}px">
      {#each bars as b, i (b)}<span style:left="{HEAD + b * zoom}px">{i + 1}</span>{/each}
      <i class="play" style:left="{HEAD + step * zoom}px"></i>
    </div>
    {#each song.tracks as t, ti (ti)}
      <div class="lane" class:on={ti === track} style:width="{HEAD + song.length * zoom}px">
        <button class="head ghost" onclick={() => onselect(ti)} style:border-left="4px solid {t.color ?? 'transparent'}">{t.name}</button>
        {#each bars as b (b)}<i class="gridline" style:left="{HEAD + b * zoom}px"></i>{/each}
        {#each t.notes as n, ni (ni)}<i class="dot" style:left="{HEAD + n.step * zoom}px" style:width="{Math.max(1, n.len * zoom - 1)}px"></i>{/each}
        {#each t.clips ?? [] as c, ci (ci)}
          <div class="clip" class:picked={sel?.track === ti && sel.index === ci} class:muted={c.mute} role="button" tabindex="0" aria-label="Clip {c.pattern} at step {c.step}, {c.len} steps"
            style:left="{HEAD + c.step * zoom}px" style:width="{c.len * zoom}px" style:background={c.color ?? "var(--accent)"}
            onpointerdown={(e) => down(e, ti, ci, "move")} onpointermove={move} onpointerup={up} onpointercancel={up}
            onkeydown={(e) => { if (e.key === "Enter") sel = { track: ti, index: ci }; }}>
            <span>{c.pattern}</span>
            {#each clipNotes(t, c, song.length) as n, k (k)}<i class="cn" style:left="{(n.step - c.step) * zoom}px" style:width="{Math.max(1, n.len * zoom - 1)}px" style:top="{100 - ((n.pitch - 24) / 80) * 100}%"></i>{/each}
            <b class="grip" role="presentation" onpointerdown={(e) => down(e, ti, ci, "size")} onpointermove={move} onpointerup={up} onpointercancel={up}></b>
          </div>
        {/each}
      </div>
    {/each}
  </div>
  <div class="tools">
    <div class="row">
      <strong>Make a pattern from this track's notes</strong>
      <label>from step <input type="number" class="narrow" min="0" max={song.length - 1} bind:value={from} /></label>
      <label>up to <input type="number" class="narrow" min="1" max={song.length} bind:value={to} /></label>
      <input bind:value={name} aria-label="Pattern name" placeholder="name" />
      <button onclick={mk}>Make pattern</button>
    </div>
    {#if chosen && sel}
      {@const s = sel}
      <div class="row">
        <strong>{chosen.pattern}</strong>
        <span class="dim small">step {chosen.step}, {chosen.len} steps</span>
        <button onclick={() => act(splitClip(song, s.track, s.index, step), `Cut at step ${step}.`)} title="Cut the clip where the play position is" disabled={step <= chosen.step || step >= chosen.step + chosen.len}>✂ Cut at the play position</button>
        <button onclick={() => commit(duplicateClip(song, s.track, s.index))}>Duplicate</button>
        <button onclick={() => commit(updateClip(song, s.track, s.index, { mute: !chosen.mute }))} aria-pressed={!!chosen.mute}>{chosen.mute ? "Unmute" : "Mute"}</button>
        <label title="Fade in over this many steps: the notes that start there are quieter the nearer the clip's start">Fade in <input type="number" class="narrow" min="0" max={chosen.len} value={chosen.fadeIn ?? 0} onchange={(e) => commit(updateClip(song, s.track, s.index, { fadeIn: Number(e.currentTarget.value) }))} /></label>
        <label title="Fade out over this many steps">out <input type="number" class="narrow" min="0" max={chosen.len} value={chosen.fadeOut ?? 0} onchange={(e) => commit(updateClip(song, s.track, s.index, { fadeOut: Number(e.currentTarget.value) }))} /></label>
        <label>Colour <input type="color" value={chosen.color ?? "#5aa9ff"} onchange={(e) => commit(updateClip(song, s.track, s.index, { color: e.currentTarget.value }))} /></label>
        {#if onedit}<button onclick={() => onedit(sel!.track, chosen.pattern)} title="Edit the pattern's notes in the piano roll: every clip of it changes together">Edit in the piano roll</button>{/if}
        <button onclick={() => act(unpackClip(song, s.track, s.index), "The clip is notes on the track again: edit them in the piano roll.")} title="Turn the clip into notes in the piano roll">Unpack to notes</button>
        <button class="danger" onclick={() => { commit(deleteClip(song, s.track, s.index)); sel = null; }}>Delete clip</button>
      </div>
    {/if}
    {#if song.tracks[track]?.clips?.length}
      <div class="row">
        <button onclick={() => act(flattenTrack(song, track), "Every clip of this track is notes now.")}>Flatten this track to notes</button>
        {#each song.tracks[track]?.patterns ?? [] as p (p.name)}
          <span class="chip">{p.name} · {p.length} steps <button class="ghost" aria-label="Delete the pattern {p.name} and its clips" onclick={() => { commit(deletePattern(song, track, p.name)); sel = null; }}>✕</button></span>
        {/each}
      </div>
    {/if}
    {#if note}<p class="dim small" role="status">{note}</p>{/if}
  </div>
</div>

<style>
  .arr { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px; }
  .bar, .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .bar label, .row label { display: flex; align-items: center; gap: 4px; flex-direction: row; }
  .narrow { width: 62px; padding: 2px 6px; }
  .scroll { overflow: auto; max-height: 220px; border: 1px solid var(--line); border-radius: 6px; background: #15171c; }
  .ruler { position: sticky; top: 0; z-index: 3; height: 18px; background: var(--panel-2); border-bottom: 1px solid var(--line); font-size: 10px; color: var(--dim); }
  .ruler span { position: absolute; top: 2px; padding-left: 3px; }
  .play { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ok); }
  .lane { position: relative; height: 46px; border-bottom: 1px solid var(--line); }
  .lane.on { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .head { position: sticky; left: 0; z-index: 2; width: 90px; height: 100%; text-align: left; background: var(--panel); border-radius: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: #2b303b; }
  .dot { position: absolute; top: 38px; height: 4px; background: #5a6a85; border-radius: 1px; }
  .clip { position: absolute; top: 4px; height: 36px; border-radius: 4px; overflow: hidden; cursor: grab; border: 1px solid rgba(255, 255, 255, 0.25); touch-action: none; }
  .clip.picked { outline: 2px solid #ffd166; }
  .clip.muted { opacity: 0.4; }
  .clip span { position: absolute; left: 4px; top: 1px; font-size: 10px; color: #fff; text-shadow: 0 0 2px #000; z-index: 1; pointer-events: none; }
  .cn { position: absolute; height: 2px; background: rgba(255, 255, 255, 0.8); pointer-events: none; }
  .grip { position: absolute; right: 0; top: 0; bottom: 0; width: 7px; cursor: ew-resize; background: rgba(0, 0, 0, 0.25); z-index: 2; }
  .chip { font-size: 11px; border: 1px solid var(--line); border-radius: 10px; padding: 1px 6px; }
  .small { font-size: 11px; }
</style>
