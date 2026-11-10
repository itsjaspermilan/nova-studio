<script lang="ts">
  // The menu and HUD editor (menus/<name>.menu.json, docs/menus.md): an outline of the tree, the settings of the chosen item, and a picture of roughly
  // how it will look. The picture is a plain approximation (the engine's layout runs in the game, not here): run the game to see the real thing.
  import { untrack } from "svelte";
  import {
    ANCHORS, COMMON, KINDS, addNear, checkMenu, duplicateNode, flatten, kindSpec, labelOf, moveNode, newMenu, newNode, nodeAt, parseMenu, removeNode, serializeMenu, setProp, unwrap, wrapIn,
    type MenuNode, type Path, type PropSpec,
  } from "../lib/menu-doc";
  import { studio } from "../lib/store.svelte";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const first = untrack(() => parseMenu(text));
  const error = first.ok ? "" : first.error;
  let root = $state.raw<MenuNode>(first.ok ? first.root : newMenu());
  let sel = $state<Path>([]);
  let adding = $state("button");
  let inside = $state(true);
  let past = $state.raw<MenuNode[]>([]);
  let future = $state.raw<MenuNode[]>([]);
  let showPreview = $state(true);

  const rows = $derived(flatten(root));
  const node = $derived(nodeAt(root, sel) ?? root);
  const spec = $derived(kindSpec(node.kind));
  const problems = $derived(checkMenu(root));
  const here = (p: Path) => p.join(".");

  function commit(next: MenuNode, path: Path = sel) {
    if (next === root) return;
    past = [...past, root].slice(-100);
    future = [];
    root = next;
    sel = nodeAt(next, path) ? path : [];
    studio.edit(filePath, serializeMenu(next));
  }
  function undo() {
    const p = past.at(-1);
    if (!p) return;
    past = past.slice(0, -1);
    future = [...future, root];
    root = p;
    if (!nodeAt(root, sel)) sel = [];
    studio.edit(filePath, serializeMenu(root));
  }
  function redo() {
    const n = future.at(-1);
    if (!n) return;
    future = future.slice(0, -1);
    past = [...past, root];
    root = n;
    studio.edit(filePath, serializeMenu(root));
  }
  const apply = (r: { root: MenuNode; path: Path }) => commit(r.root, r.path);

  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      apply(removeNode(root, sel));
    }
  }

  // ---- settings ----
  const rawOf = (n: MenuNode, key: string) => n[key];
  function setFromInput(p: PropSpec, raw: string | boolean) {
    if (p.type === "bool") return commit(setProp(root, sel, p.key, raw === true ? true : undefined));
    const s = String(raw).trim();
    if (s === "") return commit(setProp(root, sel, p.key, undefined));
    if (p.type === "number") return commit(setProp(root, sel, p.key, Number.isFinite(Number(s)) ? Number(s) : undefined));
    if (p.type === "size") return commit(setProp(root, sel, p.key, /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s));
    commit(setProp(root, sel, p.key, s));
  }
  // anything else the node has (a setting the form does not list): shown as key and JSON, editable
  const known = $derived(new Set(["kind", "text", "id", "children", ...COMMON.map((c) => c.key), ...(spec?.props ?? []).map((p) => p.key)]));
  const others = $derived(Object.keys(node).filter((k) => !known.has(k)));
  let otherKey = $state("");
  let otherValue = $state("");
  function addOther() {
    const k = otherKey.trim();
    if (!k || k === "children" || k === "kind") return;
    let v: unknown = otherValue;
    try {
      v = JSON.parse(otherValue);
    } catch {
      // plain text
    }
    commit(setProp(root, sel, k, v));
    otherKey = otherValue = "";
  }

  // ---- the picture ----
  const SCREEN_W = 960;
  const SCREEN_H = 540;
  const STYLE_PX: Record<string, number> = { title: 44, heading: 30, body: 20, small: 14, label: 13 };
  const dim = (v: unknown, auto?: string) => (typeof v === "number" ? `${v}px` : typeof v === "string" && v.endsWith("%") ? v : auto);
  function boxStyle(n: MenuNode, parentKind: string): string {
    const css: string[] = [];
    const w = n.w, h = n.h;
    if (w === "fill") css.push(parentKind === "row" ? "flex:1 1 0" : "width:100%");
    else if (dim(w)) css.push(`width:${dim(w)}`);
    if (h === "fill") css.push(parentKind === "column" || parentKind === "panel" ? "flex:1 1 0" : "height:100%");
    else if (dim(h)) css.push(`height:${dim(h)}`);
    if (typeof n.grow === "number" && n.grow > 0) css.push(`flex:${n.grow} 1 0`);
    const g = typeof n.gap === "number" ? n.gap : 10;
    if (["row", "column", "panel", "grid"].includes(n.kind)) css.push(`gap:${g}px`);
    const pad = typeof n.pad === "number" ? n.pad : n.kind === "panel" ? 14 : 0;
    if (pad) css.push(`padding:${pad}px`);
    const alignMap: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
    if (typeof n.align === "string" && alignMap[n.align] && n.kind !== "text") css.push(`align-items:${alignMap[n.align]}`);
    const justMap: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
    if (typeof n.justify === "string" && justMap[n.justify]) css.push(`justify-content:${justMap[n.justify]}`);
    if (typeof n.alpha === "number") css.push(`opacity:${n.alpha}`);
    if (n.kind === "grid") css.push(`grid-template-columns:repeat(${typeof n.columns === "number" ? n.columns : 2}, 1fr)`);
    return css.join(";");
  }
  const anchorCss = (a: unknown): string => {
    const m: Record<string, string> = { topleft: "top:0;left:0", top: "top:0;left:50%;transform:translateX(-50%)", topright: "top:0;right:0", left: "top:50%;left:0;transform:translateY(-50%)", center: "top:50%;left:50%;transform:translate(-50%,-50%)", right: "top:50%;right:0;transform:translateY(-50%)", bottomleft: "bottom:0;left:0", bottom: "bottom:0;left:50%;transform:translateX(-50%)", bottomright: "bottom:0;right:0" };
    return m[String(a ?? "topleft")] ?? m.topleft!;
  };
  const screenCss = (n: MenuNode): string => {
    const a = String(n.anchor ?? "center");
    const margin = typeof n.margin === "number" ? n.margin : 24;
    const dx = typeof n.x === "number" ? n.x : 0, dy = typeof n.y === "number" ? n.y : 0;
    const base: Record<string, string> = { topleft: `top:${margin}px;left:${margin}px`, top: `top:${margin}px;left:50%;transform:translateX(-50%)`, topright: `top:${margin}px;right:${margin}px`, left: `top:50%;left:${margin}px;transform:translateY(-50%)`, center: "top:50%;left:50%;transform:translate(-50%,-50%)", right: `top:50%;right:${margin}px;transform:translateY(-50%)`, bottomleft: `bottom:${margin}px;left:${margin}px`, bottom: `bottom:${margin}px;left:50%;transform:translateX(-50%)`, bottomright: `bottom:${margin}px;right:${margin}px` };
    return `${base[a] ?? base.center!};margin:${dy}px 0 0 ${dx}px`;
  };
  let scale = $state(0.55);
  let frame: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (!frame) return;
    const ro = new ResizeObserver(() => (scale = Math.max(0.2, Math.min(1, frame!.clientWidth / SCREEN_W))));
    ro.observe(frame);
    return () => ro.disconnect();
  });
  const firstButton = $derived(rows.find((r) => r.node.kind === "button" && !r.node.disabled)?.path);
