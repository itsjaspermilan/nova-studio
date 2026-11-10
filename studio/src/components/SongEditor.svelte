<script lang="ts">
  import { resizable } from "../lib/resize";
  import { onMount, untrack } from "svelte";
  import {
    DRUMS, INSTRUMENT_PRESETS, WAVES, isInstrument, addNote, addTrack, barSteps, changeNote, isBlack, newSong, noteAt, noteName, parseSong, removeNote, removeTrack, renderSong, serializeSong, setLength,
    setTempo, songSeconds, stepSeconds, transpose, updateTrack, synthTrack, type Song, type Wave,
  } from "../lib/song";
  import { encodeWav, toBase64, frames, type Sound } from "../lib/wav";
  import { studio } from "../lib/store.svelte";
  import MixerPanel from "./MixerPanel.svelte";
  import SongTools from "./SongTools.svelte";
  import { midiToSong, songToMidi } from "../lib/midi";
  import { regionOf } from "../lib/song-tools";
  import { dbfs } from "../lib/mixer";
  import { commands } from "../lib/commands";
  import { copyNotes, deleteNotes, moveNotes, noteKey, notesInBox, pasteNotes, quantizeTrack, repeatSong, setAllVelocities, stemName, stemSong, type ClipNote } from "../lib/song-edit";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseSong(text));
  const error = parsed.ok ? "" : parsed.error;
  let song: Song = $state.raw(parsed.ok ? parsed.song : newSong());
  let track = $state(0);
  let selected: number | null = $state(null); // index into the track's notes
  /// Several notes picked together (Shift-click, or Shift and drag a rectangle, or Cmd/Ctrl+A): they move, copy and delete as one. By `noteKey`.
  let group = $state.raw<Set<string>>(new Set());
  let clipboard: ClipNote[] = [];
  let band = $state.raw<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  let hoverStep = 0;
  $effect(() => {
    track; // (another track: the group belonged to the old one)
    group = new Set();
  });
  let noteLen = $state(1);
  let loop = $state(true);
  /// The lower part shows the mixer, or the notes' loudness bars, or nothing.
  let lower: "mixer" | "velocity" | "tools" | "none" = $state("none");
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
  /// The loudest sample just now, in dB below full scale, for the mixer's live meter (-Infinity when nothing plays).
  let liveDb = $state(-Infinity);
  let analyser: AnalyserNode | undefined;
  let analyserData: Float32Array<ArrayBuffer> | undefined;
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
    if (!analyser) {
      analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(audio.destination);
      analyserData = new Float32Array(analyser.fftSize);
    }
    node.connect(analyser);
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
      if (analyser && analyserData) {
        analyser.getFloatTimeDomainData(analyserData);
        let peak = 0;
        for (const v of analyserData) peak = Math.max(peak, Math.abs(v));
        // (falls away smoothly instead of flickering)
        const db = dbfs(peak);
        liveDb = Math.max(db, Number.isFinite(liveDb) ? liveDb - 1.2 : -Infinity);
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
  }
  function stopPlayback() {
    playing = false;
    liveDb = -Infinity;
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
    // the loop region (tinted) and the markers (a line and a name at the top)
    if (song.loop) {
      ctx.fillStyle = "rgba(111,207,142,.08)";
      ctx.fillRect(KEYS_W + song.loop.from * STEP_W, 0, (song.loop.to - song.loop.from) * STEP_W, h);
      ctx.fillStyle = "#6fcf8e";
      ctx.fillRect(KEYS_W + song.loop.from * STEP_W, 0, 2, h);
      ctx.fillRect(KEYS_W + song.loop.to * STEP_W - 2, 0, 2, h);
    }
    for (const m of song.markers ?? []) {
      ctx.strokeStyle = "rgba(255,160,90,.8)";
      ctx.beginPath();
      ctx.moveTo(KEYS_W + m.step * STEP_W + 0.5, 0);
      ctx.lineTo(KEYS_W + m.step * STEP_W + 0.5, h);
      ctx.stroke();
      ctx.fillStyle = "#ffa05a";
      ctx.font = "10px system-ui";
      ctx.textBaseline = "top";
      ctx.fillText(m.name, KEYS_W + m.step * STEP_W + 3, 2);
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
      ctx.fillStyle = i === selected || group.has(noteKey(n)) ? "#ffd166" : current.mute ? "#5a6a85" : "#5aa9ff";
      ctx.globalAlpha = 0.5 + 0.5 * n.vel;
      ctx.fillRect(KEYS_W + n.step * STEP_W + 1, r * ROW_H + 1, n.len * STEP_W - 2, ROW_H - 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(KEYS_W + (n.step + n.len) * STEP_W - 4, r * ROW_H + 1, 3, ROW_H - 2);
    });
    if (band) {
      ctx.strokeStyle = "#ffd166";
      ctx.fillStyle = "rgba(255,209,102,.12)";
      const [bx, by] = [Math.min(band.x0, band.x1), Math.min(band.y0, band.y1)];
      ctx.fillRect(bx, by, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.abs(band.x1 - band.x0), Math.abs(band.y1 - band.y0));
    }
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
    song; track; selected; playing; playhead; canvas; rows; group; band;
    draw();
  });

  let gesture: { kind: "move" | "resize" | "group"; before: Song; grabStep: number; grabPitch?: number; keys?: Set<string>; origStep: number; origLen: number; moved: boolean } | null = null;
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
    // Shift and drag draws a rectangle that picks the notes in it; Shift-click on a note adds it to or takes it from the group
    if (e.shiftKey) {
      if (hit >= 0 && Math.abs(e.movementX) < 1) {
        const key = noteKey(current.notes[hit]!);
        const next = new Set(group);
        if (selected !== null && next.size === 0) next.add(noteKey(current.notes[selected]!));
        if (next.has(key)) next.delete(key);
        else next.add(key);
        group = next;
        selected = null;
        gesture = null;
        // (a drag that starts on a note is still a rectangle: it turns into one in move())
      }
      const r = canvas!.getBoundingClientRect();
      band = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top };
      return;
    }
    if (hit >= 0 && group.size > 1 && group.has(noteKey(current.notes[hit]!))) {
      gesture = { kind: "group", before: song, grabStep: c.step, grabPitch: pitch, keys: group, origStep: 0, origLen: 0, moved: false };
      ping(current.notes[hit]!.pitch);
      return;
    }
    if (group.size) group = new Set();
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
    const cell = cellOf(e);
    hoverStep = Math.max(0, Math.min(song.length - 1, cell.step));
    if (band && canvas) {
      const r = canvas.getBoundingClientRect();
      band = { ...band, x1: e.clientX - r.left, y1: e.clientY - r.top };
      const s0 = Math.floor((band.x0 - KEYS_W) / STEP_W);
      const s1 = Math.floor((band.x1 - KEYS_W) / STEP_W);
      const r0 = Math.floor(band.y0 / ROW_H);
      const r1 = Math.floor(band.y1 / ROW_H);
      const pitches = [pitchOfRow(Math.max(0, Math.min(rows.length - 1, r0))), pitchOfRow(Math.max(0, Math.min(rows.length - 1, r1)))];
      group = notesInBox(current, s0, s1, Math.min(...pitches), Math.max(...pitches));
      return;
    }
    if (gesture?.kind === "group" && gesture.keys) {
      const c = cellOf(e);
      const row = Math.max(0, Math.min(rows.length - 1, c.row));
      const moved = moveNotes(gesture.before, track, gesture.keys, c.step - gesture.grabStep, pitchOfRow(row) - gesture.grabPitch!);
      if (moved.song !== song) {
        gesture.moved = true;
        song = moved.song;
        group = moved.keys;
        tick++;
        studio.sessions.set(filePath, { song });
        studio.edit(filePath, serializeSong(song));
      }
      return;
    }
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
    if (band) {
      band = null;
      if (group.size === 1) {
        // a single note picked by a rectangle is just that note
        const only = current.notes.findIndex((n) => group.has(noteKey(n)));
        selected = only >= 0 ? only : null;
        group = new Set();
      }
    }
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
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      group = new Set(current.notes.map(noteKey));
      selected = null;
    } else if (mod && e.key.toLowerCase() === "c" && (group.size || selected !== null)) {
      e.preventDefault();
      clipboard = copyNotes(song, track, group.size ? group : new Set([noteKey(current.notes[selected!]!)]));
    } else if (mod && e.key.toLowerCase() === "x" && (group.size || selected !== null)) {
      e.preventDefault();
      const keys = group.size ? group : new Set([noteKey(current.notes[selected!]!)]);
      clipboard = copyNotes(song, track, keys);
      commit(deleteNotes(song, track, keys));
      group = new Set();
      selected = null;
    } else if (mod && e.key.toLowerCase() === "v" && clipboard.length) {
      e.preventDefault();
      const at = playing ? Math.floor(playhead) : hoverStep;
      const r = pasteNotes(song, track, clipboard, at);
      if (r) {
        commit(r.song);
        group = r.keys;
        selected = null;
      } else studio.say("info", "There is no room to paste that here.");
    } else if (e.key === "Escape" && (group.size || selected !== null)) {
      group = new Set();
      selected = null;
    } else if (group.size && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const big = e.shiftKey;
      const ds = e.key === "ArrowLeft" ? -(big ? barSteps(song) : 1) : e.key === "ArrowRight" ? (big ? barSteps(song) : 1) : 0;
      const dp = e.key === "ArrowUp" ? (big ? 12 : 1) : e.key === "ArrowDown" ? -(big ? 12 : 1) : 0;
      const r = moveNotes(song, track, group, ds, dp);
      if (r.song !== song) {
        commit(r.song);
        group = r.keys;
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && group.size) {
      e.preventDefault();
      commit(deleteNotes(song, track, group));
      group = new Set();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      commit(removeNote(song, track, selected));
      selected = null;
    } else if (e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  // ---- loudness bars ---------------------------------------------------------------------------------------
  let velDrag: { ni: number; before: Song; el: HTMLElement } | null = null;
  function velSet(e: PointerEvent) {
    if (!velDrag) return;
    const r = velDrag.el.getBoundingClientRect();
    const vel = Math.round(Math.min(1, Math.max(0.05, 1 - (e.clientY - r.top) / r.height)) * 100) / 100;
    commit(changeNote(song, track, velDrag.ni, { vel }).song, true);
  }
  function velDown(e: PointerEvent, ni: number) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    velDrag = { ni, before: song, el };
    selected = ni;
    velSet(e);
  }
  const velMove = (e: PointerEvent) => velSet(e);
  function velUp() {
    if (velDrag && velDrag.before !== song) {
      past.push(velDrag.before);
      future = [];
    }
    velDrag = null;
  }

  /// Writes one Ogg for each track, music/<song>_<track>.ogg, all the song's length, so a game can layer them (add and remove stems as the action rises).
  async function exportStems() {
    const taken: string[] = [];
    for (const [i, t] of song.tracks.entries()) {
      const name = stemName(songName, t.name, taken);
      taken.push(name);
      const wav = encodeWav(renderSong(stemSong(song, i)));
      await studio.writeMusicOgg(`${oggPath.slice(0, oggPath.lastIndexOf("/") + 1)}${name}.ogg`, `data:audio/wav;base64,${toBase64(wav)}`);
    }
    studio.say("info", `Wrote ${taken.length} stems: ${taken.map((n) => `${n}.ogg`).join(", ")}. Play them together in a game with nova.music.`);
  }

  /// Just the loop region as music/<song>_loop.ogg, with the tails of its last notes wrapped onto its start, so it loops without a seam.
  async function exportLoop() {
    if (!song.loop) return;
    const part = regionOf(song, song.loop.from, song.loop.to);
    const path = `${oggPath.slice(0, oggPath.lastIndexOf("/") + 1)}${songName}_loop.ogg`;
    await studio.writeMusicOgg(path, `data:audio/wav;base64,${toBase64(encodeWav(renderSong(part)))}`);
    studio.say("info", `Wrote ${path}: steps ${song.loop.from} to ${song.loop.to}, ${songSeconds(part).toFixed(1)} s. Play it with nova.music.play and it loops without a gap.`);
  }
  async function exportMidi() {
    const bytes = songToMidi(song);
    const path = `exports/${songName.replace(/[^A-Za-z0-9_-]+/g, "_")}.mid`;
    try {
      await studio.api!.writeExport(path, `data:audio/midi;base64,${toBase64(bytes)}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${path}.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  async function importMidi(file: File) {
    try {
      const r = midiToSong(new Uint8Array(await file.arrayBuffer()));
      commit(r.song);
      track = 0;
      studio.say(r.warnings.length ? "error" : "info", `Read ${file.name}: ${r.song.tracks.length} tracks, ${r.song.length} steps.${r.warnings.length ? " " + r.warnings.join(" ") : ""} Undo brings the old song back.`);
    } catch (e) {
      studio.say("error", `${file.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // The song editor's commands, in the Sound menu and the palette while a song is open.
  $effect(() => {
    const live = () => !!song.tracks[track];
    const offs = [
      commands.register({ id: "song.play", title: "Play or stop the song", menu: "Sound", icon: "play", help: "Space plays and stops while the notes are focused", run: () => toggle() }),
      commands.register({ id: "song.mixer", title: "Show the mixer", menu: "Sound", icon: "settings", keys: ["Mod+Alt+M"], help: "A strip for each track: volume, pan, reverb, mute, solo", run: () => { lower = lower === "mixer" ? "none" : "mixer"; } }),
      commands.register({ id: "song.tools", title: "Show the song tools", menu: "Sound", icon: "settings", help: "Strum, glue, humanise, scales and chords, markers and the loop, a loudness lane, the master", run: () => { lower = lower === "tools" ? "none" : "tools"; } }),
      commands.register({ id: "song.exportLoop", title: "Export the loop", menu: "Sound", icon: "export", help: "Just the loop region, ready to loop in the game", enabled: () => !!song.loop, run: () => void exportLoop() }),
      commands.register({ id: "song.exportMidi", title: "Export as a MIDI file", menu: "Sound", icon: "export", run: () => void exportMidi() }),
      commands.register({ id: "song.loudness", title: "Show the loudness of the notes", menu: "Sound", help: "Drag a bar to change how hard a note is played", run: () => { lower = lower === "velocity" ? "none" : "velocity"; } }),
      commands.register({ id: "song.solo", title: "Solo this track", menu: "Sound", keymaps: { blender: [], nova: [] }, enabled: live, run: () => setTrack({ solo: !current.solo }) }),
      commands.register({ id: "song.mute", title: "Mute this track", menu: "Sound", enabled: live, run: () => setTrack({ mute: !current.mute }) }),
      commands.register({ id: "song.quantize", title: "Snap the notes to the beat", menu: "Sound", help: "Moves every note of this track to the nearest beat step", enabled: live, run: () => commit(quantizeTrack(song, track, song.stepsPerBeat)) }),
      commands.register({ id: "song.repeat", title: "Repeat the song twice over", menu: "Sound", help: "Doubles the length and copies everything into the second half", run: () => { const r = repeatSong(song, 2); if (r) commit(r); else studio.say("info", "That would be longer than a song may be."); } }),
      commands.register({ id: "song.stems", title: "Export each track as its own file", menu: "Sound", icon: "export", help: "One Ogg per track, all the same length, to layer in a game", run: () => void exportStems() }),
      commands.register({ id: "song.addLead", title: "Add a lead track", menu: "Sound", run: () => { commit(addTrack(song, "synth", "square")); track = song.tracks.length - 1; } }),
      commands.register({ id: "song.addBass", title: "Add a bass track", menu: "Sound", run: () => { commit(addTrack(song, "synth", "triangle")); track = song.tracks.length - 1; } }),
      commands.register({ id: "song.addDrums", title: "Add a drum track", menu: "Sound", run: () => { commit(addTrack(song, "drums")); track = song.tracks.length - 1; } }),
    ];
    return () => offs.forEach((off) => off());
  });

  // ---- controls ---------------------------------------------------------------------------------------------
  const setTrack = (change: Parameters<typeof updateTrack>[2]) => commit(updateTrack(song, track, change));
  const bars = $derived(Math.ceil(song.length / barSteps(song)));
  const setBars = (n: number) => commit(setLength(song, Math.max(1, Math.min(64, Math.round(n))) * barSteps(song)));
  const secs = $derived(songSeconds(song).toFixed(1));
  const slider = (label: string, key: "attack" | "decay" | "sustain" | "release" | "volume" | "pan" | "duty", min: number, max: number, step: number) => ({ label, key, min, max, step });
  // the fuller voice: optional fields, shown with their defaults (0 or 1 means off)
  const voice = (label: string, key: "unison" | "detune" | "cutoff" | "resonance" | "sweep" | "sub" | "vibrato" | "reverb", min: number, max: number, step: number, off: number) => ({ label, key, min, max, step, off });
  const VOICE = [voice("Unison", "unison", 1, 7, 1, 1), voice("Detune", "detune", 0, 60, 1, 0), voice("Cutoff", "cutoff", 0, 12000, 50, 0), voice("Resonance", "resonance", 0, 0.9, 0.01, 0), voice("Sweep", "sweep", 0, 1, 0.01, 0), voice("Sub", "sub", 0, 1, 0.01, 0), voice("Vibrato", "vibrato", 0, 0.5, 0.01, 0), voice("Reverb", "reverb", 0, 1, 0.01, 0)];
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
      <span class="seg" role="group" aria-label="Lower part"><button class:on={lower === "none"} onclick={() => (lower = "none")}>Notes</button><button class:on={lower === "velocity"} onclick={() => (lower = "velocity")}>Loudness</button><button class:on={lower === "mixer"} onclick={() => (lower = "mixer")}>Mixer</button><button class:on={lower === "tools"} onclick={() => (lower = "tools")}>Tools</button></span>
      <button class="ghost" onclick={onjson}>JSON</button>
    </div>

    <div class="body">
      <aside class="tracks" use:resizable={{ key: "song.tracks", edge: "right", size: 150, min: 110, max: 400 }}>
        {#each song.tracks as t, i (i)}
          <div class="trk" class:on={i === track}>
            <button class="pick" onclick={() => { track = i; selected = null; }}>{t.kind === "drums" ? "🥁" : "♪"} {t.name}</button>
            <button class="ghost" title={t.mute ? "Unmute" : "Mute"} aria-label={t.mute ? "Unmute" : "Mute"} onclick={() => { track = i; setTrack({ mute: !t.mute }); }}>{t.mute ? "🔇" : "🔈"}</button>
            <button class="ghost solo" class:on={t.solo} aria-pressed={!!t.solo} title="Hear only the soloed tracks" aria-label="Solo {t.name}" onclick={() => { track = i; setTrack({ solo: !t.solo }); }}>S</button>
          </div>
        {/each}
        <div class="add">
          <button onclick={() => { commit(addTrack(song, "synth", "square")); track = song.tracks.length - 1; }}>＋ Lead</button>
          <button onclick={() => { commit(addTrack(song, "synth", "triangle")); track = song.tracks.length - 1; }}>＋ Bass</button>
          <button onclick={() => { commit(addTrack(song, "drums")); track = song.tracks.length - 1; }}>＋ Drums</button>
        </div>
      </aside>

      <div class="mid">
      <div class="roll" role="presentation" oncontextmenu={(e) => e.preventDefault()}>
        <canvas bind:this={canvas} style:width="{KEYS_W + song.length * STEP_W}px" style:height="{rows.length * ROW_H}px" aria-label="Piano roll" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
      </div>
      {#if lower === "velocity"}
        <div class="vel" role="group" aria-label="Loudness of each note">
          <span class="dim small">Loudness of the notes on this track: drag a bar. <button class="ghost" onclick={() => commit(setAllVelocities(song, track, 0.8))}>Set all to 80%</button></span>
          <div class="velbars" style:width="{KEYS_W + song.length * STEP_W}px">
            {#each current.notes as n, ni (ni)}
              <button class="velbar" class:on={ni === selected} style:left="{KEYS_W + n.step * STEP_W}px" style:width="{Math.max(6, n.len * STEP_W - 2)}px" aria-label="Note {ni + 1} loudness {Math.round(n.vel * 100)} percent" onpointerdown={(e) => velDown(e, ni)} onpointermove={velMove} onpointerup={velUp} onpointercancel={velUp}><i style:height="{n.vel * 100}%"></i></button>
            {/each}
          </div>
        </div>
      {/if}
      </div>

      <aside class="inspector" use:resizable={{ key: "song.inspector", edge: "left", size: 210, min: 160, max: 520 }}>
        <h3>Track</h3>
        <label>Name <input value={current.name} onchange={(e) => setTrack({ name: e.currentTarget.value })} /></label>
        {#if current.kind === "synth"}
          <label>Sound
            <select value={current.wave} onchange={(e) => setTrack({ wave: e.currentTarget.value as Wave })}>{#each WAVES as w (w)}<option value={w}>{w}</option>{/each}</select>
          </label>
          <label>Preset
            <select aria-label="Preset sounds" value="" onchange={(e) => { const pr = INSTRUMENT_PRESETS.find((x) => x.name === e.currentTarget.value); if (pr) setTrack(pr.set); e.currentTarget.value = ""; }}>
              <option value="" disabled>Start from…</option>{#each INSTRUMENT_PRESETS as pr (pr.name)}<option value={pr.name}>{pr.name}</option>{/each}
            </select>
          </label>
          {#if current.wave === "fm"}
            <label class="slider" title="The pitch of the bending wave as a multiple of the note: whole numbers sound smooth, others like a bell"><span>Ratio</span><input type="range" min="0.25" max="8" step="0.25" value={current.fmRatio ?? 2} oninput={(e) => setTrack({ fmRatio: Number(e.currentTarget.value) })} /><output>{(current.fmRatio ?? 2).toFixed(2)}</output></label>
            <label class="slider" title="How strongly the tone is bent; it fades as the note rings"><span>Bend</span><input type="range" min="0" max="12" step="0.1" value={current.fmIndex ?? 3} oninput={(e) => setTrack({ fmIndex: Number(e.currentTarget.value) })} /><output>{(current.fmIndex ?? 3).toFixed(1)}</output></label>
          {:else if current.wave === "pluck"}
            <label class="slider" title="How long the string rings"><span>Rings</span><input type="range" min="0" max="1" step="0.01" value={current.damping ?? 0.7} oninput={(e) => setTrack({ damping: Number(e.currentTarget.value) })} /><output>{(current.damping ?? 0.7).toFixed(2)}</output></label>
            <label class="slider"><span>Bright</span><input type="range" min="0" max="1" step="0.01" value={current.brightness ?? 0.6} oninput={(e) => setTrack({ brightness: Number(e.currentTarget.value) })} /><output>{(current.brightness ?? 0.6).toFixed(2)}</output></label>
          {:else if current.wave === "organ"}
            <label class="slider" title="More or fewer of the upper harmonics"><span>Bright</span><input type="range" min="0" max="1" step="0.01" value={current.brightness ?? 0.5} oninput={(e) => setTrack({ brightness: Number(e.currentTarget.value) })} /><output>{(current.brightness ?? 0.5).toFixed(2)}</output></label>
          {/if}
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
        <p class="dim small">Echo (repeats of the sound)</p>
        <label class="slider"><span>Echo</span><input type="range" min="0" max="1" step="0.01" value={current.echo ?? 0} oninput={(e) => setTrack({ echo: Number(e.currentTarget.value) })} /><output>{Math.round((current.echo ?? 0) * 100)}%</output></label>
        <label class="slider"><span>Gap</span><input type="range" min="1" max="16" step="1" value={current.echoTime ?? 2} oninput={(e) => setTrack({ echoTime: Number(e.currentTarget.value) })} /><output>{current.echoTime ?? 2}</output></label>
        <label class="slider"><span>Repeats</span><input type="range" min="0" max="0.85" step="0.01" value={current.echoFeedback ?? 0.4} oninput={(e) => setTrack({ echoFeedback: Number(e.currentTarget.value) })} /><output>{Math.round((current.echoFeedback ?? 0.4) * 100)}%</output></label>
        {#if current.kind === "synth"}
          {#if !isInstrument(current.wave)}
          <p class="dim small">Fuller sound (0 or 1 leaves it off)</p>
          {#each VOICE as v (v.key)}
            <label class="slider"><span>{v.label}</span><input type="range" min={v.min} max={v.max} step={v.step} value={current[v.key] ?? v.off} oninput={(e) => setTrack({ [v.key]: Number(e.currentTarget.value) })} /><output>{(current[v.key] ?? v.off).toFixed(v.step >= 1 ? 0 : 2)}</output></label>
          {/each}
          {/if}
        {:else}
          <label>Kit
            <select value={current.kit ?? "chip"} onchange={(e) => setTrack({ kit: e.currentTarget.value as "chip" | "studio" })}><option value="chip">chip</option><option value="studio">studio</option></select>
          </label>
          <label class="slider"><span>Reverb</span><input type="range" min="0" max="1" step="0.01" value={current.reverb ?? 0} oninput={(e) => setTrack({ reverb: Number(e.currentTarget.value) })} /><output>{(current.reverb ?? 0).toFixed(2)}</output></label>
        {/if}
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
    {#if lower === "tools"}
      <div class="lowerpane"><SongTools {song} {track} {group} commit={(next) => commit(next)} pick={(keys) => (group = keys)} {exportLoop} {exportMidi} {importMidi} /></div>
    {:else if lower === "mixer"}
      <MixerPanel {song} {track} {liveDb} onchange={(next) => commit(next)} onselect={(i) => { track = i; selected = null; }} />
    {/if}
  </div>
{/if}

<style>
  .song { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .top { display: flex; align-items: center; gap: 12px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .top label { display: flex; align-items: center; gap: 4px; }
  .check input { margin: 0; }
  .narrow { width: 62px; padding: 2px 6px; }
  .spacer { flex: 1; }
  .lowerpane { max-height: 40%; min-height: 160px; overflow: auto; border-top: 1px solid var(--line); background: var(--panel); }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; }
  .tracks { background: var(--panel); border-right: 1px solid var(--line); padding: 6px; display: flex; flex-direction: column; gap: 4px; overflow: auto; }
  .trk { display: flex; align-items: center; border-radius: 6px; }
  .trk.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .pick { flex: 1; text-align: left; background: transparent; border-color: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .mid { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .roll { overflow: auto; background: #15171c; flex: 1; min-height: 0; }
  .vel { border-top: 1px solid var(--line); background: var(--panel); padding: 4px 0 0; overflow-x: auto; flex: none; }
  .vel > span { padding: 0 8px; }
  .velbars { position: relative; height: 84px; }
  .velbar { position: absolute; bottom: 0; top: 0; padding: 0; border: none; background: transparent; display: flex; align-items: flex-end; cursor: ns-resize; touch-action: none; }
  .velbar i { display: block; width: 100%; background: var(--accent); opacity: 0.8; border-radius: 2px 2px 0 0; }
  .velbar.on i { background: #ffd166; }
  .seg { display: inline-flex; } .seg button { border-radius: 0; } .seg button:first-child { border-radius: 6px 0 0 6px; } .seg button:last-child { border-radius: 0 6px 6px 0; } .seg button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .solo { padding: 0 6px; font-weight: 600; } .solo.on { background: var(--accent-2); color: #fff; }
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
