<script lang="ts">
  // The mixer: a strip for each track (fader, pan, reverb send, mute, solo) and the master. "Measure levels" renders the song and shows how loud
  // each track and the whole mix are, so you can balance by numbers as well as by ear.
  import { measureLevels, meterFraction, showDb, type Levels } from "../lib/mixer";
  import { MAX_BUSES, MAX_MASTER, setMaster, updateTrack, type Song } from "../lib/song";
  import { addBus, removeBus, routeTrack, sendLevel, setSend, updateBus } from "../lib/song-bus";
  import { FX_TYPES, FX_SPECS, MAX_FX, addFx, removeFx, setFxParam, toggleFx, type Fx, type FxType } from "../lib/fx";

  let { song, track, liveDb = -Infinity, onchange, onselect }: { song: Song; track: number; liveDb?: number; onchange: (next: Song) => void; onselect: (i: number) => void } = $props();
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
  let fxBus: string | null = $state(null);
  let masterFxOpen = $state(false);
  /// The song with the master's effect chain set (a master with nothing else to keep is removed).
  const withMasterFx = (sg: Song, fx: Fx[]): Song => {
    const next = { ...sg };
    const m = { volume: 1, ...(sg.master ?? {}) } as NonNullable<Song["master"]>;
    if (fx.length) m.fx = fx;
    else delete m.fx;
    if (m.volume === 1 && m.lufs === undefined && m.limit === undefined && !m.fx) delete next.master;
    else next.master = m;
    return next;
  };
  const openBus = $derived(song.buses?.find((b) => b.name === fxBus));
  const hot = (db: number) => db > -0.5;
  const set = (i: number, change: Parameters<typeof updateTrack>[2]) => onchange(updateTrack(song, i, change));
</script>

