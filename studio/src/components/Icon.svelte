<script lang="ts">
  // One of the studio's icons (lib/icons.ts). Decorative by default (the control that holds it has the name); pass `label` where it stands alone.
  import { hasIcon, ICONS } from "../lib/icons";

  let { name, size = 16, label }: { name: string | undefined; size?: number; label?: string } = $props();
  const d = $derived(name && hasIcon(name) ? ICONS[name] : "");
</script>

{#if d}
  <svg class="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
    <path {d} />
  </svg>
{/if}

<style>
  .icon { flex: none; vertical-align: -3px; }
</style>
