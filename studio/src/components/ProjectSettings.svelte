<script lang="ts">
  // The project's settings page: the game's name and entry, the picture size and graphics options, the wifi switch, and the input actions with
  // what presses them. It edits nova.json as text (lib/project-settings.ts), so the file stays a plain file a person could have typed.
  import { onDestroy } from "svelte";
  import {
    GRAPHICS_KEYS, MOUSE_BUTTONS, PAD_AXES, PAD_BUTTONS, TOUCH_ZONES, actionsOf, addSource, checkSettings, describeSource, isValidSource, parseManifest, removeAction, removeSource, renameAction, setAction, setGraphics, setKey,
    sourceFromKeyCode, usedBy, type GraphicsKey,
  } from "../lib/project-settings";
  import { studio } from "../lib/store.svelte";

  let { path, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = $derived(parseManifest(text));
  const obj = $derived(parsed.ok ? parsed.obj : {});
  const graphics = $derived(((obj.graphics as Record<string, unknown> | undefined) ?? {}) as Record<GraphicsKey, unknown>);
  const actions = $derived(actionsOf(obj));
  const problems = $derived(parsed.ok ? checkSettings(obj, studio.files.filter((f) => !f.dir).map((f) => f.path)) : []);
  const luaFiles = $derived(studio.files.filter((f) => !f.dir && f.path.endsWith(".lua")).map((f) => f.path));

  const edit = (next: string) => {
    if (next !== text) studio.edit(path, next);
  };
  const setNumberOrClear = (key: string, raw: string) => edit(setKey(text, key, raw.trim() === "" ? undefined : Number(raw)));
  const setText = (key: string, value: string) => edit(setKey(text, key, value.trim() === "" ? undefined : value));
  const gfx = (key: GraphicsKey, value: unknown) => edit(setGraphics(text, key, value));
  const SWITCH_CLASS: Record<GraphicsKey, unknown> = { hdr: true, msaa: 4, shadow_cascades: 3, ibl: true, anisotropy: 16 };
  function graphicsPreset(on: boolean) {
    let t = text;
    for (const k of GRAPHICS_KEYS) t = setGraphics(t, k, on ? SWITCH_CLASS[k] : undefined);
    edit(t);
  }
  const heightPresets = [{ v: 540, label: "540 (default, light on a handheld)" }, { v: 720, label: "720" }, { v: 1080, label: "1080" }, { v: 0, label: "The screen's own size" }];
  const worldHeight = $derived(typeof obj.world_height === "number" ? obj.world_height : 540);

  // ---- input actions -------------------------------------------------------------------------------
  let newAction = $state("");
  let newKind = $state<"button" | "axis">("button");
  let capturing = $state<{ action: string; side?: "negative" | "positive" } | null>(null);
  const nameOk = $derived(/^[A-Za-z_][A-Za-z0-9_]*$/.test(newAction) && !actions.some((a) => a.name === newAction));
  function addAction() {
    if (!nameOk) return;
    edit(setAction(text, newAction, newKind === "axis" ? { negative: [], positive: [] } : []));
    newAction = "";
  }
  function onKey(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      capturing = null;
      return;
    }
    const s = sourceFromKeyCode(e.code);
    if (s) edit(addSource(text, capturing.action, s, capturing.side));
    capturing = null;
  }
  $effect(() => {
    if (!capturing) return;
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  onDestroy(() => (capturing = null));

  const sourceChoices: { group: string; items: string[] }[] = [
    { group: "Gamepad button", items: PAD_BUTTONS.map((b) => `pad:${b}`) },
    { group: "Stick or trigger", items: PAD_AXES.flatMap((a) => [`axis:${a}`, `axis:${a}-`, `axis:${a}+`]) },
    { group: "Mouse", items: MOUSE_BUTTONS.map((b) => `mouse:${b}`) },
    { group: "Touch", items: TOUCH_ZONES.map((z) => `touch:${z}`) },
  ];
  function pickSource(action: string, value: string, side?: "negative" | "positive") {
    if (value && isValidSource(value)) edit(addSource(text, action, value, side));
  }
  let renameFrom = $state<string | null>(null);
</script>

<div class="settings">
  <div class="bar">
    <h2>Project settings</h2>
    <button class="ghost" onclick={onjson}>{"{ }"} Edit the file</button>
  </div>
  {#if !parsed.ok}
    <p class="warn">nova.json cannot be read: {parsed.error}. Fix it in the file ({"{ }"} above) and this page comes back.</p>
  {:else}
    {#if problems.length}
      <ul class="problems" aria-label="Problems with the settings">
        {#each problems as p (p.field + p.message)}<li><code>{p.field}</code> {p.message}</li>{/each}
      </ul>
    {/if}

    <section>
      <h3>The game</h3>
      <label>Name <input value={typeof obj.name === "string" ? obj.name : ""} onchange={(e) => setText("name", e.currentTarget.value)} /></label>
      <label>Version <input value={typeof obj.version === "string" ? obj.version : ""} placeholder="0.1.0" onchange={(e) => setText("version", e.currentTarget.value)} /></label>
      <label>First script
        <select value={typeof obj.entry === "string" ? obj.entry : "main.lua"} onchange={(e) => setText("entry", e.currentTarget.value === "main.lua" ? "" : e.currentTarget.value)}>
          {#each luaFiles as f (f)}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label class="check"><input type="checkbox" checked={obj.local_network === true} onchange={(e) => edit(setKey(text, "local_network", e.currentTarget.checked ? true : undefined))} /> Play with other devices on the same wifi <span class="dim">(an Android build then asks for network access)</span></label>
    </section>

    <section>
      <h3>Picture</h3>
      <label>Size of the world picture
        <select value={heightPresets.some((p) => p.v === worldHeight) ? worldHeight : -1} onchange={(e) => { const v = Number(e.currentTarget.value); if (v >= 0) edit(setKey(text, "world_height", v === 540 ? undefined : v)); }}>
          {#each heightPresets as p (p.v)}<option value={p.v}>{p.label}</option>{/each}
          {#if !heightPresets.some((p) => p.v === worldHeight)}<option value={-1}>{worldHeight} (set in the file)</option>{/if}
        </select>
      </label>
      <p class="dim small">The 3D world and background sprites draw at this height and are scaled to the screen; text and HUD always draw at the screen's own size. Bigger looks sharper and costs more on a handheld.</p>
      <label>Sprites
        <select value={obj.sprite_filter === "smooth" ? "smooth" : "pixel"} onchange={(e) => edit(setKey(text, "sprite_filter", e.currentTarget.value === "pixel" ? undefined : "smooth"))}>
          <option value="pixel">Sharp pixels (pixel art)</option>
          <option value="smooth">Smooth (drawn pictures)</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" checked={obj.materials === true} onchange={(e) => edit(setKey(text, "materials", e.currentTarget.checked ? true : undefined))} /> Light models by their materials <span class="dim">{Array.isArray(obj.materials) ? `(now only ${obj.materials.length} named model${obj.materials.length === 1 ? "" : "s"}; ticking this does all of them)` : "(normal, metal, rough and glowing parts)"}</span></label>
    </section>

    <section>
      <h3>Graphics quality <span class="dim small">all off unless you turn them on</span></h3>
      <div class="row">
        <button onclick={() => graphicsPreset(true)} title="HDR, 4x smoothing, three shadow layers, sky light, sharp far textures: what the Switch-class look uses">Switch-class look</button>
        <button class="ghost" onclick={() => graphicsPreset(false)}>All off</button>
      </div>
      <label class="check"><input type="checkbox" checked={graphics.hdr === true} onchange={(e) => gfx("hdr", e.currentTarget.checked ? true : undefined)} /> HDR light and glow</label>
      <label>Edge smoothing
        <select value={String(graphics.msaa ?? 1)} onchange={(e) => gfx("msaa", e.currentTarget.value === "1" ? undefined : Number(e.currentTarget.value))}>
          <option value="1">Off</option><option value="2">2x</option><option value="4">4x</option>
        </select>
      </label>
      <label>Sun shadow layers
        <select value={String(graphics.shadow_cascades ?? 0)} onchange={(e) => gfx("shadow_cascades", e.currentTarget.value === "0" ? undefined : Number(e.currentTarget.value))}>
          {#each [0, 1, 2, 3, 4] as n (n)}<option value={String(n)}>{n === 0 ? "Off" : n}</option>{/each}
        </select>
      </label>
      <label class="check"><input type="checkbox" checked={graphics.ibl === true} onchange={(e) => gfx("ibl", e.currentTarget.checked ? true : undefined)} /> Light from the sky</label>
      <label>Sharp far textures
        <select value={String(graphics.anisotropy ?? 1)} onchange={(e) => gfx("anisotropy", e.currentTarget.value === "1" ? undefined : Number(e.currentTarget.value))}>
          {#each [1, 2, 4, 8, 16] as n (n)}<option value={String(n)}>{n === 1 ? "Off" : `${n}x`}</option>{/each}
        </select>
      </label>
    </section>

    <section class="wide">
      <h3>Controls <span class="dim small">what the player presses for each action; the game asks for actions by name</span></h3>
      <p class="dim small">Use <code>nova.input.down("jump")</code> in Lua. Several sources per action are fine. An action here replaces a built-in one of the same name.</p>
      {#each actions as a (a.name)}
        <div class="action">
          <div class="head">
            {#if renameFrom === a.name}
              <input class="name" value={a.name} aria-label="Action name" onchange={(e) => { edit(renameAction(text, a.name, e.currentTarget.value.trim())); renameFrom = null; }} onblur={() => (renameFrom = null)} onkeydown={(e) => { if (e.key === "Escape") renameFrom = null; }} />
            {:else}
              <button class="ghost nm" title="Rename" onclick={() => (renameFrom = a.name)}>{a.name}</button>
            {/if}
            <span class="dim small">{a.axis ? "axis, -1 to 1" : "button"}</span>
            <button class="ghost danger" aria-label="Delete {a.name}" title="Delete this action" onclick={() => edit(removeAction(text, a.name))}>✕</button>
          </div>
          {#each (a.axis ? (["negative", "positive"] as const) : ([undefined] as const)) as side (side ?? "button")}
            <div class="sources">
              {#if side}<span class="side">{side === "negative" ? "Down / left (−)" : "Up / right (+)"}</span>{/if}
              {#each (side ? a[side] : a.sources) as s (s)}
                {@const others = usedBy(obj, s, a.name)}
                <span class="chip" class:bad={!isValidSource(s)} title={others.length ? `${s}, also used by ${others.join(", ")}` : s}>
                  {describeSource(s)}{#if others.length}<i title="Also used by {others.join(', ')}">⚠</i>{/if}
                  <button aria-label="Remove {describeSource(s)}" onclick={() => edit(removeSource(text, a.name, s, side))}>✕</button>
                </span>
              {/each}
              <button class:on={capturing?.action === a.name && capturing.side === side} onclick={() => (capturing = capturing?.action === a.name && capturing.side === side ? null : { action: a.name, side })}>
                {capturing?.action === a.name && capturing.side === side ? "Press a key… (Esc to cancel)" : "＋ Key"}
              </button>
              <select aria-label="Add a gamepad, mouse or touch source" value="" onchange={(e) => { pickSource(a.name, e.currentTarget.value, side); e.currentTarget.value = ""; }}>
                <option value="" disabled>＋ Other…</option>
                {#each sourceChoices as g (g.group)}<optgroup label={g.group}>{#each g.items as s (s)}<option value={s}>{describeSource(s)}</option>{/each}</optgroup>{/each}
              </select>
            </div>
          {/each}
        </div>
      {:else}
        <p class="dim">No actions of your own: the built-in ones (arrows or WASD, the D-pad and left stick, A, B, X, Y, start, select) work.</p>
      {/each}
      <form class="new" onsubmit={(e) => { e.preventDefault(); addAction(); }}>
        <input bind:value={newAction} placeholder="new action, e.g. jump" aria-label="New action name" />
        <select bind:value={newKind} aria-label="Kind of action"><option value="button">button</option><option value="axis">axis</option></select>
        <button class="primary" disabled={!nameOk}>Add action</button>
      </form>
    </section>
  {/if}
</div>

<style>
  .settings { height: 100%; overflow: auto; padding: 16px 24px 40px; display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-content: start; }
  .bar { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 16px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; align-self: start; }
  section.wide, .warn, .problems { grid-column: 1 / -1; }
  label { display: flex; align-items: center; gap: 8px; }
  label:not(.check) { justify-content: space-between; }
  label input:not([type="checkbox"]), label select { min-width: 180px; }
  .row { display: flex; gap: 8px; }
  .problems { margin: 0; padding: 8px 12px 8px 28px; background: color-mix(in srgb, var(--warn, #e0a030) 14%, transparent); border: 1px solid var(--warn, #e0a030); border-radius: 8px; }
  .action { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .head .nm { font-family: ui-monospace, Menlo, monospace; font-weight: 600; }
  .head .name { font-family: ui-monospace, Menlo, monospace; width: 160px; }
  .head .danger { margin-left: auto; }
  .sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .side { font-size: 11px; color: var(--dim); min-width: 110px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 2px 4px 2px 10px; }
  .chip.bad { border-color: #e05a5a; }
  .chip i { font-style: normal; color: #e0a030; }
  .chip button { padding: 0 6px; border: none; background: transparent; color: var(--dim); }
  .new { display: flex; gap: 8px; margin-top: 6px; }
  .new input { flex: 1; }
  button.on { outline: 2px solid var(--accent); }
  .small { font-size: 11px; }
</style>