<div class="mixer" role="group" aria-label="Mixer">
  {#each song.tracks as t, i (i)}
    <div class="strip" class:on={i === track} class:quiet={t.mute || (anySolo && !t.solo)} style:border-top="4px solid {t.color ?? 'transparent'}">
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
      <label class="small">Echo<input type="range" min="0" max="1" step="0.01" value={t.echo ?? 0} oninput={(e) => set(i, { echo: Number(e.currentTarget.value) })} aria-label="{t.name} echo" /></label>
      {#if song.buses?.length}
        <label class="small">To<select value={t.bus ?? ""} onchange={(e) => onchange(routeTrack(song, i, e.currentTarget.value || undefined))} aria-label="{t.name} plays into"><option value="">master</option>{#each song.buses as b (b.name)}<option value={b.name}>{b.name}</option>{/each}</select></label>
        {#each song.buses as b (b.name)}
          <label class="small" title="Send some of {t.name} to {b.name}">→{b.name.slice(0, 4)}<input type="range" min="0" max="1" step="0.05" value={sendLevel(song, i, b.name)} oninput={(e) => onchange(setSend(song, i, b.name, Number(e.currentTarget.value)))} aria-label="{t.name} send to {b.name}" /></label>
        {/each}
      {/if}
      <div class="ms">
        <button class:on={t.mute} aria-pressed={t.mute} onclick={() => set(i, { mute: !t.mute })} title="Silence this track">M</button>
        <button class:on={!!t.solo} aria-pressed={!!t.solo} onclick={() => set(i, { solo: !t.solo })} title="Hear only the soloed tracks">S</button>
      </div>
      {#if levels}<span class="db dim">{showDb(levels.tracks[i]!.peakDb)}</span>{/if}
    </div>
  {/each}
  {#each song.buses ?? [] as b (b.name)}
    <div class="strip bus" style:border-top="4px solid {b.color ?? 'var(--accent-2)'}">
      <input class="busname" value={b.name} aria-label="Bus name" onchange={(e) => onchange(updateBus(song, b.name, { name: e.currentTarget.value }))} />
      <input class="fader" type="range" min="0" max={MAX_MASTER} step="0.01" value={b.volume} oninput={(e) => onchange(updateBus(song, b.name, { volume: Number(e.currentTarget.value) }))} aria-label="{b.name} bus volume" aria-valuetext="{Math.round(b.volume * 100)} percent" />
      <output>{Math.round(b.volume * 100)}%</output>
      <label class="small">Pan<input type="range" min="-1" max="1" step="0.05" value={b.pan} oninput={(e) => onchange(updateBus(song, b.name, { pan: Number(e.currentTarget.value) }))} aria-label="{b.name} bus pan" /></label>
      <label class="small">Reverb<input type="range" min="0" max="1" step="0.01" value={b.reverb ?? 0} oninput={(e) => onchange(updateBus(song, b.name, { reverb: Number(e.currentTarget.value) }))} aria-label="{b.name} bus reverb" /></label>
      <div class="ms">
        <button class:on={b.mute} aria-pressed={b.mute} onclick={() => onchange(updateBus(song, b.name, { mute: !b.mute }))} title="Silence this bus">M</button>
        <button onclick={() => (fxBus = fxBus === b.name ? null : b.name)} aria-expanded={fxBus === b.name} title="The bus's effects">fx{b.fx?.length ? ` ${b.fx.length}` : ""}</button>
        <button class="ghost" onclick={() => onchange(removeBus(song, b.name))} aria-label="Remove bus {b.name}" title="Remove this bus (its tracks go to the master)">✕</button>
      </div>
    </div>
  {/each}
  <div class="strip addbus"><button onclick={() => onchange(addBus(song))} disabled={(song.buses?.length ?? 0) >= MAX_BUSES} title="A bus mixes several tracks together: give them one fader, effects and reverb">＋ Bus</button></div>
  <div class="strip master">
    <span class="name">Master</span>
    <div class="meterwrap">
      <input class="fader" type="range" min="0" max={MAX_MASTER} step="0.01" value={song.master?.volume ?? 1} oninput={(e) => onchange(setMaster(song, Number(e.currentTarget.value)))} aria-label="Master volume" aria-valuetext="{Math.round((song.master?.volume ?? 1) * 100)} percent" />
      {#if levels}
        <div class="meter" role="img" aria-label="Master peak {showDb(levels.master.peakDb)}"><i class:hot={hot(levels.master.peakDb)} style:height="{meterFraction(levels.master.peakDb) * 100}%"></i></div>
      {/if}
      <div class="meter live" role="img" aria-label="Level now {showDb(liveDb)}" title="The level of what is playing now"><i class:hot={hot(liveDb)} style:height="{meterFraction(liveDb) * 100}%"></i></div>
    </div>
    <output>{Math.round((song.master?.volume ?? 1) * 100)}%</output>
    {#if levels}<span class="db dim">peak {showDb(levels.master.peakDb)}<br />average {showDb(levels.master.rmsDb)}</span>{/if}
    <button onclick={() => (masterFxOpen = !masterFxOpen)} aria-expanded={masterFxOpen} title="Effects on the whole mix">fx{song.master?.fx?.length ? ` ${song.master.fx.length}` : ""}</button>
    <button onclick={measure} disabled={measuring}>{measuring ? "Measuring…" : "Measure levels"}</button>
  </div>
</div>

{#snippet fxPanel(title: string, list: Fx[] | undefined, apply: (next: Fx[]) => void)}
  <div class="busfx" role="group" aria-label="Effects on {title}">
    <strong>{title} effects</strong>
    {#each list ?? [] as f, i (i)}
      <div class="fxrow">
        <button class:on={f.on !== false} aria-pressed={f.on !== false} onclick={() => apply(toggleFx(list!, i))}>{FX_SPECS[f.type].title}</button>
        {#each FX_SPECS[f.type].params as p (p.key)}
          <label class="small">{p.label}<input type="range" min={p.min} max={p.max} step={p.step} value={f.params[p.key] ?? p.default} oninput={(e) => apply(setFxParam(list!, i, p.key, Number(e.currentTarget.value)))} aria-label="{FX_SPECS[f.type].title} {p.label}" /></label>
        {/each}
        <button class="ghost" aria-label="Remove effect" onclick={() => apply(removeFx(list!, i))}>✕</button>
      </div>
    {/each}
    <select aria-label="Add an effect to {title}" value="" disabled={(list?.length ?? 0) >= MAX_FX} onchange={(e) => { apply(addFx(list ?? [], e.currentTarget.value as FxType)); e.currentTarget.value = ""; }}>
      <option value="" disabled>＋ Add an effect…</option>{#each FX_TYPES as ft (ft)}<option value={ft}>{FX_SPECS[ft].title}</option>{/each}
    </select>
  </div>
{/snippet}
{#if openBus}
  {@render fxPanel(openBus.name, openBus.fx, (next) => onchange(updateBus(song, openBus.name, { fx: next })))}
{/if}
{#if masterFxOpen}
  {@render fxPanel("master", song.master?.fx, (next) => onchange(withMasterFx(song, next)))}
{/if}

<style>
  .busname { width: 100%; text-align: center; font-weight: 600; }
  .busfx { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 6px 10px; background: var(--panel); border-top: 1px solid var(--line); }
  .fxrow { display: flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
  .fxrow button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .addbus { justify-content: center; }
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
