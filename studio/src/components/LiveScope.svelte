<script lang="ts">
  // A live analyser while a song plays: the spectrum (how loud each pitch range is, bars on a log scale) and the oscilloscope (the wave itself), both read from the
  // playback's Web Audio analyser. Nothing is drawn while nothing plays.
  let { bins, wave, sides = null, rate }: { bins: Float32Array | null; wave: Float32Array | null; sides?: { l: Float32Array; r: Float32Array } | null; rate: number } = $props();
  let vec: HTMLCanvasElement | undefined = $state();
  let spec: HTMLCanvasElement | undefined = $state();
  let scope: HTMLCanvasElement | undefined = $state();
  import { BARS, liveBars } from "../lib/spectrum";

  $effect(() => {
    const c = spec;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!bins) return;
    const db = liveBars(bins, rate);
    const w = c.width / BARS;
    db.forEach((v, i) => {
      const h = Number.isFinite(v) ? Math.max(0, Math.min(1, (v + 100) / 100)) * c.height : 0;
      ctx.fillStyle = v > -12 ? "#e05a5a" : v > -30 ? "#e0b030" : "#6fcf8e";
      ctx.fillRect(i * w + 1, c.height - h, w - 2, h);
    });
  });
  $effect(() => {
    const c = vec;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#2c313c";
    ctx.beginPath();
    ctx.moveTo(c.width / 2, 0);
    ctx.lineTo(c.width / 2, c.height);
    ctx.moveTo(0, c.height / 2);
    ctx.lineTo(c.width, c.height / 2);
    ctx.stroke();
    if (!sides) return;
    // mid up the screen, side across it: left = right is a vertical line
    ctx.strokeStyle = "rgba(111, 207, 142, 0.7)";
    ctx.beginPath();
    const n = Math.min(sides.l.length, sides.r.length);
    for (let i = 0; i < n; i++) {
      const mid = (sides.l[i]! + sides.r[i]!) * 0.7071;
      const side = (sides.l[i]! - sides.r[i]!) * 0.7071;
      const x = c.width / 2 + side * (c.width / 2 - 2);
      const y = c.height / 2 - mid * (c.height / 2 - 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
  $effect(() => {
    const c = scope;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#15171c";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#2c313c";
    ctx.beginPath();
    ctx.moveTo(0, c.height / 2);
    ctx.lineTo(c.width, c.height / 2);
    ctx.stroke();
    if (!wave) return;
    // start where the wave crosses zero going up, so a steady note holds still
    let start = 0;
    for (let i = 1; i < wave.length / 2; i++) if (wave[i - 1]! < 0 && wave[i]! >= 0) { start = i; break; }
    const n = Math.min(512, wave.length - start);
    ctx.strokeStyle = "#6cb2ff";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * c.width;
      const y = c.height / 2 - wave[start + i]! * (c.height / 2 - 2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
</script>

<div class="live" role="group" aria-label="Live analyser">
  <canvas bind:this={vec} width="80" height="80" aria-label="Vectorscope" title="Vectorscope: left against right. A line up and down is a centred sound, a wide cloud is a wide one, a line across is out of phase."></canvas>
  <canvas bind:this={spec} width="384" height="80" aria-label="Spectrum"></canvas>
  <canvas bind:this={scope} width="256" height="80" aria-label="Oscilloscope"></canvas>
  <span class="dim small">{bins || wave ? "Live: spectrum and wave of what is playing" : "Press play to see the spectrum and the wave"}</span>
</div>

<style>
  .live { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 4px 8px; }
  canvas { border: 1px solid var(--line); border-radius: 4px; background: #15171c; }
</style>
