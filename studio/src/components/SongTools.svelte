<script lang="ts">
  // The song's tools beyond the piano roll: edits of the picked notes (strum, glue, humanise, snap to a scale, chords, a finer grid), the bar length,
  // markers and the loop region, a gain lane per track (automation), the loudness target and the peak ceiling, and MIDI in and out.
  import { quantizeTrack, noteKey } from "../lib/song-edit";
  import { CHORDS, SCALES, addChord, addMarker, glueNotes, humanizeTiming, humanizeVelocity, lfoLane, laneValue, removeMarker, setBeatsPerBar, setLane, setLoop, snapToScale, strumNotes } from "../lib/song-tools";
  import { NOTE_NAMES, barSteps, songSeconds, stepSeconds, type Song } from "../lib/song";
  import { integratedLufs, peakDb } from "../lib/loudness";
  import { renderSong } from "../lib/song";

  let {
    song,
    track,
    group,
    commit,
    pick,
    exportLoop,
    exportMidi,
    importMidi,
  }: {
    song: Song;
    track: number;
    group: Set<string>;
    commit: (next: Song) => void;
    pick: (keys: Set<string>) => void;
    exportLoop: () => void;
    exportMidi: () => void;
    importMidi: (file: File) => void;
  } = $props();

  const t = $derived(song.tracks[track]);
  /// The notes the edits act on: the picked ones, or every note of the track.
  const target = $derived(group.size ? group : new Set((t?.notes ?? []).map(noteKey)));
  const scope = $derived(group.size ? `${group.size} picked note${group.size === 1 ? "" : "s"}` : "every note of this track");

  let gap = $state(1);
  let down = $state(true);
  let amount = $state(0.2);
  let timing = $state(1);
  let root = $state(0);
  let scale = $state("major");
  let chord = $state("major");
  let inversion = $state(0);
  let grid = $state(1);
  let note = $state("");

  const done = (r: { song: Song; keys: Set<string> } | null, said: string) => {
    if (!r) return void (note = "That would pass the limit on notes in a song.");
    commit(r.song);
    pick(r.keys);
    note = said;
  };

  // ---- markers and the loop ----------------------------------------------------------------------------
  let markerStep = $state(0);
  let markerName = $state("");
  let loopFrom = $state(0);
  let loopTo = $state(16);
  $effect(() => {
    loopFrom = song.loop?.from ?? 0;
    loopTo = song.loop?.to ?? song.length;
  });
  const bar = $derived(barSteps(song));

  // ---- the gain lane -------------------------------------------------------------------------------------
  const lane = $derived(t?.automation?.[0]);
  let pointStep = $state(0);
  let pointValue = $state(1);
  let lfoPeriod = $state(8);
  let lfoDepth = $state(0.5);
  let lfoShape = $state<"sine" | "triangle" | "square">("sine");
  const laneLine = $derived.by(() => {
    if (!lane) return "";
    const W = 400;
    const H = 60;
    const pts: string[] = [];
    for (let x = 0; x <= W; x += 4) pts.push(`${x},${H - (Math.min(2, laneValue(lane, (x / W) * song.length)) / 2) * H}`);
    return pts.join(" ");
  });
  const setPoint = () => {
    const points = [...(lane?.points ?? []).filter((p) => p.step !== pointStep), { step: Math.max(0, Math.round(pointStep)), value: Math.min(2, Math.max(0, pointValue)) }];
    commit(setLane(song, track, { param: "gain", curve: lane?.curve ?? "linear", points }));
  };

  // ---- loudness -------------------------------------------------------------------------------------------
  let measured = $state<{ lufs: number; peak: number } | null>(null);
  function measure() {
    const s = renderSong(song, 22050);
    measured = { lufs: integratedLufs(s.channels, s.rate), peak: peakDb(s.channels) };
  }
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "silent");
  let midiFile: HTMLInputElement | undefined = $state();
</script>

