<script lang="ts">
  // Play, Stop and "Play on device": the menu beside Play lists the Android devices adb can see (the handheld over
  // USB, emulators); picking one builds the game for Android, installs it there and starts it.
  import { studio } from "../lib/store.svelte";
  import { deviceHint } from "../lib/devices";
  import type { AndroidDevice } from "../lib/types";

  let open = $state(false);
  let box: HTMLElement | undefined = $state();

  const toggle = () => {
    open = !open;
    if (open) void studio.findDevices();
  };
  const pick = (d: AndroidDevice) => {
    open = false;
    void studio.playOnDevice(d);
  };
  const outside = (e: PointerEvent) => {
    if (open && box && !box.contains(e.target as Node)) open = false;
  };
  const keys = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") open = false;
  };
</script>

<svelte:window onpointerdown={outside} onkeydown={keys} />

{#if studio.running}
  {#if studio.deviceStep}
    <span class="step" role="status" aria-live="polite"><span class="spin" aria-hidden="true"></span>{studio.deviceStep}…</span>
  {:else if studio.playingOn}
    <span class="on" role="status">on {studio.playingOn.name}</span>
  {/if}
  <button class="danger" onclick={() => studio.stop()} title={studio.playingOn ? "Stop the game on the device" : "Stop the game"}>■ Stop</button>
{:else}
  <div class="group" bind:this={box}>
    <button class="primary play" onclick={() => studio.play()} title="Save and run (⌘↩)">▶ Play</button>
    <button class="primary more" onclick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Play on a device" title="Play on a device (the handheld over USB, or an emulator)">▾</button>
    {#if open}
      <div class="menu" role="menu" aria-label="Play on a device">
        <div class="head">Play on a device</div>
        {#each studio.devices as d (d.serial)}
          {@const hint = deviceHint(d)}
          <button class="device" role="menuitem" disabled={!!hint} onclick={() => pick(d)}>
            <span class="name">▶ {d.name}</span>
            <span class="dim small">{d.serial}{d.serial === studio.preferredDevice?.serial ? " · last used" : ""}</span>
            {#if hint}<span class="hint small">{hint}</span>{/if}
          </button>
        {/each}
        {#if studio.lookingForDevices}
          <p class="dim small">Looking for devices…</p>
        {:else if studio.devicesProblem}
          <p class="problem small">{studio.devicesProblem}</p>
        {/if}
        <div class="foot">
          <button class="ghost small" onclick={() => studio.findDevices()} disabled={studio.lookingForDevices}>Look again</button>
          <span class="dim small">The game is built for Android, installed and started; its log shows in Play. The first build takes a few minutes, later ones seconds.</span>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .group { position: relative; display: flex; }
  .play { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .more { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 1px solid color-mix(in srgb, #fff 35%, transparent); padding-left: 7px; padding-right: 7px; }
  .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 70; width: 320px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px; box-shadow: 0 8px 24px #0006; display: flex; flex-direction: column; gap: 4px; }
  .head { font-weight: 600; padding: 4px 6px; }
  .device { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; width: 100%; padding: 6px 8px; }
  .name { font-weight: 600; }
  .hint { color: var(--warn); white-space: normal; }
  .problem { color: var(--warn); margin: 4px 6px; }
  .foot { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 4px 6px 2px; border-top: 1px solid var(--line); margin-top: 2px; }
  .small { font-size: 12px; }
  .step, .on { font-size: 12px; display: inline-flex; align-items: center; gap: 6px; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent); border-right-color: transparent; animation: spin 0.8s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
