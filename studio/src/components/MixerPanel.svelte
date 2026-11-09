<script lang="ts">
  // The mixer: a strip for each track (fader, pan, reverb send, mute, solo) and the master. "Measure levels" renders the song and shows how loud
  // each track and the whole mix are, so you can balance by numbers as well as by ear.
  import { measureLevels, meterFraction, showDb, type Levels } from "../lib/mixer";
  import { MAX_MASTER, setMaster, updateTrack, type Song } from "../lib/song";

  let { song, track, onchange, onselect }: { song: Song; track: number; onchange: (next: Song) => void; onselect: (i: number) => void } = $props();
  let levels: Levels | null = $state.raw(null);
  let measuring = $state(false);

  const measure = async () => {
    measuring = true;
    await new Promise((r) => setTimeout(r)); // (lets the button show "Measuring…" before the render)
    try {
      levels = measureLevels(song);
    } finally {
      measuring = false;
    }
  };
  // a change to the song makes the numbers out of date
  $effect(() => {
    song;
    levels = null;
  });
  const anySolo = $derived(song.tracks.some((t) => t.solo));
  const hot = (db: number) => db > -0.5;
  const set = (i: number, change: Parameters<typeof updateTrack>[2]) => onchange(updateTrack(song, i, change));
</script>

<div class="mixer" role="group" aria-label="Mixer">
  {#each song.tracks as t, i (i)}
    <div class="strip" class:on={i === track} class:quiet={t.mute || (anySolo && !t.solo)}>
      <button class="name ghost" onclick={() => onselect(i)} title="Edit this track's notes and sound">{t.name}</button>
      <div class="meterwrap">
        <input class="fader" type="range" min="0" max="1" step="0.01" value={t.volume} oninput={(e) => set(i, { volume: Number(e.currentTarget.value) })} aria-label="{t.name} volume" aria-valuetext="{Math.round(t.volume * 100)} percent" />
        {#if levels}
          <div class="meter" role="img" aria-label="{t.name} peak {showDb(levels.tracks[i]!.peakDb)}"><i class:hot={hot(levels.tracks[i]!.peakDb)} style:height="{meterFraction(levels.tracks[i]!.peakDb) * 100}%"></i></div>
        {/if}
      </div>
      <output>{Math.round(t.volume * 100)}%</output>
      <label class="small">Pan<input type="range" min="-1" max="1" step="0.05" value={t.pan} oninput={(e) => set(i, { pan: Number(e.currentTarget.value) })} aria-label="{t.name} pan" /></label>
      <label class="small">Reverb<input type="range" min="0" max="1" step="0.01" value={t.reverb ?? 0} oninput={(e) => set(i, { reverb: Number(e.currentTarget.value) })} aria-label="{t.name} reverb" /></label>
      <div class="ms">
        <button class:on={t.mute} aria-pressed={t.mute} onclick={() => set(i, { mute: !t.mute })} title="Silence this track">M</button>
        <button class:on={!!t.solo} aria-pressed={!!t.solo} onclick={() => set(i, { solo: !t.solo })} title="Hear only the soloed tracks">S</button>
      </div>
      {#if levels}<span class="db dim">{showDb(levels.tracks[i]!.peakDb)}</span>{/if}
    </div>
  {/each}
  <div class="strip master">
    <span class="name">Master</span>
    <div class="meterwrap">
      <input class="fader" type="range" min="0" max={MAX_MASTER} step="0.01" value={song.master?.volume ?? 1} oninput={(e) => onchange(setMaster(song, Number(e.currentTarget.value)))} aria-label="Master volume" aria-valuetext="{Math.round((song.master?.volume ?? 1) * 100)} percent" />
      {#if levels}
        <div class="meter" role="img" aria-label="Master peak {showDb(levels.master.peakDb)}"><i class:hot={hot(levels.master.peakDb)} style:height="{meterFraction(levels.master.peakDb) * 100}%"></i></div>
      {/if}
    </div>
    <output>{Math.round((song.master?.volume ?? 1) * 100)}%</output>
    {#if levels}<span class="db dim">peak {showDb(levels.master.peakDb)}<br />average {showDb(levels.master.rmsDb)}</span>{/if}
    <button onclick={measure} disabled={measuring}>{measuring ? "Measuring…" : "Measure levels"}</button>
  </div>
</div>

<style>
  .mixer { display: flex; gap: 8px; padding: 8px 10px; overflow-x: auto; align-items: stretch; background: var(--panel); border-top: 1px solid var(--line); }
  .strip { width: 96px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); }
  .strip.on { border-color: var(--accent); }
  .strip.quiet .fader, .strip.quiet .name { opacity: 0.5; }
  .strip.master { margin-left: auto; width: 128px; }
  .name { width: 100%; text-align: center; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meterwrap { display: flex; gap: 6px; height: 112px; }
  .fader { writing-mode: vertical-lr; direction: rtl; width: 22px; height: 112px; accent-color: var(--accent); }
  .meter { width: 8px; height: 112px; background: var(--bg); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
  .meter i { display: block; width: 100%; background: var(--ok); }
  .meter i.hot { background: var(--error); }
  output { font-size: 11px; font-variant-numeric: tabular-nums; }
  .small { flex-direction: row; display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--dim); width: 100%; }
  .small input { flex: 1; min-width: 0; accent-color: var(--accent); }
  .ms { display: flex; gap: 4px; }
  .ms button { width: 28px; padding: 2px 0; }
  .ms button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .db { font-size: 10px; text-align: center; }
</style>
