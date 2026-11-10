<script lang="ts">
  // The Engine workspace's header row: which Android device the game runs on, whether it is connected, and a button that plays on it (the ▾ beside Play lists the same devices).
  import { onMount } from "svelte";
  import { studio } from "../lib/store.svelte";
  import { deviceHint, lastDevice, preferredDevice } from "../lib/devices";

  let chosen = $state<string | null>(null);
  const ready = $derived(studio.devices.filter((d) => d.state === "device"));
  const device = $derived(studio.devices.find((d) => d.serial === chosen) ?? preferredDevice(studio.devices, lastDevice()) ?? studio.devices[0] ?? null);
  const problem = $derived(device ? deviceHint(device) : null);
  onMount(() => void studio.findDevices());
</script>

<div class="devrow" role="group" aria-label="Device">
  <span class="dim small">Device</span>
  <select aria-label="Device" value={device?.serial ?? ""} onchange={(e) => (chosen = e.currentTarget.value || null)} disabled={!studio.devices.length}>
    {#each studio.devices as d (d.serial)}<option value={d.serial}>{d.name}</option>{:else}<option value="">none found</option>{/each}
  </select>
  <span class="state" class:ok={device && !problem} title={problem ?? (device ? "Ready: the game can be built for it, installed and started" : "Plug the handheld in with a USB cable and turn on USB debugging")}>● {device ? (problem ? "not ready" : "connected") : "no device"}</span>
  <button class="ghost" onclick={() => studio.findDevices()} disabled={studio.lookingForDevices} title="Look for devices again">{studio.lookingForDevices ? "Looking…" : "Look again"}</button>
  <button onclick={() => device && void studio.playOnDevice(device)} disabled={!device || !!problem || studio.running} title="Build the game for Android, install it on this device and start it">▶ Play on device</button>
  {#if ready.length > 1}<span class="dim small">{ready.length} devices ready</span>{/if}
</div>

<style>
  .devrow { display: flex; align-items: center; gap: 8px; padding: 3px 10px; background: var(--panel); border-bottom: 1px solid var(--line); font-size: 12px; }
  .state { color: var(--dim); }
  .state.ok { color: #6fcf8e; }
</style>
