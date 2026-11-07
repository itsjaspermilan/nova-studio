<script lang="ts">
  import { health } from "../lib/perf";
  import { studio } from "../lib/store.svelte";

  const p = $derived(studio.perf.latest);
  const state = $derived(health(p));
  const ms = (n: number) => (n > 0 ? n.toFixed(1) : "–");
  const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : String(n));

  /// the frame rate of the last minute as a line (0 at the bottom, 70 at the top)
  const line = $derived(studio.perf.history.map((s, i, all) => `${(i / Math.max(1, all.length - 1)) * 100},${30 - Math.min(30, (s.fps / 70) * 30)}`).join(" "));
</script>

<div class="perf" aria-label="How fast the game runs">
  {#if p}
    <span class="fps {state}" title="Frames a second. 60 is smooth."><strong>{p.fps.toFixed(0)}</strong> fps</span>
    <span title="95 of 100 frames were faster than this; the slowest frame this second">frame <strong>{ms(p.p95)}</strong> ms (95%) · worst <strong>{ms(p.max)}</strong> ms</span>
    <span title="The graphics chip's own time for a frame (– where the computer cannot say)">GPU <strong>{ms(p.gpu)}</strong> ms</span>
    <span title="Your Lua code per frame">Lua <strong>{ms(p.lua)}</strong> ms</span>
    <span title="Draw calls and triangles in the last frame"><strong>{p.draws}</strong> draws · <strong>{big(p.triangles)}</strong> triangles</span>
    <svg class="graph" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={line} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg>
  {:else}
    <span class="dim">{studio.running ? "Waiting for the first numbers (the game reports every second)…" : "Press Play to see how fast the game runs."}</span>
  {/if}
  <span class="spacer"></span>
  {#if studio.perf.hitches.length}<span class="dim" title="Slow frames you can see as a stutter">{studio.perf.hitches.length} hitch{studio.perf.hitches.length === 1 ? "" : "es"} · worst {studio.perf.worst.toFixed(0)} ms</span>{/if}
</div>

{#if studio.perf.hitches.length}
  <div class="hitches" aria-label="Recent hitches">
    <div class="dim small">Hitches (a frame that took too long, from <code>nova.hitch(ms)</code>): newest first</div>
    <table>
      <tbody>
        {#each studio.perf.hitches.slice(0, 8) as h, i (i)}
          <tr><td class="mono">{h.ms.toFixed(1)} ms</td><td class="dim mono">{h.at.toFixed(0)} s in</td><td class="dim">{h.detail}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if studio.running}
  <div class="dim small hint">To list slow frames here, call <code>nova.hitch(25)</code> in your game: it logs every frame that takes more than 25 ms.</div>
{/if}

<style>
  .perf { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: 4px 12px; border-bottom: 1px solid var(--line); font-size: 12px; }
  .fps.good strong { color: var(--ok); }
  .fps.ok strong { color: var(--warn); }
  .fps.slow strong { color: var(--error); }
  .graph { width: 90px; height: 22px; color: var(--accent); border-bottom: 1px solid var(--line); }
  .spacer { flex: 1; }
  .hitches { padding: 2px 12px 4px; border-bottom: 1px solid var(--line); max-height: 82px; overflow: auto; }
  .hitches table { border-collapse: collapse; font-size: 11px; }
  .hitches td { padding: 0 12px 0 0; white-space: nowrap; }
  .hitches td:last-child { white-space: normal; }
  .hint { padding: 2px 12px; }
  .small { font-size: 11px; }
</style>