<div class="tools" aria-label="Song tools">
  <section>
    <h4>Notes <span class="dim small">({scope})</span></h4>
    <div class="row">
      <label>Snap to <select bind:value={grid}>{#each [{ v: 1, l: "1 step" }, { v: 2, l: "2 steps" }, { v: Math.max(1, Math.round(song.stepsPerBeat / 2)), l: "half a beat" }, { v: song.stepsPerBeat, l: "a beat" }, { v: bar, l: "a bar" }] as g (g.l)}<option value={g.v}>{g.l}</option>{/each}</select></label>
      <button onclick={() => { commit(quantizeTrack(song, track, grid)); note = `Snapped to the grid.`; }}>Snap</button>
    </div>
    <div class="row">
      <label>Strum gap <input type="number" min="1" max="4" bind:value={gap} class="narrow" /></label>
      <label class="check"><input type="checkbox" bind:checked={down} /> down</label>
      <button onclick={() => done(strumNotes(song, track, target, gap, down), "Strummed.")}>Strum</button>
      <button onclick={() => done(glueNotes(song, track, target), "Joined notes that touch.")} title="Join notes of the same pitch that touch or overlap">Glue</button>
    </div>
    <div class="row">
      <label>Humanise <input type="range" min="0" max="0.6" step="0.05" bind:value={amount} /></label>
      <button onclick={() => { commit(humanizeVelocity(song, track, target, amount, Date.now() & 0xffff)); note = "Loudness varied."; }}>Loudness</button>
      <label>timing <input type="number" min="1" max="2" bind:value={timing} class="narrow" /></label>
      <button onclick={() => done(humanizeTiming(song, track, target, timing, Date.now() & 0xffff), "Timing loosened.")}>Timing</button>
    </div>
    {#if t?.kind === "synth"}
      <div class="row">
        <label>Key <select bind:value={root}>{#each NOTE_NAMES as n, i (n)}<option value={i}>{n}</option>{/each}</select></label>
        <select bind:value={scale} aria-label="Scale">{#each Object.keys(SCALES) as s (s)}<option value={s}>{s}</option>{/each}</select>
        <button onclick={() => done(snapToScale(song, track, target, root, scale), `Moved to ${NOTE_NAMES[root]} ${scale}.`)} title="Move each note to the nearest note of the scale">Snap to scale</button>
      </div>
      <div class="row">
        <label>Chord <select bind:value={chord}>{#each Object.keys(CHORDS) as c (c)}<option value={c}>{c}</option>{/each}</select></label>
        <label>inversion <input type="number" min="0" max="3" bind:value={inversion} class="narrow" /></label>
        <button disabled={!group.size} onclick={() => done(addChord(song, track, group, chord, inversion), "Chord added.")} title="Build the chord on each picked note (pick notes first)">Add chord</button>
      </div>
    {/if}
    {#if note}<p class="dim small" role="status">{note}</p>{/if}
  </section>

  <section>
    <h4>Bars, markers and the loop</h4>
    <div class="row">
      <label>Beats in a bar <input type="number" min="1" max="16" value={song.beatsPerBar ?? 4} class="narrow" onchange={(e) => commit(setBeatsPerBar(song, Number(e.currentTarget.value)))} /></label>
      <span class="dim small">{(songSeconds(song)).toFixed(1)} s, {(stepSeconds(song) * 1000).toFixed(0)} ms a step</span>
    </div>
    <form class="row" onsubmit={(e) => { e.preventDefault(); commit(addMarker(song, markerStep, markerName)); markerName = ""; }}>
      <label>Marker at step <input type="number" min="0" max={song.length} bind:value={markerStep} class="narrow" /></label>
      <input bind:value={markerName} placeholder="name, e.g. verse" aria-label="Marker name" />
      <button>Add</button>
    </form>
    {#each song.markers ?? [] as m (m.step)}
      <div class="row small"><span><strong>{m.name}</strong> at step {m.step} (bar {Math.floor(m.step / bar) + 1})</span><button class="ghost" aria-label="Remove {m.name}" onclick={() => commit(removeMarker(song, m.step))}>✕</button></div>
    {/each}
    <div class="row">
      <label>Loop from <input type="number" min="0" max={song.length - 1} bind:value={loopFrom} class="narrow" /></label>
      <label>to <input type="number" min="1" max={song.length} bind:value={loopTo} class="narrow" /></label>
      <button onclick={() => commit(setLoop(song, { from: loopFrom, to: loopTo }))}>Set the loop</button>
      <button class="ghost" disabled={!song.loop} onclick={() => commit(setLoop(song, null))}>Clear</button>
    </div>
    <div class="row">
      <button disabled={!song.loop} onclick={exportLoop} title="Writes just the loop region as music/<song>_loop.ogg, ready to loop in the game">Export the loop</button>
      <button onclick={exportMidi} title="A standard MIDI file in the exports folder">Export MIDI</button>
      <button onclick={() => midiFile?.click()} title="Make a song from a MIDI file (it replaces this one; undo brings it back)">Import MIDI…</button>
      <input bind:this={midiFile} type="file" accept=".mid,.midi,audio/midi" hidden onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) importMidi(f); }} />
    </div>
  </section>

  <section>
    <h4>Loudness over the song <span class="dim small">(this track)</span></h4>
    <svg viewBox="0 0 400 60" class="lane" role="img" aria-label="The gain lane of this track">
      <line x1="0" x2="400" y1="30" y2="30" class="mid" />
      {#if lane}<polyline points={laneLine} />{/if}
    </svg>
    <div class="row">
      <label>Curve <select disabled={!lane} value={lane?.curve ?? "linear"} onchange={(e) => lane && commit(setLane(song, track, { ...lane, curve: e.currentTarget.value as "linear" | "step" | "smooth" }))}><option value="linear">straight</option><option value="smooth">smooth</option><option value="step">steps</option></select></label>
      <label>at step <input type="number" min="0" max={song.length} bind:value={pointStep} class="narrow" /></label>
      <label>gain <input type="number" min="0" max="2" step="0.1" bind:value={pointValue} class="narrow" /></label>
      <button onclick={setPoint}>Set point</button>
      <button class="ghost" disabled={!lane} onclick={() => commit(setLane(song, track, null))}>Clear</button>
    </div>
    {#each lane?.points ?? [] as p (p.step)}
      <span class="chip small">{p.step}: {p.value}<button aria-label="Remove point at {p.step}" onclick={() => lane && commit(setLane(song, track, { ...lane, points: lane.points.filter((q) => q.step !== p.step) }))}>✕</button></span>
    {/each}
    <div class="row">
      <label>LFO every <input type="number" min="2" max="64" bind:value={lfoPeriod} class="narrow" /> steps</label>
      <label>depth <input type="number" min="0.1" max="1" step="0.1" bind:value={lfoDepth} class="narrow" /></label>
      <select bind:value={lfoShape} aria-label="LFO shape"><option value="sine">sine</option><option value="triangle">triangle</option><option value="square">square</option></select>
      <button onclick={() => commit(setLane(song, track, lfoLane(song.length, lfoPeriod, lfoDepth, lfoShape)))} title="Fill the lane with a wave: the notes swell and fade">Make an LFO</button>
    </div>
    <p class="dim small">Each note is played at its loudness times the lane's value where it starts.</p>
  </section>

  <section>
    <h4>Master</h4>
    <div class="row">
      <label class="check"><input type="checkbox" checked={song.master?.lufs !== undefined} onchange={(e) => commit({ ...song, master: { volume: song.master?.volume ?? 1, ...(e.currentTarget.checked ? { lufs: -16 } : {}), ...(song.master?.limit !== undefined ? { limit: song.master.limit } : {}) } })} /> Bring to a loudness of</label>
      <input type="number" class="narrow" min="-30" max="-6" step="1" disabled={song.master?.lufs === undefined} value={song.master?.lufs ?? -16} aria-label="Target loudness in LUFS" onchange={(e) => commit({ ...song, master: { ...song.master!, volume: song.master?.volume ?? 1, lufs: Number(e.currentTarget.value) } })} /> <span class="dim small">LUFS (-16 suits a game's music)</span>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" checked={song.master?.limit !== undefined} onchange={(e) => commit({ ...song, master: { volume: song.master?.volume ?? 1, ...(song.master?.lufs !== undefined ? { lufs: song.master.lufs } : {}), ...(e.currentTarget.checked ? { limit: -1 } : {}) } })} /> Keep peaks under</label>
      <input type="number" class="narrow" min="-12" max="0" step="0.5" disabled={song.master?.limit === undefined} value={song.master?.limit ?? -1} aria-label="Peak ceiling in dB" onchange={(e) => commit({ ...song, master: { ...song.master!, volume: song.master?.volume ?? 1, limit: Number(e.currentTarget.value) } })} /> <span class="dim small">dB</span>
    </div>
    <div class="row">
      <button onclick={measure}>Measure the loudness</button>
      {#if measured}<span role="status">{fmt(measured.lufs)} LUFS · peak {fmt(measured.peak)} dB</span>{/if}
    </div>
  </section>
</div>

<style>
  .tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; padding: 8px 12px; overflow: auto; align-content: start; height: 100%; }
  section { display: flex; flex-direction: column; gap: 6px; }
  h4 { margin: 0; font-size: 12px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .small { font-size: 11px; }
  .narrow { width: 64px; }
  .lane { width: 100%; max-width: 400px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
  .lane polyline { fill: none; stroke: #5aa9ff; stroke-width: 1.5; }
  .lane .mid { stroke: var(--line); stroke-dasharray: 3 3; }
  .chip { display: inline-flex; gap: 4px; align-items: center; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 0 4px 0 8px; margin-right: 4px; }
  .chip button { border: none; background: transparent; color: var(--dim); padding: 0 4px; }
</style>
