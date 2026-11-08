<script lang="ts">
  // Minimise, maximise and close, drawn by the studio at the right end of its top bar on Windows (where the window has no frame).
  import { chromeKind, closeWindow, minimise, toggleMaximise } from "../lib/chrome";
  const show = chromeKind() === "windows";
</script>

{#if show}
  <span class="winbuttons">
    <button class="ghost" aria-label="Minimise" title="Minimise" onclick={() => void minimise()}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
    </button>
    <button class="ghost" aria-label="Maximise" title="Maximise" onclick={() => void toggleMaximise()}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
    </button>
    <button class="ghost close" aria-label="Close" title="Close" onclick={() => void closeWindow()}>
      <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" /></svg>
    </button>
  </span>
{/if}

<style>
  .winbuttons { display: inline-flex; align-self: stretch; margin: -6px -10px -6px 4px; }
  .winbuttons button { width: 46px; border: none; border-radius: 0; display: grid; place-items: center; padding: 0; }
  .winbuttons button:hover { background: var(--panel-2); }
  .winbuttons .close:hover { background: #c42b1c; color: #fff; }
  svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1; }
</style>
