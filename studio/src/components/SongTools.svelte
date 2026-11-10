<script lang="ts">
  // The song's tools beyond the piano roll: edits of the picked notes (strum, glue, humanise, snap to a scale, chords, a finer grid), the bar length,
  // markers and the loop region, a gain lane per track (automation), the loudness target and the peak ceiling, and MIDI in and out.
  import { quantizeTrack, noteKey } from "../lib/song-edit";
  import { CHORDS, SCALES, addChord, addMarker, glueNotes, humanizeTiming, humanizeVelocity, lfoLane, laneValue, removeMarker, setBeatsPerBar, setLane, setLanePoint, setLoop, setMeterAt, setTempoAt, setNoteProps, snapToScale, strumNotes } from "../lib/song-tools";
  import { LANE_RANGE, type LaneParam, NOTE_NAMES, barSteps, bpmAt, tempoSegments, songSeconds, stepSeconds, type Song } from "../lib/song";
  import { integratedLufs, peakDb } from "../lib/loudness";
  import { loudestBand, spectrum, type Band } from "../lib/spectrum";
  import { renderSong } from "../lib/song";
  import { FX_SPECS, FX_TYPES, MAX_FX, addFx, moveFx, param, removeFx, setFxParam, toggleFx, type FxType } from "../lib/fx";
  import { updateTrack } from "../lib/song";

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
  let notePan = $state(0);
  let noteBend = $state(0);

  const done = (r: { song: Song; keys: Set<string> } | null, said: string) => {
    if (!r) return void (note = "That would pass the limit on notes in a song.");
    commit(r.song);
    pick(r.keys);
    note = said;
  };

  // ---- markers and the loop ----------------------------------------------------------------------------
  let markerStep = $state(0);
  let changeGlide = $state(false);
  let changeStep = $state(16);
  let changeBpm = $state(90);
  let changeBeats = $state(3);
  let markerName = $state("");
  let loopFrom = $state(0);
  let loopTo = $state(16);
  $effect(() => {
    loopFrom = song.loop?.from ?? 0;
    loopTo = song.loop?.to ?? song.length;
  });
  const bar = $derived(barSteps(song));

  // ---- the gain lane -------------------------------------------------------------------------------------
  let laneParam = $state<LaneParam>("gain");
  const lane = $derived(t?.automation?.find((l) => l.param === laneParam));
  const range = $derived(LANE_RANGE[laneParam]);
  let pointStep = $state(0);
  let pointValue = $state(1);
  const yOfValue = (v: number) => 60 - ((Math.min(range[1], Math.max(range[0], v)) - range[0]) / (range[1] - range[0])) * 60;
  const valueOfY = (y: number) => range[0] + ((60 - y) / 60) * (range[1] - range[0]);
  let drawing = false;
  /// Drawing with the mouse: press and drag across the picture to put a point at every step the pointer passes.
  function drawAt(e: PointerEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const step = ((e.clientX - r.left) / r.width) * song.length;
    const value = valueOfY(((e.clientY - r.top) / r.height) * 60);
    commit(setLanePoint(song, track, laneParam, step, value));
  }
  let lfoPeriod = $state(8);
  let lfoDepth = $state(0.5);
  let lfoShape = $state<"sine" | "triangle" | "square">("sine");
  const laneLine = $derived.by(() => {
    if (!lane) return "";
    const W = 400;
    const H = 60;
    const pts: string[] = [];
    for (let x = 0; x <= W; x += 4) pts.push(`${x},${yOfValue(laneValue(lane, (x / W) * song.length))}`);
    return pts.join(" ");
  });
  const setPoint = () => {
    commit(setLanePoint(song, track, laneParam, pointStep, pointValue));
  };

  // ---- effects -------------------------------------------------------------------------------------------
  const chain = $derived(t?.fx ?? []);
  let newFxType = $state<FxType>("eq");
  const setChain = (next: typeof chain) => commit(updateTrack(song, track, { fx: next.length ? next : undefined }));

  // ---- loudness -------------------------------------------------------------------------------------------
  let measured = $state<{ lufs: number; peak: number } | null>(null);
  function measure() {
    const s = renderSong(song, 22050);
    measured = { lufs: integratedLufs(s.channels, s.rate), peak: peakDb(s.channels) };
  }
  // ---- the spectrum ----
  let bands: Band[] | null = $state(null);
  let spectrumNote = $state("");
  /// Renders the song (or, with a track chosen, just that track) and averages its spectrum.
  function analyse(whole: boolean) {
    const target = whole ? song : { ...song, master: undefined, tracks: song.tracks.map((tr, i) => ({ ...tr, mute: i !== track, solo: false })) };
    const sound = renderSong(target, 22050);
    const mono = new Float32Array(sound.channels[0]!.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (sound.channels[0]![i]! + sound.channels[1]![i]!) / 2;
    bands = spectrum(mono, sound.rate);
    const top = loudestBand(bands);
    spectrumNote = top && top.db > -100 ? `Loudest around ${Math.round(top.hz)} Hz` : "Silent";
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
    <div class="row" title="Where each note sits in the stereo field (added to the track's pan), and a pitch glide over the note">
      <label>Pan <input type="range" min="-1" max="1" step="0.05" bind:value={notePan} aria-label="Note pan" /></label>
      <button onclick={() => { commit(setNoteProps(song, track, target, { pan: notePan })); note = "Note pan set."; }}>Set pan</button>
      {#if t?.kind === "synth"}
        <label>Bend <input type="number" min="-12" max="12" step="1" bind:value={noteBend} class="narrow" aria-label="Glide in semitones" /> semitones</label>
        <button onclick={() => { commit(setNoteProps(song, track, target, { bend: noteBend })); note = "Glide set."; }}>Set glide</button>
      {/if}
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
    <div class="row" title="The tempo can change part-way: from this step on the song plays at the new tempo">
      <label>Tempo from step <input type="number" min="1" max={song.length - 1} bind:value={changeStep} class="narrow" aria-label="Tempo change step" /></label>
      <label><input type="number" min="40" max="240" bind:value={changeBpm} class="narrow" aria-label="Tempo change bpm" /> bpm</label>
      <label class="check" title="Glide: the tempo moves in a straight line from the one before to this one, arriving at this step, instead of jumping"><input type="checkbox" bind:checked={changeGlide} /> glide</label>
      <button onclick={() => commit(setTempoAt(song, changeStep, changeBpm, changeGlide))}>Change tempo</button>
    </div>
    {#each song.tempos ?? [] as tc (tc.step)}
      <div class="row small"><span>From step {tc.step} (bar {Math.floor(tc.step / bar) + 1}): <strong>{tc.bpm} bpm</strong> ({tc.ramp ? "glides there from" : "was"} {tempoSegments(song).find((g) => g.to === tc.step)?.b1 ?? song.bpm})</span><button class="ghost" aria-label="Remove the tempo change at step {tc.step}" onclick={() => commit(setTempoAt(song, tc.step, null))}>✕</button></div>
    {/each}
    <div class="row" title="A different number of beats in a bar from this step on; a new bar starts there">
      <label>Bar length from step <input type="number" min="1" max={song.length - 1} bind:value={changeStep} class="narrow" aria-label="Bar change step" /></label>
      <label><input type="number" min="1" max="16" bind:value={changeBeats} class="narrow" aria-label="Beats in the bar" /> beats</label>
      <button onclick={() => commit(setMeterAt(song, changeStep, changeBeats))}>Change bar length</button>
    </div>
    {#each song.meters ?? [] as mc (mc.step)}
      <div class="row small"><span>From step {mc.step}: <strong>{mc.beats} beats</strong> in a bar</span><button class="ghost" aria-label="Remove the bar change at step {mc.step}" onclick={() => commit(setMeterAt(song, mc.step, null))}>✕</button></div>
    {/each}
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
    <h4>Automation over the song <span class="dim small">(this track)</span></h4>
    <div class="row">
      <label>Lane <select bind:value={laneParam} onchange={() => (pointValue = laneParam === "pan" ? 0 : 1)} aria-label="Which lane"><option value="gain">loudness</option><option value="pan">pan</option><option value="cutoff">filter cutoff</option><option value="reverb">reverb send</option></select></label>
      <span class="dim small">Press and drag on the picture to draw it.</span>
    </div>
    <svg viewBox="0 0 400 60" class="lane" role="img" aria-label="The {laneParam} lane of this track" style="touch-action:none;cursor:crosshair"
      onpointerdown={(e) => { drawing = true; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); drawAt(e); }} onpointermove={(e) => { if (drawing) drawAt(e); }} onpointerup={() => (drawing = false)} onpointercancel={() => (drawing = false)}>
      <line x1="0" x2="400" y1={yOfValue(laneParam === "pan" ? 0 : 1)} y2={yOfValue(laneParam === "pan" ? 0 : 1)} class="mid" />
      {#each lane?.points ?? [] as pt (pt.step)}<circle cx={(pt.step / Math.max(1, song.length)) * 400} cy={yOfValue(pt.value)} r="2.5" fill="#5aa9ff" />{/each}
      {#if lane}<polyline points={laneLine} />{/if}
    </svg>
    <div class="row">
      <label>Curve <select disabled={!lane} value={lane?.curve ?? "linear"} onchange={(e) => lane && commit(setLane(song, track, { ...lane, curve: e.currentTarget.value as "linear" | "step" | "smooth" }))}><option value="linear">straight</option><option value="smooth">smooth</option><option value="step">steps</option></select></label>
      <label>at step <input type="number" min="0" max={song.length} bind:value={pointStep} class="narrow" /></label>
      <label>{laneParam === "gain" ? "gain" : laneParam === "pan" ? "pan" : laneParam === "reverb" ? "send ×" : "cutoff ×"} <input type="number" min={range[0]} max={range[1]} step="0.1" bind:value={pointValue} class="narrow" /></label>
      <button onclick={setPoint}>Set point</button>
      <button class="ghost" disabled={!lane} onclick={() => commit(setLane(song, track, null, laneParam))}>Clear</button>
    </div>
    {#each lane?.points ?? [] as p (p.step)}
      <span class="chip small">{p.step}: {p.value}<button aria-label="Remove point at {p.step}" onclick={() => lane && commit(setLane(song, track, { ...lane, points: lane.points.filter((q) => q.step !== p.step) }))}>✕</button></span>
    {/each}
    <div class="row">
      <label>LFO every <input type="number" min="2" max="64" bind:value={lfoPeriod} class="narrow" /> steps</label>
      <label>depth <input type="number" min="0.1" max="1" step="0.1" bind:value={lfoDepth} class="narrow" /></label>
      <select bind:value={lfoShape} aria-label="LFO shape"><option value="sine">sine</option><option value="triangle">triangle</option><option value="square">square</option></select>
      <button disabled={laneParam !== "gain"} onclick={() => commit(setLane(song, track, lfoLane(song.length, lfoPeriod, lfoDepth, lfoShape)))} title="Fill the loudness lane with a wave: the notes swell and fade">Make an LFO</button>
    </div>
    <p class="dim small">{laneParam === "gain" ? "Each note is played at its loudness times the lane's value where it starts." : "Each note's place in the stereo field (-1 left, 1 right) is moved by the lane's value where it starts."}</p>
  </section>

  <section>
    <h4>Effects on this track <span class="dim small">(after its volume and pan, in this order)</span></h4>
    {#each chain as fx, i (i)}
      <div class="fx" class:off={fx.on === false}>
        <div class="fxhead">
          <label class="check" title={FX_SPECS[fx.type].help}><input type="checkbox" checked={fx.on !== false} onchange={() => setChain(toggleFx(chain, i))} aria-label="{FX_SPECS[fx.type].title} on" /> <strong>{FX_SPECS[fx.type].title}</strong></label>
          <span class="spacer"></span>
          <button class="ghost" aria-label="Move up" disabled={i === 0} onclick={() => setChain(moveFx(chain, i, -1))}>↑</button>
          <button class="ghost" aria-label="Move down" disabled={i === chain.length - 1} onclick={() => setChain(moveFx(chain, i, 1))}>↓</button>
          <button class="ghost danger" aria-label="Remove {FX_SPECS[fx.type].title}" onclick={() => setChain(removeFx(chain, i))}>✕</button>
        </div>
        {#each FX_SPECS[fx.type].params as p (p.key)}
          <label class="slider"><span>{p.label}</span><input type="range" min={p.min} max={p.max} step={p.step} value={param(fx, p.key)} oninput={(e) => setChain(setFxParam(chain, i, p.key, Number(e.currentTarget.value)))} /><output>{param(fx, p.key)}{p.unit ? " " + p.unit : ""}</output></label>
        {/each}
      </div>
    {:else}
      <p class="dim small">No effects on this track.</p>
    {/each}
    <div class="row">
      <select bind:value={newFxType} aria-label="Effect to add">{#each FX_TYPES as ft (ft)}<option value={ft}>{FX_SPECS[ft].title}</option>{/each}</select>
      <button disabled={chain.length >= MAX_FX || !t} onclick={() => setChain(addFx(chain, newFxType))}>Add an effect</button>
      <span class="dim small">{FX_SPECS[newFxType].help}</span>
    </div>
  </section>

  <section>
    <h4>Spectrum <span class="dim small">(which pitches carry the energy)</span></h4>
    <div class="row">
      <button onclick={() => analyse(true)}>Analyse the song</button>
      <button onclick={() => analyse(false)} disabled={!t}>Analyse this track</button>
      {#if spectrumNote}<span class="dim small" role="status">{spectrumNote}</span>{/if}
    </div>
    {#if bands}
      <svg viewBox="0 0 400 90" class="lane" role="img" aria-label="Spectrum: level of each pitch range, low pitches on the left">
        {#each bands as b, i (i)}
          {@const h = Math.max(0, ((b.db + 80) / 80) * 80)}
          <rect x={(i / bands.length) * 400 + 1} y={90 - h} width={400 / bands.length - 2} height={h} fill="#5aa9ff"><title>{Math.round(b.hz)} Hz: {b.db.toFixed(0)} dB</title></rect>
        {/each}
      </svg>
      <p class="dim small">Low pitches on the left, high on the right; taller is louder (the scale runs from -80 dB to 0).</p>
    {/if}
  </section>

  <section>
    <h4>Master</h4>
    <div class="row">
      <label class="check"><input type="checkbox" checked={song.master?.lufs !== undefined} onchange={(e) => commit({ ...song, master: { volume: song.master?.volume ?? 1, ...(song.master?.fx ? { fx: song.master.fx } : {}), ...(e.currentTarget.checked ? { lufs: -16 } : {}), ...(song.master?.limit !== undefined ? { limit: song.master.limit } : {}) } })} /> Bring to a loudness of</label>
      <input type="number" class="narrow" min="-30" max="-6" step="1" disabled={song.master?.lufs === undefined} value={song.master?.lufs ?? -16} aria-label="Target loudness in LUFS" onchange={(e) => commit({ ...song, master: { ...song.master!, volume: song.master?.volume ?? 1, lufs: Number(e.currentTarget.value) } })} /> <span class="dim small">LUFS (-16 suits a game's music)</span>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" checked={song.master?.limit !== undefined} onchange={(e) => commit({ ...song, master: { volume: song.master?.volume ?? 1, ...(song.master?.fx ? { fx: song.master.fx } : {}), ...(song.master?.lufs !== undefined ? { lufs: song.master.lufs } : {}), ...(e.currentTarget.checked ? { limit: -1 } : {}) } })} /> Keep peaks under</label>
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
  .fx { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
  .fx.off { opacity: 0.55; }
  .fxhead { display: flex; align-items: center; gap: 4px; }
  .spacer { flex: 1; }
  .slider { display: grid; grid-template-columns: 74px 1fr 60px; align-items: center; gap: 6px; font-size: 11px; }
  .chip { display: inline-flex; gap: 4px; align-items: center; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 0 4px 0 8px; margin-right: 4px; }
  .chip button { border: none; background: transparent; color: var(--dim); padding: 0 4px; }
</style>
