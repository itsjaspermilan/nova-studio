<script lang="ts">
  // Edit > Appearance: the theme, the size of everything and reduced motion. Changes show at once.
  import { appearance, MAX_SCALE, MIN_SCALE, type ThemePref } from "../lib/appearance.svelte";

  let { onclose }: { onclose: () => void } = $props();
  const THEMES: { id: ThemePref; title: string; text: string }[] = [
    { id: "system", title: "Match the system", text: "Light or dark as your computer is." },
    { id: "dark", title: "Dark", text: "Easy on the eyes in a dim room." },
    { id: "light", title: "Light", text: "For bright rooms." },
    { id: "contrast", title: "High contrast", text: "Black and white with strong colours, for low vision." },
  ];
  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onclose();
  };
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-label="Appearance" aria-modal="true">
    <h2>Appearance</h2>
    <fieldset>
      <legend>Theme</legend>
      {#each THEMES as t (t.id)}
        <label class="opt" class:on={appearance.theme === t.id}>
          <input type="radio" name="theme" value={t.id} checked={appearance.theme === t.id} onchange={() => appearance.set({ theme: t.id })} />
          <span><strong>{t.title}</strong><br /><span class="dim">{t.text}</span></span>
        </label>
      {/each}
    </fieldset>
    <label class="scale">Size of everything: <strong>{appearance.scale}%</strong>
      <input type="range" min={MIN_SCALE} max={MAX_SCALE} step="5" value={appearance.scale} oninput={(e) => appearance.set({ scale: Number(e.currentTarget.value) })} aria-valuetext="{appearance.scale} percent" />
    </label>
    <label class="flip"><input type="checkbox" checked={appearance.reducedMotion} onchange={(e) => appearance.set({ reducedMotion: e.currentTarget.checked })} /> Reduce motion (no animations)</label>
    <div class="end"><button class="primary" onclick={onclose}>Done</button></div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: 90; padding: 16px; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 20px; width: min(480px, 100%); display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 0; font-size: 17px; }
  fieldset { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  legend { font-weight: 600; margin-bottom: 4px; }
  .opt { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
  .opt.on { border-color: var(--accent); }
  .scale { display: flex; flex-direction: column; gap: 6px; }
  .flip { display: flex; gap: 8px; align-items: center; }
  .end { display: flex; justify-content: flex-end; }
</style>