</script>

<svelte:window onkeydown={onkey} />

{#if error}
  <div class="bad"><p><strong>This menu can't be shown in the editor.</strong></p><p class="dim">{error}</p><button onclick={onjson}>Edit as JSON</button></div>
{:else}
  <div class="editor">
    <div class="top">
      <strong>{filePath.replace(/^menus\//, "").replace(/\.menu\.json$/, "")}</strong>
      <span class="dim small">in Lua: <code>nova.ui.menu("{filePath.replace(/^menus\//, "").replace(/\.menu\.json$/, "").replaceAll("/", ".")}")</code></span>
      <span class="spacer"></span>
      <button class="ghost" onclick={undo} disabled={!past.length} aria-label="Undo">↶</button>
      <button class="ghost" onclick={redo} disabled={!future.length} aria-label="Redo">↷</button>
      <label class="check"><input type="checkbox" bind:checked={showPreview} /> Picture</label>
      <button class="ghost" onclick={onjson}>JSON</button>
    </div>
    <div class="body">
      <aside class="outline" aria-label="Outline">
        <div class="adder">
          <select bind:value={adding} aria-label="What to add">{#each KINDS as k (k.kind)}<option value={k.kind} title={k.help}>{k.title}</option>{/each}</select>
          <button class="primary" onclick={() => apply(addNear(root, sel, newNode(adding), inside))}>Add</button>
          <label class="check" title="Put it inside the chosen container instead of after the chosen item"><input type="checkbox" bind:checked={inside} /> inside</label>
        </div>
        <ul role="tree">
          {#each rows as r (here(r.path))}
            <li role="treeitem" aria-selected={here(r.path) === here(sel)}>
              <button class:on={here(r.path) === here(sel)} style:padding-left="{8 + r.depth * 14}px" onclick={() => (sel = r.path)}>
                <span class="k">{labelOf(r.node)}</span>
                {#if problems.some((p) => here(p.path) === here(r.path))}<i class="warnmark" title="Something to look at">⚠</i>{/if}
              </button>
            </li>
          {/each}
        </ul>
        <div class="row">
          <button onclick={() => apply(moveNode(root, sel, -1))} disabled={!sel.length} aria-label="Move up">↑</button>
          <button onclick={() => apply(moveNode(root, sel, 1))} disabled={!sel.length} aria-label="Move down">↓</button>
          <button onclick={() => apply(duplicateNode(root, sel))} disabled={!sel.length}>Duplicate</button>
          <button class="danger" onclick={() => apply(removeNode(root, sel))} disabled={!sel.length}>Delete</button>
        </div>
        <div class="row">
          <select aria-label="Put it in" value="" onchange={(e) => { if (e.currentTarget.value) apply(wrapIn(root, sel, e.currentTarget.value)); e.currentTarget.value = ""; }}>
            <option value="" disabled>Put it in a…</option>{#each KINDS.filter((k) => k.container) as k (k.kind)}<option value={k.kind}>{k.title}</option>{/each}
          </select>
          <button onclick={() => apply(unwrap(root, sel))} disabled={!node.children?.length || !sel.length} title="Takes this container away and leaves what is inside">Unwrap</button>
        </div>
      </aside>

      <section class="props" aria-label="Settings">
        <h3>{spec?.title ?? node.kind}</h3>
        <p class="dim small">{spec?.help ?? "A kind the engine does not know."}</p>
        <label>Kind
          <select value={node.kind} onchange={(e) => commit(setProp(root, sel, "kind", e.currentTarget.value))}>
            {#each KINDS as k (k.kind)}<option value={k.kind}>{k.title}</option>{/each}
            {#if !spec}<option value={node.kind}>{node.kind}</option>{/if}
          </select>
        </label>
        {#if spec?.text}
          <label>{spec.text} <input value={node.text ?? ""} onchange={(e) => commit(setProp(root, sel, "text", e.currentTarget.value))} /></label>
        {/if}
        {#each [...COMMON.slice(0, 1), ...(spec?.props ?? []), ...COMMON.slice(1)] as p (p.key)}
          <label class:check={p.type === "bool"} title={p.help}>
            {#if p.type === "bool"}
              <input type="checkbox" checked={rawOf(node, p.key) === true} onchange={(e) => setFromInput(p, e.currentTarget.checked)} /> {p.label}
            {:else if p.type === "choice"}
              {p.label}
              <select value={String(rawOf(node, p.key) ?? "")} onchange={(e) => setFromInput(p, e.currentTarget.value)}>
                <option value="">(default)</option>{#each p.choices ?? [] as c (c)}<option value={c}>{c}</option>{/each}
              </select>
            {:else}
              {p.label}
              <input value={rawOf(node, p.key) === undefined ? "" : String(rawOf(node, p.key))} placeholder="(default)" onchange={(e) => setFromInput(p, e.currentTarget.value)} />
            {/if}
          </label>
        {/each}
        {#if node.kind === "hints"}
          <label title="One pair per line: the pad button, then what it does">Hints
            <textarea rows="3" value={(Array.isArray(node.items) ? (node.items as string[][]) : []).map((i) => `${i[0]} ${i[1] ?? ""}`).join("\n")} onchange={(e) => commit(setProp(root, sel, "items", e.currentTarget.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [b, ...w] = l.split(/\s+/); return [b ?? "", w.join(" ")]; })))}></textarea>
          </label>
        {/if}
        <h4>Other settings</h4>
        {#each others as k (k)}
          <div class="row"><code>{k}</code> <input value={JSON.stringify(node[k])} aria-label={k} onchange={(e) => { let v: unknown = e.currentTarget.value; try { v = JSON.parse(e.currentTarget.value); } catch { /* text */ } commit(setProp(root, sel, k, v)); }} /><button class="ghost" aria-label="Remove {k}" onclick={() => commit(setProp(root, sel, k, undefined))}>✕</button></div>
        {/each}
        <form class="row" onsubmit={(e) => { e.preventDefault(); addOther(); }}>
          <input bind:value={otherKey} placeholder="setting" aria-label="Setting name" size="10" />
          <input bind:value={otherValue} placeholder="value (JSON or text)" aria-label="Setting value" />
          <button disabled={!otherKey.trim()}>Set</button>
        </form>
        {#each problems as p (here(p.path) + p.message)}<p class="warn small"><button class="ghost link" onclick={() => (sel = p.path)}>{labelOf(nodeAt(root, p.path) ?? root)}</button>: {p.message}</p>{/each}
      </section>

      {#if showPreview}
        <section class="preview" aria-label="Picture of the menu">
          <div class="frame" bind:this={frame}>
            <div class="screen" style:width="{SCREEN_W}px" style:height="{SCREEN_H}px" style:transform="scale({scale})" style:transform-origin="top left" style:margin-bottom="{-(SCREEN_H * (1 - scale))}px">
              <div class="top-level" style={screenCss(root)}>
                {@render draw(root, [], "column")}
              </div>
            </div>
          </div>
          <p class="dim small">A rough picture at 960 by 540. The real layout is done by the engine: sizes, fitting text and the theme will differ. Run the game to see it.</p>
        </section>
      {/if}
    </div>
  </div>
{/if}

{#snippet draw(n: MenuNode, p: Path, parentKind: string)}
  {@const k = n.kind}
  {@const picked = here(p) === here(sel)}
  {#if k === "text"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n text" class:picked style="{boxStyle(n, parentKind)};font-size:{typeof n.size === 'number' ? n.size : (STYLE_PX[String(n.style ?? 'body')] ?? 20)}px;text-align:{n.align ?? (n.style === 'title' || n.style === 'heading' ? 'left' : 'left')}" onclick={(e) => { e.stopPropagation(); sel = p; }}>{n.text ?? ""}</div>
  {:else if k === "button"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n button" class:picked class:focus={here(p) === (firstButton ? here(firstButton) : "x")} class:off={n.disabled === true} style={boxStyle(n, parentKind)} onclick={(e) => { e.stopPropagation(); sel = p; }}>
      <span>{n.text ?? ""}</span>{#if n.value !== undefined}<span class="val">{String(n.value)}</span>{/if}
      {#each n.children ?? [] as c, i (i)}{@render draw(c, [...p, i], k)}{/each}
    </div>
  {:else if k === "space"}
    <div class="n space" class:picked style="{boxStyle(n, parentKind)};{n.w === undefined && n.h === undefined ? 'flex:1 1 0' : ''}"></div>
  {:else if k === "image"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n image" class:picked style="{boxStyle(n, parentKind)};min-width:{typeof n.w === 'number' ? n.w : 32}px;min-height:{typeof n.h === 'number' ? n.h : 32}px" onclick={(e) => { e.stopPropagation(); sel = p; }}>{String(n.text ?? "picture")}</div>
  {:else if k === "box"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n box" class:picked style="{boxStyle(n, parentKind)};min-width:{typeof n.w === 'number' ? n.w : 60}px;min-height:{typeof n.h === 'number' ? n.h : 40}px" onclick={(e) => { e.stopPropagation(); sel = p; }}>box</div>
  {:else if k === "prompt"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n prompt" class:picked style={boxStyle(n, parentKind)} onclick={(e) => { e.stopPropagation(); sel = p; }}><b>{String(n.button ?? "a").toUpperCase()}</b> {n.text ?? ""}</div>
  {:else if k === "hints"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n hints" class:picked style="{boxStyle(n, parentKind)};{n.anchor ? 'position:absolute;' + anchorCss(n.anchor) : ''}" onclick={(e) => { e.stopPropagation(); sel = p; }}>
      {#each (Array.isArray(n.items) ? n.items : []) as it, i (i)}<span class="chip"><b>{String((it as string[])[0] ?? "").toUpperCase()}</b> {(it as string[])[1] ?? ""}</span>{/each}
    </div>
  {:else}
    <!-- a container: column, row, grid, stack, panel, or an unknown kind -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="n cont {k}" class:picked style="{boxStyle(n, parentKind)}" onclick={(e) => { e.stopPropagation(); sel = p; }}>
      {#each n.children ?? [] as c, i (i)}
        {#if k === "stack" && c.anchor}
          <div class="placed" style={anchorCss(c.anchor)}>{@render draw(c, [...p, i], k)}</div>
        {:else}
          {@render draw(c, [...p, i], k)}
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

<style>
  .editor { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .top { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px 280px minmax(0, 1fr); }
  .outline, .props, .preview { overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; border-right: 1px solid var(--line); }
  .adder, .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .outline ul { list-style: none; margin: 0; padding: 0; flex: 1; }
  .outline li button { width: 100%; text-align: left; background: transparent; border: none; border-radius: 4px; padding-top: 3px; padding-bottom: 3px; color: var(--text); display: flex; justify-content: space-between; }
  .outline li button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .warnmark { color: #e0a030; font-style: normal; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  label input:not([type="checkbox"]), label select, label textarea { width: 130px; }
  .check { justify-content: flex-start; }
  h3 { margin: 0; } h4 { margin: 8px 0 0; font-size: 12px; }
  .small { font-size: 11px; margin: 0; }
  .link { padding: 0; border: none; text-decoration: underline; }
  .frame { width: 100%; }
  .screen { position: relative; background: #1b2230; border: 1px solid var(--line); overflow: hidden; color: #f0f4fa; font-family: system-ui, sans-serif; }
  .top-level { position: absolute; display: flex; }
  .top-level > :global(.n) { flex: none; }
  .n { box-sizing: border-box; cursor: pointer; }
  .n.picked { outline: 2px dashed #ffd166; outline-offset: 1px; }
  .cont { display: flex; min-width: 0; }
  .cont.column, .cont.panel { flex-direction: column; align-items: stretch; }
  .cont.row { flex-direction: row; align-items: center; }
  .cont.grid { display: grid; }
  .cont.stack { position: relative; flex: none; }
  .cont.panel { background: rgba(15, 23, 42, 0.92); border-radius: 10px; border: 1px solid #334155; }
  .placed { position: absolute; }
  .text { color: #f0f4fa; white-space: pre-wrap; }
  .button { background: #334155; border-radius: 8px; min-height: 44px; padding: 6px 16px; display: flex; align-items: center; justify-content: space-between; font-size: 22px; }
  .button.focus { background: #fcd34d; color: #0f172a; }
  .button.off { opacity: 0.45; }
  .button .val { opacity: 0.8; font-size: 18px; }
  .space { min-width: 4px; min-height: 4px; }
  .image, .box { border: 1px dashed #64748b; color: #94a3b8; display: grid; place-items: center; font-size: 12px; background: rgba(100, 116, 139, 0.12); }
  .prompt, .chip { display: inline-flex; gap: 6px; align-items: center; font-size: 16px; }
  .prompt b, .chip b { background: #475569; border-radius: 50%; min-width: 24px; height: 24px; display: inline-grid; place-items: center; font-size: 12px; }
  .hints { display: flex; gap: 14px; }
  .bad { padding: 16px; }
</style>
