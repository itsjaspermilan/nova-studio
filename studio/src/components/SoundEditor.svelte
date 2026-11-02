<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { DEFAULTS, PRESETS, RANGES, WAVES, fromJson, mulberry32, mutate, randomFrom, render, toJson, type SfxParams, type Wave } from "../lib/sfx";
  import { decodeWav, duration, encodeWav, fade, frames, fromBase64, gain, normalize, peak, reverse, toBase64, trim, trimSilence, waveformPeaks, type Sound } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();

  const fromPath = untrack(() => path);
  const generator = fromPath.endsWith(".sfx.json");
  const wavPath = generator ? fromPath.replace(/\.sfx\.json$/i, ".wav") : fromPath;
  /// Ogg files can only be listened to here; they are made by converting a WAV or by saving a song.
  const isOgg = fromPath.toLowerCase().endsWith(".ogg");
  /// A WAV in music/ is held in memory by the game; as Ogg it is a fraction of the size and streams.
  const convertible = !generator && !isOgg && fromPath.startsWith("music/");

  interface Session {
    params: SfxParams;
    sound: Sound;
    past: Sound[];
    future: Sound[];
  }

  let ready = $state(false);
  let failure = $state("");
  let params: SfxParams = $state.raw({ ...DEFAULTS });
  let sound: Sound = $state.raw({ rate: 44100, channels: [new Float32Array(1)] });
  let selection: [number, number] | null = $state(null); // in frames
  let playing = $state(false);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let session: Session | undefined;
  let canvas: HTMLCanvasElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let width = $state(500);
  const rng = mulberry32(Date.now() & 0xffffff);

  async function load() {
    const existing = studio.sessions.get(fromPath) as Session | undefined;
    try {
      if (existing) session = existing;
      else if (generator) {
        const p = fromJson(text) ?? { ...PRESETS.coin! };
        session = { params: p, sound: render(p), past: [], future: [] };
      } else {
        const url = await studio.api!.readAudio(fromPath);
        session = { params: { ...DEFAULTS }, sound: decodeWav(fromBase64(url.slice(url.indexOf(",") + 1))), past: [], future: [] };
      }
      studio.sessions.set(fromPath, session);
      params = session.params;
      sound = session.sound;
      canUndo = session.past.length > 0;
      canRedo = session.future.length > 0;
      if (!isOgg) {
        studio.saveHooks.set(fromPath, async () => {
          const wav = encodeWav(session!.sound);
          await studio.api!.writeAudio(wavPath, `data:audio/wav;base64,${toBase64(wav)}`);
        });
      }
      ready = true;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  onMount(() => {
    void load();
    return () => stop();
  });

  function commitSound(next: Sound, keepHistory = false) {
    if (!keepHistory) {
      session!.past.push(sound);
      session!.future = [];
    }
    sound = next;
    session!.sound = next;
    canUndo = session!.past.length > 0;
    canRedo = session!.future.length > 0;
    if (!generator) studio.markPending(fromPath);
  }
  /// The generator re-renders from its settings, and the text (JSON) records the settings.
  function setParams(next: SfxParams, audition = false) {
    params = next;
    session!.params = next;
    studio.edit(fromPath, toJson(next));
    commitSound(render(next), true);
    if (audition) play();
  }
  function undo() {
    const prev = session?.past.pop();
    if (!prev) return;
    session!.future.push(sound);
    commitSound(prev, true);
    selection = null;
  }
  function redo() {
    const next = session?.future.pop();
    if (!next) return;
    session!.past.push(sound);
    commitSound(next, true);
  }

  // ---- playback -----------------------------------------------------------------------------
  let audio: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  function stop() {
    try {
      source?.stop();
    } catch {
      // already stopped
    }
    source = undefined;
    playing = false;
  }
  function play() {
    stop();
    audio ??= new AudioContext();
    void audio.resume();
    const from = selection ? selection[0] : 0;
    const to = selection ? selection[1] : frames(sound);
    if (to <= from) return;
    const buffer = audio.createBuffer(sound.channels.length, to - from, sound.rate);
    sound.channels.forEach((c, i) => buffer.copyToChannel(c.slice(from, to), i));
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    node.onended = () => {
      if (source === node) playing = false;
    };
    node.start();
    source = node;
    playing = true;
  }

  // ---- waveform -----------------------------------------------------------------------------
  const HEIGHT = 160;
  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = HEIGHT * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, width, HEIGHT);
    const n = Math.max(1, frames(sound));
    if (selection) {
      ctx.fillStyle = "rgba(90,169,255,.25)";
      const x0 = (selection[0] / n) * width;
      ctx.fillRect(x0, 0, (selection[1] / n) * width - x0, HEIGHT);
    }
    ctx.strokeStyle = "#2c313c";
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2 + 0.5);
    ctx.lineTo(width, HEIGHT / 2 + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#5aa9ff";
    waveformPeaks(sound, Math.floor(width)).forEach((p, x) => {
      const y0 = HEIGHT / 2 - p.max * (HEIGHT / 2 - 4);
      const y1 = HEIGHT / 2 - p.min * (HEIGHT / 2 - 4);
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    });
  }
  $effect(() => {
    sound; selection; width; canvas; ready;
    draw();
  });
  $effect(() => {
    if (!box) return;
    const watch = new ResizeObserver(() => (width = Math.max(200, box!.clientWidth)));
    watch.observe(box);
    return () => watch.disconnect();
  });

  let dragFrom: number | null = null;
  const frameAt = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return Math.max(0, Math.min(frames(sound), Math.round(((e.clientX - r.left) / r.width) * frames(sound))));
  };
  function down(e: PointerEvent) {
    if (generator) return;
    canvas!.setPointerCapture(e.pointerId);
    dragFrom = frameAt(e);
    selection = null;
  }
  function move(e: PointerEvent) {
    if (dragFrom === null) return;
    const f = frameAt(e);
    selection = f === dragFrom ? null : [Math.min(dragFrom, f), Math.max(dragFrom, f)];
  }
  const up = () => (dragFrom = null);

  // ---- editing (wav mode) -----------------------------------------------------------------------
  const sel = () => selection ?? ([0, frames(sound)] as [number, number]);
  const apply = (f: (s: Sound) => Sound) => commitSound(f(sound));
  function trimToSelection() {
    if (!selection) return;
    apply((s) => trim(s, selection![0], selection![1]));
    selection = null;
  }
  function cutSelection() {
    if (!selection) return;
    const [a, b] = selection;
    apply((s) => ({ rate: s.rate, channels: s.channels.map((c) => Float32Array.from([...c.subarray(0, a), ...c.subarray(b)])) }));
    selection = null;
  }
  function fadeSelection(kind: "in" | "out") {
    const [a, b] = sel();
    apply((s) => {
      const part = fade(trim(s, a, b), kind === "in" ? (b - a) / s.rate : 0, kind === "out" ? (b - a) / s.rate : 0);
      return { rate: s.rate, channels: s.channels.map((c, i) => Float32Array.from([...c.subarray(0, a), ...part.channels[i]!, ...c.subarray(b)])) };
    });
  }
  const seconds = (s: Sound) => `${duration(s).toFixed(2)} s`;
  const fmtParam = (key: keyof typeof RANGES) => `${Number(params[key].toFixed(3))}${RANGES[key].unit ? ` ${RANGES[key].unit}` : ""}`;

  const GROUPS: { title: string; keys: (keyof typeof RANGES)[] }[] = [
    { title: "Tone", keys: ["freq", "freqLimit", "slide", "slideDelta", "duty", "dutySweep"] },
    { title: "Movement", keys: ["vibratoDepth", "vibratoSpeed", "arpSemitones", "arpTime"] },
    { title: "Shape", keys: ["attack", "sustain", "decay", "punch"] },
    { title: "Filter", keys: ["lowpass", "highpass", "volume"] },
  ];

  function keydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !generator) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === " ") {
      e.preventDefault();
      playing ? stop() : play();
    }
  }
