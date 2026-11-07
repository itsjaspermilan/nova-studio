<script lang="ts">
  import { onMount } from "svelte";
  import { ART, LAUNCHER_SIZES, planPicture, type ArtKind, type KeyStep } from "../lib/store-art";
  import { studio } from "../lib/store.svelte";

  // How to get to the screen the picture should show: after some seconds press a key, then wait for the game to draw.
  let steps: KeyStep[] = $state([]);
  let settle = $state(2);

  type Shot = { image: string | null; busy: boolean; note: string; saved: boolean; existing: string | null };
  const blank = (): Shot => ({ image: null, busy: false, note: "", saved: false, existing: null });
  let shots: Record<ArtKind, Shot> = $state({ icon: blank(), boxart: blank() });

  const name = $derived(studio.project?.name ?? "Game");

  onMount(() => {
    // what the project already has
    for (const kind of ["icon", "boxart"] as const) {
      const file = ART[kind].file;
      if (studio.files.some((f) => f.path === file)) void studio.api!.readImage(file).then((url) => (shots[kind].existing = url)).catch(() => {});
    }
  });

  async function render(kind: ArtKind) {
    const spec = ART[kind];
    const plan = planPicture(steps, settle);
    const shot = shots[kind];
    shot.busy = true;
    shot.note = "";
    shot.saved = false;
    try {
      // the game is saved first so that the picture shows what is on screen now
      if (!(await studio.saveAll())) return;
      const report = await studio.api!.runHeadless({ frames: plan.frames, size: [spec.width, spec.height], press: plan.press, capture: true });
      if (report.image) {
        shot.image = report.image;
        shot.note = `${spec.width}x${spec.height} after ${plan.frames} frames`;
      } else {
        shot.note = `No picture was made.\n${report.log.slice(-6).join("\n")}`;
      }
    } catch (e) {
      shot.note = String(e);
    } finally {
      shot.busy = false;
    }
  }

  async function save(kind: ArtKind) {
    const shot = shots[kind];
    if (!shot.image) return;
    try {
      await studio.api!.writeImage(ART[kind].file, shot.image);
      shot.existing = shot.image;
      shot.saved = true;
      await studio.refreshFiles();
      studio.say("info", `Wrote ${ART[kind].file}`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }

  const addStep = () => (steps = [...steps, { key: "Enter", seconds: steps.length ? steps[steps.length - 1]!.seconds + 1 : 1 }]);
  const shown = (kind: ArtKind) => shots[kind].image ?? shots[kind].existing;
</script>

<div class="art">
  <header>
    <h2>Store art</h2>
    <span class="dim">The picture people see for <strong>{name}</strong>: an app icon and a cover. They are taken from the game itself, so get the game to the screen you like first.</span>
    <span class="spacer"></span>
    <button onclick={() => (studio.tool = null)}>Close</button>
  </header>

  <section class="how">
    <h3>Which screen?</h3>
    <p class="dim">The game starts at its first screen. To show a later one, list what to press and when. A beginner's example: <em>after 1 second press Enter</em> to get past a title screen.</p>
    {#each steps as step, i (i)}
      <div class="step">
        after <input type="number" min="0" step="0.5" bind:value={step.seconds} aria-label={`seconds before press ${i + 1}`} /> seconds press
        <input type="text" bind:value={step.key} placeholder="Enter" aria-label={`key ${i + 1}`} list="art-keys" />
        <button class="ghost" aria-label={`remove press ${i + 1}`} onclick={() => (steps = steps.filter((_, k) => k !== i))}>✕</button>
      </div>
    {/each}
    <datalist id="art-keys">
      {#each ["Enter", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape", "pad:south", "pad:east", "pad:start"] as k (k)}<option value={k}></option>{/each}
    </datalist>
    <div class="row">
      <button onclick={addStep}>＋ Press a key</button>
      <span>then wait <input type="number" min="0" step="0.5" bind:value={settle} aria-label="seconds to wait at the end" /> seconds and take the picture</span>
    </div>
    <p class="dim small">Keys are names like <code>Enter</code>, <code>Space</code>, <code>ArrowRight</code>, <code>a</code>, or a button like <code>pad:south</code>. In a script: <code>nova run --headless --press key:Enter@60 --capture out.png</code> does the same.</p>
  </section>

  <div class="cards">
    {#each ["icon", "boxart"] as const as kind (kind)}
      {@const spec = ART[kind]}
      {@const shot = shots[kind]}
      <section class="card" aria-label={spec.label}>
        <h3>{spec.label} <span class="dim">{spec.width}×{spec.height} → <code>{spec.file}</code></span></h3>
        <div class="stage" class:tall={kind === "boxart"}>
          {#if shown(kind)}
            <img src={shown(kind)} alt={`${spec.label} of ${name}`} class:old={!shot.image} />
          {:else}
            <div class="dim empty">No {spec.file} yet. Press “Take the picture”.</div>
          {/if}
        </div>
        <div class="row">
          <button class="primary" disabled={shot.busy} onclick={() => render(kind)}>{shot.busy ? "Running the game…" : "Take the picture"}</button>
          <button disabled={!shot.image || shot.busy} onclick={() => save(kind)} title={`Writes ${spec.file} into the project`}>Save as {spec.file}</button>
          {#if shot.saved}<span class="ok">Saved</span>{:else if shot.image}<span class="dim">not saved yet</span>{:else if shot.existing}<span class="dim">showing the saved file</span>{/if}
        </div>
        {#if shot.note}<pre class="note">{shot.note}</pre>{/if}

        {#if shown(kind)}
          {#if kind === "icon"}
            <h4>On an Android home screen</h4>
            <div class="launchers">
              {#each LAUNCHER_SIZES as px (px)}
                <figure>
                  <div class="tiles">
                    <img src={shown(kind)} alt={`${px} pixel round icon`} class="round" style={`width:${px / 2}px;height:${px / 2}px`} />
                    <img src={shown(kind)} alt={`${px} pixel square icon`} class="squircle" style={`width:${px / 2}px;height:${px / 2}px`} />
                  </div>
                  <figcaption class="dim small">{px} px</figcaption>
                </figure>
              {/each}
            </div>
            <p class="dim small">Launchers cut the icon to a circle or a rounded square: keep what matters in the middle. Shown at half size.</p>
          {:else}
            <h4>As a cover tile</h4>
            <div class="cover" aria-label="Cover tile">
              <img src={shown(kind)} alt="" />
              <div class="title">{name}</div>
            </div>
            <p class="dim small">A launcher can use <code>boxart.png</code> as the game's cover.</p>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .art { height: 100%; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; overflow: auto; background: var(--bg); }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h2 { margin: 0; font-size: 16px; }
  .spacer { flex: 1; }
  h3 { margin: 0 0 4px; font-size: 13px; }
  h4 { margin: 10px 0 4px; font-size: 12px; }
  .how { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .how p { margin: 2px 0 6px; }
  .step, .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 4px 0; }
  .step input[type="number"], .row input[type="number"] { width: 64px; }
  .step input[type="text"] { width: 120px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; align-items: start; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; min-width: 0; }
  .stage { display: grid; place-items: center; min-height: 160px; max-height: 300px; background: repeating-conic-gradient(#0003 0% 25%, transparent 0% 50%) 0 0 / 16px 16px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-bottom: 6px; }
  .stage.tall { max-height: 360px; }
  .stage img { max-width: 100%; max-height: 300px; object-fit: contain; }
  .stage.tall img { max-height: 360px; }
  .stage img.old { opacity: 0.8; }
  .empty { padding: 24px; text-align: center; }
  .ok { color: var(--ok); }
  .note { margin: 4px 0 0; font-size: 11px; white-space: pre-wrap; color: var(--dim); }
  .launchers { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; }
  .launchers figure { margin: 0; text-align: center; }
  .tiles { display: flex; gap: 8px; align-items: flex-end; }
  .round { border-radius: 50%; }
  .squircle { border-radius: 22%; }
  .cover { position: relative; width: 150px; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 18px #0008; background: #000; }
  .cover img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
  .cover .title { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 8px 6px; font-size: 12px; font-weight: 600; color: #fff; background: linear-gradient(transparent, #000b); }
  .small { font-size: 11px; }
</style>
