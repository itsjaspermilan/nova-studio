<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    DRUMS, WAVES, addNote, addTrack, barSteps, changeNote, isBlack, newSong, noteAt, noteName, parseSong, removeNote, removeTrack, renderSong, serializeSong, setLength,
    setTempo, songSeconds, stepSeconds, transpose, updateTrack, synthTrack, type Song, type Wave,
  } from "../lib/song";
  import { encodeWav, toBase64, frames, type Sound } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseSong(text));
  const error = parsed.ok ? "" : parsed.error;
  let song: Song = $state.raw(parsed.ok ? parsed.song : newSong());
  let track = $state(0);
  let selected: number | null = $state(null); // index into the track's notes
  let noteLen = $state(1);
  let loop = $state(true);
  let playing = $state(false);
  let playhead = $state(0); // steps
  const oggPath = untrack(() => filePath).replace(/\.song\.json$/i, ".ogg");
  const songName = oggPath.slice(oggPath.lastIndexOf("/") + 1).replace(/\.ogg$/, "");

  // ---- history ------------------------------------------------------------------------------------------
  const past: Song[] = [];
  let future: Song[] = [];
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && past.length > 0);
  const canRedo = $derived(tick >= 0 && future.length > 0);
  function commit(next: Song, keep = false) {
    if (!keep) {
      past.push(song);
      if (past.length > 200) past.shift();
      future = [];
    }
    song = next;
    tick++;
    studio.sessions.set(filePath, { song });
    studio.edit(filePath, serializeSong(next));
    if (playing) schedule();
  }
  function undo() {
    const p = past.pop();
    if (!p) return;
    future.push(song);
    commit(p, true);
    track = Math.min(track, song.tracks.length - 1);
    selected = null;
  }
  function redo() {
    const n = future.pop();
    if (!n) return;
    past.push(song);
    commit(n, true);
  }

  onMount(() => {
    if (error) return;
    studio.sessions.set(filePath, { song });
    studio.saveHooks.set(filePath, async () => {
      const current = (studio.sessions.get(filePath) as { song: Song } | undefined)?.song ?? song;
      const wav = encodeWav(renderSong(current));
      await studio.writeMusicOgg(oggPath, `data:audio/wav;base64,${toBase64(wav)}`);
    });
    return () => stopPlayback();
  });

  // ---- playback ------------------------------------------------------------------------------------------
  let audio: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let startedAt = 0; // audio time when step 0 of the current pass started
  let raf = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  function toAudioBuffer(ctx: AudioContext, s: Sound) {
    const b = ctx.createBuffer(2, frames(s), s.rate);
    b.copyToChannel(s.channels[0]! as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(s.channels[1]! as Float32Array<ArrayBuffer>, 1);
    return b;
  }
  const buffer = () => toAudioBuffer(audio!, renderSong(song));
  function begin(offsetSeconds: number) {
    audio ??= new AudioContext();
    void audio.resume();
    try { source?.stop(); } catch { /* already stopped */ }
    const node = audio.createBufferSource();
    node.buffer = buffer();
    node.loop = loop;
    node.connect(audio.destination);
    node.onended = () => { if (source === node && !loop) stopPlayback(); };
    const offset = Math.max(0, Math.min(offsetSeconds, node.buffer.duration - 0.001));
    node.start(0, offset);
    source = node;
    startedAt = audio.currentTime - offset;
    playing = true;
    cancelAnimationFrame(raf);
    const frame = () => {
      if (!playing || !audio) return;
      const seconds = songSeconds(song);
      let t = audio.currentTime - startedAt;
      t = loop ? t % seconds : Math.min(t, seconds);
      playhead = t / stepSeconds(song);
      raf = requestAnimationFrame(frame);
    };
    frame();
  }
  function stopPlayback() {
    playing = false;
    cancelAnimationFrame(raf);
    clearTimeout(debounce);
    try { source?.stop(); } catch { /* already stopped */ }
    source = undefined;
  }
  /// Edits while playing re-render a moment later and carry on from the same place.
  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (playing && audio) begin(((audio.currentTime - startedAt) % songSeconds(song)) || 0);
    }, 250);
  }
  const toggle = () => (playing ? stopPlayback() : begin(0));

  /// A short audition of one note with the track's instrument.
  function ping(pitch: number) {
    const t = song.tracks[track]!;
    const one: Song = { ...song, length: 8, tracks: [{ ...t, mute: false, pan: 0, notes: [{ step: 0, len: 2, pitch, vel: 0.9 }] }] };
    audio ??= new AudioContext();
    void audio.resume();
    const n = audio.createBufferSource();
    n.buffer = toAudioBuffer(audio, renderSong(one));
    n.connect(audio.destination);
    n.start();
  }

  // ---- piano roll -----------------------------------------------------------------------------------------
  const STEP_W = 26;
  const ROW_H = 16;
  const KEYS_W = 54;
  const LOW = 36;
  const HIGH = 84;
  const current = $derived(song.tracks[track]!);
  const rowsOf = (kind: "synth" | "drums") => (kind === "drums" ? DRUMS.map((d) => d.pitch) : Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i));
  const rows = $derived(rowsOf(current.kind));
  const pitchOfRow = (r: number) => rows[r]!;
  const labelOf = (pitch: number) => (current.kind === "drums" ? (DRUMS.find((d) => d.pitch === pitch)?.name ?? String(pitch)) : noteName(pitch));
  let canvas: HTMLCanvasElement | undefined = $state();

  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    const w = KEYS_W + song.length * STEP_W;
    const h = rows.length * ROW_H;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, w, h);
    rows.forEach((pitch, r) => {
      const y = r * ROW_H;
      ctx.fillStyle = current.kind === "drums" ? (r % 2 ? "#1a1d24" : "#171a20") : isBlack(pitch) ? "#1a1d24" : "#1e222a";
      ctx.fillRect(KEYS_W, y, w - KEYS_W, ROW_H);
      ctx.fillStyle = isBlack(pitch) && current.kind === "synth" ? "#22262f" : "#2b303b";
      ctx.fillRect(0, y, KEYS_W - 1, ROW_H - 1);
      if (pitch % 12 === 0 || current.kind === "drums") {
        ctx.fillStyle = "#8b93a3";
        ctx.font = "10px system-ui";
        ctx.textBaseline = "middle";
        ctx.fillText(labelOf(pitch), 6, y + ROW_H / 2);
      }
    });
    const bar = barSteps(song);
    for (let s = 0; s <= song.length; s++) {
      ctx.strokeStyle = s % bar === 0 ? "#4a5163" : s % song.stepsPerBeat === 0 ? "#333948" : "#262a34";
      ctx.beginPath();
      ctx.moveTo(KEYS_W + s * STEP_W + 0.5, 0);
      ctx.lineTo(KEYS_W + s * STEP_W + 0.5, h);
      ctx.stroke();
    }
    // other tracks as faint ghosts (same rows only)
    song.tracks.forEach((t, ti) => {
      if (ti === track || t.kind !== current.kind) return;
      ctx.fillStyle = "rgba(140,150,170,.25)";
      for (const n of t.notes) {
        const r = rows.indexOf(n.pitch);
        if (r >= 0) ctx.fillRect(KEYS_W + n.step * STEP_W + 1, r * ROW_H + 2, n.len * STEP_W - 2, ROW_H - 4);
      }
    });
    current.notes.forEach((n, i) => {
      const r = rows.indexOf(n.pitch);
      if (r < 0) return;
      ctx.fillStyle = i === selected ? "#ffd166" : current.mute ? "#5a6a85" : "#5aa9ff";
      ctx.globalAlpha = 0.5 + 0.5 * n.vel;
      ctx.fillRect(KEYS_W + n.step * STEP_W + 1, r * ROW_H + 1, n.len * STEP_W - 2, ROW_H - 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(KEYS_W + (n.step + n.len) * STEP_W - 4, r * ROW_H + 1, 3, ROW_H - 2);
    });
    if (playing) {
      ctx.strokeStyle = "#6fcf8e";
      ctx.lineWidth = 2;
      const x = KEYS_W + playhead * STEP_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  $effect(() => {
    song; track; selected; playing; playhead; canvas; rows;
    draw();
  });

  let gesture: { kind: "move" | "resize"; before: Song; grabStep: number; origStep: number; origLen: number; moved: boolean } | null = null;
  function cellOf(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    const x = e.clientX - r.left - KEYS_W;
    const y = e.clientY - r.top;
    return { step: Math.floor(x / STEP_W), row: Math.floor(y / ROW_H), x };
  }
  function down(e: PointerEvent) {
    const c = cellOf(e);
    if (c.x < 0 || c.row < 0 || c.row >= rows.length || c.step < 0 || c.step >= song.length) return;
    const pitch = pitchOfRow(c.row);
    const hit = noteAt(current, c.step, pitch);
    if (e.button === 2) {
      e.preventDefault();
      if (hit >= 0) {
        commit(removeNote(song, track, hit));
        selected = null;
      }
      return;
    }
    if (e.button !== 0) return;
    canvas!.setPointerCapture(e.pointerId);
    if (hit >= 0) {
      selected = hit;
      const n = current.notes[hit]!;
      const nearEnd = c.x > (n.step + n.len) * STEP_W - 7;
      gesture = { kind: nearEnd ? "resize" : "move", before: song, grabStep: c.step, origStep: n.step, origLen: n.len, moved: false };
      ping(n.pitch);
    } else {
      const r = addNote(song, track, { step: c.step, len: noteLen, pitch, vel: 0.8 });
      if (r.index >= 0) {
        commit(r.song);
        selected = r.index;
        ping(pitch);
      }
    }
  }
  function move(e: PointerEvent) {
    if (!gesture || selected === null) return;
    const c = cellOf(e);
    const n = current.notes[selected];
    if (!n) return;
    let result;
    if (gesture.kind === "resize") {
      result = changeNote(song, track, selected, { len: Math.max(1, c.step - n.step + 1) });
    } else {
      const row = Math.max(0, Math.min(rows.length - 1, c.row));
      result = changeNote(song, track, selected, { step: Math.max(0, Math.min(song.length - 1, gesture.origStep + c.step - gesture.grabStep)), pitch: pitchOfRow(row) });
    }
    if (result.song !== song && result.index >= 0) {
      gesture.moved = true;
      song = result.song;
      selected = result.index;
      tick++;
      studio.sessions.set(filePath, { song });
      studio.edit(filePath, serializeSong(song));
    }
  }
  function up() {
    if (gesture?.moved) {
      past.push(gesture.before);
      future = [];
      tick++;
      if (playing) schedule();
    }
    gesture = null;
  }
  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      commit(removeNote(song, track, selected));
      selected = null;
    } else if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  // ---- controls ---------------------------------------------------------------------------------------------
  const setTrack = (change: Parameters<typeof updateTrack>[2]) => commit(updateTrack(song, track, change));
  const bars = $derived(Math.ceil(song.length / barSteps(song)));
  const setBars = (n: number) => commit(setLength(song, Math.max(1, Math.min(64, Math.round(n))) * barSteps(song)));
  const secs = $derived(songSeconds(song).toFixed(1));
  const slider = (label: string, key: "attack" | "decay" | "sustain" | "release" | "volume" | "pan" | "duty", min: number, max: number, step: number) => ({ label, key, min, max, step });
  const SLIDERS = [slider("Attack", "attack", 0, 1, 0.005), slider("Decay", "decay", 0, 1, 0.005), slider("Sustain", "sustain", 0, 1, 0.01), slider("Release", "release", 0, 2, 0.01), slider("Volume", "volume", 0, 1, 0.01), slider("Pan", "pan", -1, 1, 0.05)];
</script>

<svelte:window onkeydown={key} />

{#if error}
  <div class="bad"><p><strong>This song can't be shown in the editor.</strong></p><p class="dim">{error}</p><button onclick={onjson}>Edit as JSON</button></div>
{:else}
  <div class="song">
    <div class="top">
      <button class="primary" onclick={toggle}>{playing ? "■ Stop" : "▶ Play"}</button>
      <label class="check"><input type="checkbox" bind:checked={loop} onchange={() => playing && begin(0)} /> Loop</label>
      <label>Tempo <input type="number" class="narrow" min="40" max="240" value={song.bpm} onchange={(e) => commit(setTempo(song, Number(e.currentTarget.value)))} /> bpm</label>
      <label>Bars <input type="number" class="narrow" min="1" max="64" value={bars} onchange={(e) => setBars(Number(e.currentTarget.value))} /></label>
      <label>New note <select bind:value={noteLen}>{#each [1, 2, 4, 8, 16] as n (n)}<option value={n}>{n} step{n > 1 ? "s" : ""}</option>{/each}</select></label>
      <span class="dim">{secs} s · saves {oggPath}</span>
      <span class="spacer"></span>
      <button class="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
      <button class="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
      <button class="ghost" onclick={onjson}>JSON</button>
    </div>

    <div class="body">
      <aside class="tracks">
        {#each song.tracks as t, i (i)}
          <div class="trk" class:on={i === track}>
            <button class="pick" onclick={() => { track = i; selected = null; }}>{t.kind === "drums" ? "🥁" : "♪"} {t.name}</button>
            <button class="ghost" title={t.mute ? "Unmute" : "Mute"} aria-label={t.mute ? "Unmute" : "Mute"} onclick={() => { track = i; setTrack({ mute: !t.mute }); }}>{t.mute ? "🔇" : "🔈"}</button>
          </div>
        {/each}
        <div class="add">
          <button onclick={() => { commit(addTrack(song, "synth", "square")); track = song.tracks.length - 1; }}>＋ Lead</button>
          <button onclick={() => { commit(addTrack(song, "synth", "triangle")); track = song.tracks.length - 1; }}>＋ Bass</button>
          <button onclick={() => { commit(addTrack(song, "drums")); track = song.tracks.length - 1; }}>＋ Drums</button>
        </div>
      </aside>

      <div class="roll" role="presentation" oncontextmenu={(e) => e.preventDefault()}>
        <canvas bind:this={canvas} style:width="{KEYS_W + song.length * STEP_W}px" style:height="{rows.length * ROW_H}px" aria-label="Piano roll" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
      </div>

      <aside class="inspector">
        <h3>Track</h3>
        <label>Name <input value={current.name} onchange={(e) => setTrack({ name: e.currentTarget.value })} /></label>
        {#if current.kind === "synth"}
          <label>Sound
            <select value={current.wave} onchange={(e) => setTrack({ wave: e.currentTarget.value as Wave })}>{#each WAVES as w (w)}<option value={w}>{w}</option>{/each}</select>
          </label>
          {#if current.wave === "square"}
            <label class="slider"><span>Width</span><input type="range" min="0.05" max="0.95" step="0.01" value={current.duty} oninput={(e) => setTrack({ duty: Number(e.currentTarget.value) })} /><output>{current.duty.toFixed(2)}</output></label>
          {/if}
          {#each SLIDERS.slice(0, 4) as s (s.key)}
            <label class="slider"><span>{s.label}</span><input type="range" min={s.min} max={s.max} step={s.step} value={current[s.key]} oninput={(e) => setTrack({ [s.key]: Number(e.currentTarget.value) })} /><output>{current[s.key].toFixed(2)}</output></label>
          {/each}
        {/if}
        {#each SLIDERS.slice(4) as s (s.key)}
          <label class="slider"><span>{s.label}</span><input type="range" min={s.min} max={s.max} step={s.step} value={current[s.key]} oninput={(e) => setTrack({ [s.key]: Number(e.currentTarget.value) })} /><output>{current[s.key].toFixed(2)}</output></label>
        {/each}
        {#if current.kind === "synth"}
          <div class="row">
            <button onclick={() => commit(transpose(song, track, -12))} title="Down an octave">−8va</button>
            <button onclick={() => commit(transpose(song, track, -1))}>−1</button>
            <button onclick={() => commit(transpose(song, track, 1))}>+1</button>
            <button onclick={() => commit(transpose(song, track, 12))} title="Up an octave">+8va</button>
          </div>
        {/if}
        <button class="danger" onclick={() => { commit(removeTrack(song, track)); track = Math.min(track, song.tracks.length - 1); selected = null; }} disabled={song.tracks.length <= 1}>Delete track</button>
        <p class="dim small">Click to add a note, drag it to move, drag its right end to resize, right-click or Delete to remove. Space plays. In a game: <code>nova.music.play("{songName}")</code>.</p>
      </aside>
    </div>
  </div>
{/if}

<style>
  .song { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .top { display: flex; align-items: center; gap: 12px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .top label { display: flex; align-items: center; gap: 4px; }
  .check input { margin: 0; }
  .narrow { width: 62px; padding: 2px 6px; }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 150px minmax(0, 1fr) 210px; }
  .tracks { background: var(--panel); border-right: 1px solid var(--line); padding: 6px; display: flex; flex-direction: column; gap: 4px; overflow: auto; }
  .trk { display: flex; align-items: center; border-radius: 6px; }
  .trk.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .pick { flex: 1; text-align: left; background: transparent; border-color: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .roll { overflow: auto; background: #15171c; }
  .roll canvas { display: block; cursor: crosshair; touch-action: none; }
  .inspector { background: var(--panel); border-left: 1px solid var(--line); padding: 8px; display: flex; flex-direction: column; gap: 6px; overflow: auto; }
  h3 { margin: 2px 0 4px; font-size: 13px; }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  .slider { flex-direction: row; align-items: center; gap: 6px; }
  .slider span { width: 54px; flex: none; font-size: 12px; }
  .slider input { flex: 1; min-width: 0; accent-color: var(--accent); }
  .slider output { width: 34px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; }
  .row { display: flex; gap: 4px; } .row button { flex: 1; padding: 4px 2px; }
  .small { font-size: 11px; margin: 4px 0; }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