</script>

<svelte:window onkeydown={keydown} />

{#if failure}
  <div class="fail"><p><strong>This sound can't be opened.</strong></p><p class="dim">{failure}</p></div>
{:else if !ready}
  <div class="fail dim">Loading…</div>
{:else}
  <div class="sound">
    <div class="main">
      <div class="top">
        <button class="primary" onclick={() => (playing ? stop() : play())}>{playing ? "■ Stop" : "▶ Play"}{selection ? " selection" : ""}</button>
        <span class="dim">{seconds(sound)} · {sound.rate / 1000} kHz · {sound.channels.length === 1 ? "mono" : "stereo"} · peak {Math.round(peak(sound) * 100)}%</span>
        <span class="spacer"></span>
        {#if !generator}
          <button class="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
          <button class="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
        {/if}
      </div>
      <div class="wave" bind:this={box}>
        <canvas bind:this={canvas} style:width="{width}px" style:height="{HEIGHT}px" aria-label="Waveform" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
      </div>

      {#if generator}
        <p class="dim small">Saving writes <code>{wavPath}</code> next to these settings. Play it in a game with <code>nova.sound.play("{fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.sfx\.json$/, "")}")</code>.</p>
        <div class="presets">
          <span class="dim">Start from</span>
          {#each Object.keys(PRESETS) as name (name)}
            <button onclick={() => setParams({ ...PRESETS[name]!, seed: Math.floor(rng() * 1e9) }, true)}>{name}</button>
          {/each}
        </div>
        <div class="presets">
          <button onclick={() => setParams(randomFrom(rng), true)}>🎲 Random</button>
          <button onclick={() => setParams(mutate(params, rng, 0.25), true)}>Mutate</button>
          <button onclick={() => setParams({ ...params, seed: Math.floor(rng() * 1e9) }, true)} title="New randomness for noise">New noise</button>
        </div>
        <div class="grid">
          <label>Wave
            <select value={params.wave} onchange={(e) => setParams({ ...params, wave: e.currentTarget.value as Wave }, true)}>
              {#each WAVES as w (w)}<option value={w}>{w}</option>{/each}
            </select>
          </label>
          {#each GROUPS as g (g.title)}
            <fieldset>
              <legend>{g.title}</legend>
              {#each g.keys as key (key)}
                <label class="slider">
                  <span>{RANGES[key].label}</span>
                  <input type="range" min={RANGES[key].min} max={RANGES[key].max} step={RANGES[key].step} value={params[key]}
                    oninput={(e) => setParams({ ...params, [key]: Number(e.currentTarget.value) })} onchange={play} />
                  <output>{fmtParam(key)}</output>
                </label>
              {/each}
            </fieldset>
          {/each}
        </div>
      {:else if isOgg}
        <p class="dim small">This is an Ogg Vorbis file. The game streams it from <code>{fromPath}</code>, so it stays small in memory. You can listen to it here; to change it, edit the song it came from, or the original sound.</p>
      {:else}
        {#if convertible}
          <div class="convert">
            <div><strong>This music is a WAV file.</strong> The game keeps all of it in memory (about {(frames(sound) * 4 / 1048576).toFixed(1)} MB). As Ogg it is a fraction of that, and it streams.</div>
            <button class="primary" onclick={() => studio.convertToOgg(fromPath)}>Convert to Ogg</button>
          </div>
        {/if}
        <p class="dim small">Drag on the waveform to select a part.</p>
        <div class="presets">
          <button onclick={trimToSelection} disabled={!selection}>Keep selection</button>
          <button onclick={cutSelection} disabled={!selection}>Cut selection</button>
          <button onclick={() => apply((s) => trimSilence(s))}>Trim silence</button>
          <button onclick={() => fadeSelection("in")}>Fade in</button>
          <button onclick={() => fadeSelection("out")}>Fade out</button>
          <button onclick={() => apply((s) => normalize(s))}>Normalise</button>
          <button onclick={() => apply((s) => gain(s, 0.8))}>Quieter</button>
          <button onclick={() => apply((s) => gain(s, 1.25))}>Louder</button>
          <button onclick={() => apply(reverse)}>Reverse</button>
        </div>
        <p class="dim small">Fades and edits apply to the selection, or the whole sound if nothing is selected. Saved as 16-bit WAV.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .sound { height: 100%; overflow: auto; }
  .main { max-width: 760px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
  .top { display: flex; align-items: center; gap: 12px; }
  .spacer { flex: 1; }
  .wave { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #15171c; }
  canvas { display: block; touch-action: none; cursor: crosshair; }
  .presets { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .small { font-size: 12px; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
  fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  legend { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 0 4px; }
  label { display: flex; flex-direction: column; gap: 2px; max-width: 200px; }
  .slider { flex-direction: row; align-items: center; gap: 8px; max-width: none; }
  .slider span { width: 110px; flex: none; color: var(--dim); font-size: 12px; }
  .slider input { flex: 1; min-width: 0; accent-color: var(--accent); }
  .slider output { width: 84px; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
  .convert { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 12px; border: 1px solid var(--warn); border-radius: 8px; background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .fail { padding: 32px; display: grid; place-items: start; gap: 8px; }
</style>
