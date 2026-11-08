<script lang="ts">
  // The timeline editor for `animations/<name>.anim.json`: tracks on the left, their keys on a time ruler, a 2D preview of a
  // scene with the animation applied, and an inspector for the selected track and key. Everything is an edit of the file
  // (lib/anim-doc.ts); the game plays it with nova.play_anim (docs/project-format.md).
  import { onDestroy, untrack } from "svelte";
  import { resizable } from "../lib/resize";
  import { studio } from "../lib/store.svelte";
  import { parseScene, OBJECT_BOX, DEFAULT_WORLD, type Item, type Scene } from "../lib/scene-model";
  import {
    CAMERA_FIELDS, COMMON_FIELDS, EASES, addKey, addTrack, animName, crossed, eased, keyFor, moveKey, moveTrack, parseAnim, parseValue, problems, removeKey,
    removeTrack, sample, serializeAnim, setKey, setLength, setLoop, setTrackField, showValue, snapTime, targetOf, trackLabel, typeOf,
    type AnimDoc, type Ease, type EventKey, type Key, type SoundKey, type Track, type Value, type ValueKey,
  } from "../lib/anim-doc";

  let { path, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const name = untrack(() => animName(path));
  const parsed = untrack(() => parseAnim(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: AnimDoc = $state.raw(parsed.ok ? parsed.doc : { version: 1, length: 1, tracks: [] });
  let selTrack: number | null = $state(parsed.ok && parsed.doc.tracks.length ? 0 : null);
  let selKey: number | null = $state(null);
  let time = $state(0);
  let playing = $state(false);
  let snap = $state(0.05);
  let zoom = $state(1);
  const issues = $derived(problems(doc));
  const track = $derived(selTrack !== null ? doc.tracks[selTrack] : undefined);
  const key = $derived(track && selKey !== null ? track.keys[selKey] : undefined);

  // ---- undo -----------------------------------------------------------------------------------------------
  const past: AnimDoc[] = [];
  let future: AnimDoc[] = [];
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && past.length > 0);
  const canRedo = $derived(tick >= 0 && future.length > 0);
  function commit(next: AnimDoc, keep = false) {
    if (next === doc) return;
    if (!keep) {
      past.push(doc);
      if (past.length > 200) past.shift();
      future = [];
    }
    doc = next;
    tick++;
    studio.edit(path, serializeAnim(next));
  }
  function fixSelection() {
    if (selTrack !== null && selTrack >= doc.tracks.length) selTrack = doc.tracks.length ? doc.tracks.length - 1 : null;
    if (selTrack === null || selKey === null || selKey >= doc.tracks[selTrack]!.keys.length) selKey = null;
    time = Math.min(time, doc.length);
  }
  const undo = () => {
    const p = past.pop();
    if (!p) return;
    future.push(doc);
    commit(p, true);
    fixSelection();
  };
  const redo = () => {
    const n = future.pop();
    if (!n) return;
    past.push(doc);
    commit(n, true);
    fixSelection();
  };

  // ---- the ruler and the lanes ------------------------------------------------------------------------------------
  const PAD = 10;
  let laneW = $state(600);
  const pps = $derived(Math.max(20, ((laneW - PAD * 2) / Math.max(0.05, doc.length)) * zoom)); // pixels per second
  const xOf = (t: number) => PAD + t * pps;
  const innerW = $derived(PAD * 2 + doc.length * pps);
  const tickStep = $derived([1 / 60, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300].find((s) => s * pps >= 56) ?? 600);
  const ticks = $derived(Array.from({ length: Math.floor(doc.length / tickStep + 1e-6) + 1 }, (_, i) => +(i * tickStep).toFixed(4)));
  const label = (t: number) => (tickStep < 0.1 ? t.toFixed(2) : tickStep < 1 ? t.toFixed(1) : `${+t.toFixed(1)}`);
  let lanes: HTMLDivElement | undefined = $state();
  const timeAt = (e: { clientX: number }) => {
    const r = lanes!.getBoundingClientRect();
    return (e.clientX - r.left + lanes!.scrollLeft - PAD) / pps;
  };

  type Drag = { kind: "scrub" } | { kind: "key"; track: number; key: number; x: number; from: number; moved: boolean };
  let drag: Drag | null = null;
  function capture(e: PointerEvent) {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // (a pointer that is already gone)
    }
  }
  function rulerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    capture(e);
    stop();
    drag = { kind: "scrub" };
    time = snapTime(timeAt(e), doc.length, e.altKey ? 0 : snap);
  }
  function keyDown(e: PointerEvent, ti: number, ki: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    selTrack = ti;
    selKey = ki;
    drag = { kind: "key", track: ti, key: ki, x: e.clientX, from: doc.tracks[ti]!.keys[ki]!.time, moved: false };
  }
  function pointerMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === "scrub") {
      time = snapTime(timeAt(e), doc.length, e.altKey ? 0 : snap);
      return;
    }
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    const t = snapTime(drag.from + dx / pps, doc.length, e.altKey ? 0 : snap);
    if (t === doc.tracks[drag.track]!.keys[drag.key]!.time) return;
    const r = moveKey(doc, drag.track, drag.key, t);
    commit(r.doc, drag.moved); // (one drag is one undo step)
    drag.moved = true;
    drag.key = r.index;
    selKey = r.index;
    time = t;
  }
  function pointerUp() {
    drag = null;
  }
  function laneDouble(e: MouseEvent, ti: number) {
    const t = snapTime(timeAt(e), doc.length, e.altKey ? 0 : snap);
    const r = addKey(doc, ti, keyFor(doc.tracks[ti]!, t, sounds));
    commit(r.doc);
    selTrack = ti;
    selKey = r.index;
    time = t;
  }
  function keyAtPlayhead() {
    if (selTrack === null) return;
    const existing = doc.tracks[selTrack]!.keys.findIndex((k) => Math.abs(k.time - time) < 1e-6);
    if (existing >= 0) {
      selKey = existing;
      return;
    }
    const r = addKey(doc, selTrack, keyFor(doc.tracks[selTrack]!, snapTime(time, doc.length), sounds));
    commit(r.doc);
    selKey = r.index;
  }
  function deleteKey() {
    if (selTrack === null || selKey === null) return;
    commit(removeKey(doc, selTrack, selKey));
    selKey = null;
  }
  function newTrack(type: "value" | "event" | "sound") {
    const t: Track =
      type === "value" ? { target: "self", field: "x", keys: [] } : type === "event" ? { type: "event", target: "self", keys: [] } : { type: "sound", keys: [] };
    const r = addTrack(doc, t);
    commit(r.doc);
    selTrack = r.index;
    selKey = null;
  }

  // ---- play and scrub -------------------------------------------------------------------------------------------
  let raf = 0;
  let last = 0;
  let fired: { at: number; text: string }[] = $state([]);
  function note(text: string) {
    fired = [{ at: time, text }, ...fired].slice(0, 6);
  }
  function happen(hits: { track: number; key: number }[]) {
    for (const h of hits) {
      const t = doc.tracks[h.track]!;
      const k = t.keys[h.key]!;
      if (typeOf(t) === "sound") {
        const s = k as SoundKey;
        note(`♪ ${s.sound}`);
        void beep(s);
      } else {
        const ev = k as EventKey;
        note(`${targetOf(t)}:${ev.call}(${(ev.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`);
      }
    }
  }
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const a = time;
    let b = a + dt;
    if (b >= doc.length) {
      happen(crossed(doc, a, doc.length));
      if (doc.loop) {
        b -= doc.length;
        happen(crossed(doc, 0, b, true));
      } else {
        time = doc.length;
        playing = false;
        return;
      }
    } else happen(crossed(doc, a, b));
    time = b;
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (playing) return stop();
    if (time >= doc.length - 1e-6) time = 0;
    playing = true;
    happen(crossed(doc, time, time, true));
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
  }
  onDestroy(stop);

  // sounds in the project, and a quick listen while previewing (the game plays them through its own mixer)
  const sounds = $derived(
    [...new Set(studio.files.filter((f) => !f.dir && /^(sounds|music)\/.+\.(wav|ogg)$/i.test(f.path)).map((f) => f.path.replace(/^(sounds|music)\//, "").replace(/\.(wav|ogg)$/i, "")))].sort(),
  );
  const audioCache = new Map<string, string>();
  async function beep(s: SoundKey) {
    try {
      const file = studio.files.find((f) => new RegExp(`^(sounds|music)/${s.sound.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(wav|ogg)$`, "i").test(f.path));
      if (!file || !studio.api || typeof Audio === "undefined") return;
      let url = audioCache.get(file.path);
      if (!url) audioCache.set(file.path, (url = await studio.api.readAudio(file.path)));
      const a = new Audio(url);
      a.volume = Math.min(1, s.volume ?? 1);
      a.playbackRate = s.pitch ?? 1;
      await a.play();
    } catch {
      // (a sound the browser cannot play is only missing from the preview)
    }
  }

  // ---- the preview: a scene with the animation applied --------------------------------------------------------------
  const scenes = $derived(studio.files.filter((f) => !f.dir && f.path.endsWith(".scene.json")).map((f) => f.path));
  const targets = $derived([...new Set(doc.tracks.filter((t) => typeOf(t) !== "sound").map(targetOf))]);
  let scenePath = $state("");
  let selfName = $state("");
  let scene: Scene | null = $state.raw(null);
  const pictures: Map<string, { url: string; w: number; h: number }> = $state(new Map());
  const named = (s: Scene | null) => (s ? [...(s.objects ?? []), ...(s.images ?? []), ...(s.texts ?? [])].map((i) => i.name).filter((n): n is string => typeof n === "string") : []);
  const sceneNames = $derived(named(scene));
  // pick a scene that has the names the tracks use (remembered per animation)
  const remembered = (() => {
    try {
      return JSON.parse(localStorage.getItem(`nova.anim.preview.${path}`) ?? "null") as { scene: string; self: string } | null;
    } catch {
      return null;
    }
  })();
  $effect(() => {
    if (scenePath || !scenes.length) return;
    untrack(() => {
      if (remembered && scenes.includes(remembered.scene)) {
        scenePath = remembered.scene;
        selfName = remembered.self;
      } else scenePath = scenes[0]!;
      void pickScene(scenePath, !remembered);
    });
  });
  async function pickScene(p: string, guess: boolean) {
    scenePath = p;
    scene = null;
    if (!p || !studio.api) return;
    try {
      const r = parseScene((await studio.api.readFile(p)).text ?? "");
      if (!r.ok) return;
      scene = r.scene;
      if (guess) {
        const names = named(scene);
        if (!names.includes(selfName)) selfName = targets.includes("self") ? (names[0] ?? "") : "";
      }
      remember();
      for (const im of scene.images ?? []) void picture(String(im.image ?? ""));
    } catch {
      scene = null;
    }
  }
  function remember() {
    try {
      localStorage.setItem(`nova.anim.preview.${path}`, JSON.stringify({ scene: scenePath, self: selfName }));
    } catch {
      // not remembered
    }
  }
  async function picture(p: string) {
    if (!p || pictures.has(p) || !studio.api) return;
    try {
      const url = await studio.api.readImage(p);
      const img = new Image();
      img.onload = () => pictures.set(p, { url, w: img.naturalWidth || 32, h: img.naturalHeight || 32 });
      img.src = url;
      pictures.set(p, { url, w: 32, h: 32 });
    } catch {
      // (no picture: drawn as a box)
    }
  }
  const world = $derived({ w: ((scene as Scene | null)?.width as number) || DEFAULT_WORLD.width, h: ((scene as Scene | null)?.height as number) || DEFAULT_WORLD.height });

  // what each target looks like at `time`: field -> value, with relative tracks added to the scene's own value
  type Look = Record<string, Value>;
  const baseOf = (item: Item | undefined, field: string): Value => {
    const own = item?.[field] ?? (field === "sx" || field === "sy" ? item?.scale : field === "tint" ? item?.color : undefined);
    if (typeof own === "number" || Array.isArray(own)) return own as Value;
    return field === "alpha" || field === "sx" || field === "sy" ? 1 : field === "tint" || field === "color" ? [255, 255, 255] : 0;
  };
  const itemNamed = (n: string): Item | undefined => (scene ? [...(scene.objects ?? []), ...(scene.images ?? []), ...(scene.texts ?? [])].find((i) => i.name === n) : undefined);
  const resolveName = (target: string) => (target === "self" ? selfName : target);
  const looks = $derived.by(() => {
    const out = new Map<string, Look>();
    for (const t of doc.tracks) {
      if (typeOf(t) !== "value" || !t.field) continue;
      const v = sample(t, time);
      if (v === null) continue;
      const who = resolveName(targetOf(t));
      const look = out.get(who) ?? {};
      if (t.relative) {
        const base = who === "camera" ? (t.field === "x" ? world.w / 2 : t.field === "y" ? world.h / 2 : 0) : baseOf(itemNamed(who), t.field);
        look[t.field] = typeof v === "number" ? (typeof base === "number" ? base : 0) + v : v.map((n, j) => n + ((base as number[])[j] ?? 0));
      } else look[t.field] = v;
      out.set(who, look);
    }
    return out;
  });
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const rgb = (c: unknown, alpha = 1) => (Array.isArray(c) && c.length >= 3 ? `rgba(${c.slice(0, 3).map((n) => Math.round(num(n, 255))).join(",")},${(num(c[3], 255) / 255) * alpha})` : undefined);
  function drawn(item: Item) {
    const look = (typeof item.name === "string" && looks.get(item.name)) || {};
    const pick = (f: string, d: number) => num(look[f], num(item[f], d));
    const scale = num(item.scale, 1);
    return {
      x: pick("x", 0), y: pick("y", 0), angle: (pick("angle", 0) * 180) / Math.PI, sx: num(look.sx, scale), sy: num(look.sy, scale), alpha: num(look.alpha, 1),
      tint: look.tint ?? look.color ?? item.color, animated: Object.keys(look).length > 0,
    };
  }
  const cam = $derived(looks.get("camera"));
  const readout = $derived(
    doc.tracks.map((t, i) => ({ i, t, v: typeOf(t) === "value" ? sample(t, time) : null })).filter((r) => typeOf(r.t) === "value"),
  );
  const missing = $derived(scene ? targets.filter((t) => t !== "scene" && t !== "camera" && !sceneNames.includes(resolveName(t))) : []);

  // ---- the inspector's helpers ---------------------------------------------------------------------------------
  const setT = (k: "target" | "field" | "relative" | "name", v: string | boolean | undefined) => selTrack !== null && commit(setTrackField(doc, selTrack, k, v));
  const setK = (patch: Record<string, unknown>) => selTrack !== null && selKey !== null && commit(setKey(doc, selTrack, selKey, patch));
  function setKeyTime(t: number) {
    if (selTrack === null || selKey === null || !Number.isFinite(t)) return;
    const r = moveKey(doc, selTrack, selKey, snapTime(t, doc.length));
    commit(r.doc);
    selKey = r.index;
    time = r.doc.tracks[selTrack]!.keys[r.index]!.time;
  }
  let valueError = $state("");
  function setValue(raw: string) {
    const v = parseValue(raw);
    if (v === null) {
      valueError = "Type a number, or numbers with commas for a colour (255, 180, 60).";
      return;
    }
    valueError = "";
    setK({ value: v });
  }
  let argsError = $state("");
  function setArgs(raw: string) {
    if (!raw.trim()) {
      argsError = "";
      return setK({ args: undefined });
    }
    try {
      const v = JSON.parse(raw.trim().startsWith("[") ? raw : `[${raw}]`);
      if (!Array.isArray(v) || v.some((a) => a === null)) throw "";
      argsError = "";
      setK({ args: v });
    } catch {
      argsError = 'Values with commas between: 1, "open", true';
    }
  }
  const isCurve = (e: Ease | undefined): e is [number, number, number, number] => Array.isArray(e);
  function setEase(id: string) {
    if (id === "curve") setK({ ease: [0.25, 0.1, 0.25, 1] });
    else setK({ ease: id === "linear" ? undefined : id });
  }
  function setCurve(i: number, v: number) {
    if (!key || !isCurve((key as ValueKey).ease) || !Number.isFinite(v)) return;
    const c = [...((key as ValueKey).ease as number[])] as [number, number, number, number];
    c[i] = i % 2 === 0 ? Math.max(0, Math.min(1, v)) : v;
    setK({ ease: c });
  }
  const curvePath = (e: Ease | undefined) => {
    const ys = Array.from({ length: 41 }, (_, i) => eased(e, i / 40));
    const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
    return { d: ys.map((y, i) => `${i ? "L" : "M"}${(i / 40) * 100},${70 - ((y - lo) / (hi - lo)) * 60 + 5}`).join(" "), zero: 75 - ((0 - lo) / (hi - lo)) * 60 - 0, one: 75 - ((1 - lo) / (hi - lo)) * 60 };
  };
  const hex = (v: Value | undefined) => (Array.isArray(v) && v.length >= 3 ? `#${v.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}` : "#ffffff");
  const fromHex = (h: string, keep: Value | undefined): number[] => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Array.isArray(keep) && keep.length > 3 ? [...c, ...keep.slice(3)] : c;
  };
  const fieldsFor = (t: Track | undefined) => (t && targetOf(t) === "camera" ? CAMERA_FIELDS : COMMON_FIELDS);
  const fmt = (t: number) => t.toFixed(2);
  const inInput = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  function keydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (inInput(e)) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (inInput(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      play();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteKey();
    } else if (e.key === "Home") {
      time = 0;
    } else if (e.key === "End") {
      time = doc.length;
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selTrack !== null && selKey !== null) {
      e.preventDefault();
      const k = doc.tracks[selTrack]!.keys[selKey]!;
      setKeyTime(k.time + (e.key === "ArrowLeft" ? -1 : 1) * (snap || 1 / 60));
    } else if (e.key === "k" || e.key === "K") keyAtPlayhead();
  }
</script>

{#if error}
  <div class="bad">
    <p><strong>{path}</strong> is not an animation the timeline can edit: {error}</p>
    <button onclick={onjson}>Open as text</button>
  </div>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="anim" role="application" aria-label="Timeline of {name}" tabindex="0" onkeydown={keydown}>
    <div class="bar">
      <button class="primary play" onclick={play} title="Play or pause the preview (Space)">{playing ? "❚❚ Pause" : "▶ Play"}</button>
      <button class="ghost" onclick={() => { stop(); time = 0; }} title="Back to the start (Home)">⏮</button>
      <span class="clock" aria-label="Playhead">{fmt(time)} / {fmt(doc.length)} s</span>
      <label class="inline">Snap
        <select value={String(snap)} onchange={(e) => (snap = Number(e.currentTarget.value))} title="Keys and the playhead land on these steps (hold Alt to place freely)">
          <option value="0">off</option>
          <option value={String(1 / 60)}>1 step (1/60 s)</option>
          <option value="0.05">0.05 s</option>
          <option value="0.1">0.1 s</option>
          <option value="0.25">0.25 s</option>
          <option value="0.5">0.5 s</option>
        </select>
      </label>
      <label class="inline">Zoom <input type="range" min="1" max="8" step="0.25" bind:value={zoom} aria-label="Zoom the timeline" /></label>
      <span class="spacer"></span>
      <button class="ghost" onclick={keyAtPlayhead} disabled={selTrack === null} title="Add a key to the selected track at the playhead (K)">◆ Key here</button>
      <button class="ghost" onclick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶ Undo</button>
      <button class="ghost" onclick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷ Redo</button>
      <button class="ghost" onclick={onjson}>{"{ } Text"}</button>
    </div>

    <div class="top">
      <div class="preview">
        <div class="pbar">
          <label class="inline">Preview in
            <select value={scenePath} onchange={(e) => void pickScene(e.currentTarget.value, true)} aria-label="Scene to preview in">
              {#if !scenes.length}<option value="">(no scenes)</option>{/if}
              {#each scenes as s (s)}<option value={s}>{s.replace(/^scenes\//, "").replace(/\.scene\.json$/, "")}</option>{/each}
            </select>
          </label>
          {#if targets.includes("self")}
            <label class="inline" title="What the game passes as the target: in the preview, one of the scene's named objects stands in for it">"self" is
              <select value={selfName} onchange={(e) => { selfName = e.currentTarget.value; remember(); }} aria-label="What self is in the preview">
                <option value="">(nothing)</option>
                {#each sceneNames as n (n)}<option value={n}>{n}</option>{/each}
              </select>
            </label>
          {/if}
          {#if missing.length}<span class="warn small" title="Name an object in the scene editor, or pick another scene">Not in this scene: {missing.join(", ")}</span>{/if}
        </div>
        <div class="stage">
          <svg viewBox="0 0 {world.w} {world.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Preview of {name} at {fmt(time)} seconds">
            <rect x="0" y="0" width={world.w} height={world.h} fill={rgb(scene?.background) ?? "#1c2234"} />
            {#if scene}
              {#each scene.images ?? [] as im, i (i)}
                {@const d = drawn(im)}
                {@const pic = pictures.get(String(im.image ?? ""))}
                <g transform="translate({d.x} {d.y}) rotate({d.angle}) scale({d.sx} {d.sy})" opacity={d.alpha} class:animated={d.animated}>
                  {#if pic}<image href={pic.url} x={-pic.w / 2} y={-pic.h / 2} width={pic.w} height={pic.h} style="image-rendering: pixelated" />
                  {:else}<rect x="-16" y="-16" width="32" height="32" class="box" />{/if}
                  {#if d.tint}<rect x={-(pic?.w ?? 32) / 2} y={-(pic?.h ?? 32) / 2} width={pic?.w ?? 32} height={pic?.h ?? 32} fill={rgb(d.tint)} style="mix-blend-mode: multiply" />{/if}
                </g>
              {/each}
              {#each scene.objects ?? [] as o, i (i)}
                {@const d = drawn(o)}
                <g transform="translate({d.x} {d.y}) rotate({d.angle}) scale({d.sx} {d.sy})" opacity={d.alpha}>
                  <rect x={-OBJECT_BOX / 2} y={-OBJECT_BOX / 2} width={OBJECT_BOX} height={OBJECT_BOX} rx="4" class="box" class:animated={d.animated} style:fill={rgb(d.tint) ?? null} />
                </g>
                <text x={d.x} y={d.y - OBJECT_BOX / 2 - 6} class="tag" class:animated={d.animated}>{o.name ?? o.kind}</text>
              {/each}
              {#each scene.texts ?? [] as tx, i (i)}
                {@const d = drawn(tx)}
                <text x={d.x} y={d.y} font-size={8 * num(tx.scale, 2)} dominant-baseline="hanging" fill={rgb(d.tint, d.alpha) ?? `rgba(255,255,255,${d.alpha})`} transform="rotate({d.angle} {d.x} {d.y})" class="stext">{String(tx.text ?? "")}</text>
              {/each}
            {:else}
              <text x={world.w / 2} y={world.h / 2} class="tag">Pick a scene to see the animation in it</text>
            {/if}
            {#if cam && (cam.x !== undefined || cam.y !== undefined)}
              <rect x={num(cam.x, world.w / 2) - DEFAULT_WORLD.width / 2} y={num(cam.y, world.h / 2) - DEFAULT_WORLD.height / 2} width={DEFAULT_WORLD.width} height={DEFAULT_WORLD.height} class="camera" />
              <text x={num(cam.x, world.w / 2) - DEFAULT_WORLD.width / 2 + 8} y={num(cam.y, world.h / 2) - DEFAULT_WORLD.height / 2 + 22} class="camtag">camera</text>
            {/if}
          </svg>
          <div class="values">
            {#each readout as r (r.i)}
              <div class:on={r.i === selTrack}><span class="dim">{trackLabel(r.t)}</span> {showValue(r.v)}{r.t.relative ? " (+)" : ""}</div>
            {/each}
            {#each fired as f, i (i)}<div class="fired" style:opacity={1 - i * 0.15}>{fmt(f.at)} s · {f.text}</div>{/each}
          </div>
        </div>
      </div>

      <aside class="side" use:resizable={{ key: "anim.side", edge: "left", size: 290, min: 220, max: 600 }}>
        <section>
          <h3>Animation</h3>
          <label>Length
            <span class="unit"><input type="number" min="0.05" max="3600" step="0.1" value={doc.length} onchange={(e) => { commit(setLength(doc, Number(e.currentTarget.value) || doc.length)); fixSelection(); }} aria-label="Length in seconds" /> s</span>
          </label>
          <label class="row"><input type="checkbox" checked={!!doc.loop} onchange={(e) => commit(setLoop(doc, e.currentTarget.checked))} /> Loop (play round and round)</label>
          <p class="dim small">Play it from Lua: <code>self:play_anim("{name}")</code></p>
        </section>
        {#if track && selTrack !== null}
          {@const type = typeOf(track)}
          <section>
            <h3>Track {selTrack + 1} · {type === "value" ? "moves a value" : type === "event" ? "calls a function" : "plays sounds"}</h3>
            {#if type !== "sound"}
              <label>Target
                <input list="anim-targets" value={targetOf(track)} onchange={(e) => setT("target", e.currentTarget.value.trim() || undefined)} aria-label="Target" title="self (what the game passes), scene, camera, or a named object or tag" />
              </label>
            {/if}
            {#if type === "value"}
              <label>Field
                <input list="anim-fields" value={track.field ?? ""} onchange={(e) => setT("field", e.currentTarget.value.trim() || undefined)} aria-label="Field" title="x, y, angle, alpha, tint, or any number field (hud.alpha for a field inside a table)" />
              </label>
              <label class="row" title="Add the keys to where the target already is, so the same animation works wherever it is placed"><input type="checkbox" checked={!!track.relative} onchange={(e) => setT("relative", e.currentTarget.checked || undefined)} /> Relative (added to where it starts)</label>
            {/if}
            <label>Label
              <input value={track.name ?? ""} placeholder={trackLabel({ ...track, name: undefined })} onchange={(e) => setT("name", e.currentTarget.value.trim() || undefined)} aria-label="Track label" />
            </label>
            <div class="buttons">
              <button class="ghost" onclick={() => { commit(moveTrack(doc, selTrack!, -1)); selTrack = Math.max(0, selTrack! - 1); }} disabled={selTrack === 0}>▲ Up</button>
              <button class="ghost" onclick={() => { commit(moveTrack(doc, selTrack!, 1)); selTrack = Math.min(doc.tracks.length - 1, selTrack! + 1); }} disabled={selTrack === doc.tracks.length - 1}>▼ Down</button>
              <button class="ghost danger" onclick={() => { commit(removeTrack(doc, selTrack!)); fixSelection(); }}>Delete track</button>
            </div>
          </section>
        {/if}
        {#if key && track && selKey !== null}
          {@const type = typeOf(track)}
          <section>
            <h3>Key at {fmt(key.time)} s</h3>
            <label>Time
              <span class="unit"><input type="number" min="0" max={doc.length} step={snap || 0.01} value={key.time} onchange={(e) => setKeyTime(Number(e.currentTarget.value))} aria-label="Key time" /> s</span>
            </label>
            {#if type === "value"}
              {@const vk = key as ValueKey}
              <label>Value
                <span class="unit">
                  <input class="val" value={showValue(vk.value)} onchange={(e) => setValue(e.currentTarget.value)} aria-label="Key value" />
                  {#if Array.isArray(vk.value) && vk.value.length >= 3}<input type="color" value={hex(vk.value)} onchange={(e) => setK({ value: fromHex(e.currentTarget.value, vk.value) })} aria-label="Colour" />{/if}
                </span>
              </label>
              {#if valueError}<p class="warn small">{valueError}</p>{/if}
              <label>Then
                <select value={isCurve(vk.ease) ? "curve" : (vk.ease ?? "linear")} onchange={(e) => setEase(e.currentTarget.value)} aria-label="Ease to the next key" title="How the value travels from this key to the next">
                  {#each EASES as ea (ea.id)}<option value={ea.id}>{ea.label}</option>{/each}
                  <option value="curve">Your own curve…</option>
                </select>
              </label>
              {@const c = curvePath(vk.ease)}
              <svg class="curve" viewBox="0 0 100 80" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" x2="100" y1={c.zero} y2={c.zero} class="cl" /><line x1="0" x2="100" y1={c.one} y2={c.one} class="cl" />
                <path d={c.d} class="cp" />
              </svg>
              {#if isCurve(vk.ease)}
                <div class="curvenums">
                  {#each ["x1", "y1", "x2", "y2"] as n, i (n)}
                    <label class="tiny">{n}<input type="number" step="0.05" min={i % 2 === 0 ? 0 : -2} max={i % 2 === 0 ? 1 : 3} value={(vk.ease as number[])[i]} onchange={(e) => setCurve(i, Number(e.currentTarget.value))} /></label>
                  {/each}
                </div>
              {/if}
              {#if selKey === track.keys.length - 1}<p class="dim small">The last key's ease is not used.</p>{/if}
            {:else if type === "event"}
              {@const ek = key as EventKey}
              <label>Call
                <input value={ek.call} onchange={(e) => setK({ call: e.currentTarget.value.trim() })} aria-label="Function to call" title="The name of a function on the target, such as opened for function Door:opened()" />
              </label>
              <label>With
                <input value={(ek.args ?? []).map((a) => JSON.stringify(a)).join(", ")} placeholder="(nothing)" onchange={(e) => setArgs(e.currentTarget.value)} aria-label="Arguments" />
              </label>
              {#if argsError}<p class="warn small">{argsError}</p>{/if}
              <p class="dim small">Calls <code>{targetOf(track)}:{ek.call || "?"}({(ek.args ?? []).map((a) => JSON.stringify(a)).join(", ")})</code></p>
            {:else}
              {@const sk = key as SoundKey}
              <label>Sound
                <select value={sk.sound} onchange={(e) => setK({ sound: e.currentTarget.value })} aria-label="Sound">
                  {#each sounds.includes(sk.sound) ? sounds : [sk.sound, ...sounds] as s (s)}<option value={s}>{s}</option>{/each}
                </select>
              </label>
              <label>Volume <input type="range" min="0" max="2" step="0.05" value={sk.volume ?? 1} onchange={(e) => setK({ volume: Number(e.currentTarget.value) === 1 ? undefined : Number(e.currentTarget.value) })} aria-label="Volume" /></label>
              <label>Pitch <input type="range" min="0.25" max="4" step="0.05" value={sk.pitch ?? 1} onchange={(e) => setK({ pitch: Number(e.currentTarget.value) === 1 ? undefined : Number(e.currentTarget.value) })} aria-label="Pitch" /></label>
              <label>Pan <input type="range" min="-1" max="1" step="0.1" value={sk.pan ?? 0} onchange={(e) => setK({ pan: Number(e.currentTarget.value) === 0 ? undefined : Number(e.currentTarget.value) })} aria-label="Pan" /></label>
              <button class="ghost" onclick={() => void beep(sk)}>▶ Listen</button>
            {/if}
            <button class="ghost danger" onclick={deleteKey}>Delete key</button>
          </section>
        {:else if track}
          <section><p class="dim small">Double-click the track's lane to add a key there, or press ◆ Key here (K) to add one at the playhead.</p></section>
        {/if}
        {#if issues.length}
          <section>
            <h3>Problems</h3>
            {#each issues as p (p)}<p class="warn small">⚠ {p}</p>{/each}
          </section>
        {/if}
      </aside>
    </div>

    <div class="timeline" use:resizable={{ key: "anim.timeline", edge: "top", size: 220, min: 110, max: 640 }}>
      <div class="tracks" use:resizable={{ key: "anim.tracks", edge: "right", size: 200, min: 130, max: 420 }}>
        <div class="thead">Tracks</div>
        {#each doc.tracks as t, i (i)}
          <button class="trow" class:on={selTrack === i} onclick={() => { selTrack = i; selKey = null; }} title={trackLabel(t)}>
            <span class="ticon">{typeOf(t) === "sound" ? "♪" : typeOf(t) === "event" ? "ƒ" : "◆"}</span>{trackLabel(t)}
          </button>
        {/each}
        <div class="adds">
          <button class="ghost" onclick={() => newTrack("value")} title="A track that moves a value (position, turn, size, colour...)">＋ Value</button>
          <button class="ghost" onclick={() => newTrack("event")} title="A track that calls a function at its keys">＋ Event</button>
          <button class="ghost" onclick={() => newTrack("sound")} title="A track that plays sounds at its keys">＋ Sound</button>
        </div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lanes" bind:this={lanes} bind:clientWidth={laneW} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={pointerUp}>
        <div class="inner" style:width="{innerW}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ruler" onpointerdown={rulerDown} title="Click or drag to move the playhead">
            {#each ticks as t (t)}<span class="tick" style:left="{xOf(t)}px">{label(t)}</span>{/each}
          </div>
          {#each doc.tracks as t, ti (ti)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="lane" class:on={selTrack === ti} ondblclick={(e) => laneDouble(e, ti)} onpointerdown={() => { selTrack = ti; selKey = null; }}>
              {#each t.keys as k, ki (ki)}
                {@const next = t.keys[ki + 1]}
                {#if typeOf(t) === "value" && next}
                  <span class="span" class:step={(k as ValueKey).ease === "step"} style:left="{xOf(k.time)}px" style:width="{Math.max(0, (next.time - k.time) * pps)}px"></span>
                {/if}
              {/each}
              {#each t.keys as k, ki (ki)}
                <button class="key {typeOf(t)}" class:sel={selTrack === ti && selKey === ki} style:left="{xOf(k.time)}px" onpointerdown={(e) => keyDown(e, ti, ki)}
                  onclick={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}
                  title="{fmt(k.time)} s · {typeOf(t) === 'value' ? showValue((k as ValueKey).value) : typeOf(t) === 'event' ? (k as EventKey).call : (k as SoundKey).sound}"
                  aria-label="Key at {fmt(k.time)} seconds on {trackLabel(t)}"></button>
              {/each}
            </div>
          {/each}
          <div class="end" style:left="{xOf(doc.length)}px"></div>
          <div class="playhead" style:left="{xOf(time)}px"></div>
        </div>
      </div>
    </div>
    <datalist id="anim-targets">
      {#each ["self", "scene", "camera", ...sceneNames] as n (n)}<option value={n}></option>{/each}
    </datalist>
    <datalist id="anim-fields">
      {#each fieldsFor(track) as f (f)}<option value={f}></option>{/each}
    </datalist>
  </div>
{/if}

<style>
  .bad { padding: 24px; }
  .anim { display: flex; flex-direction: column; height: 100%; min-height: 0; outline: none; }
  .bar, .pbar { display: flex; gap: 6px; align-items: center; padding: 3px 8px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .pbar { background: var(--bg); }
  .play { min-width: 82px; }
  .clock { font-variant-numeric: tabular-nums; min-width: 110px; }
  .inline { display: flex; align-items: center; gap: 4px; font-size: 12px; }
  .spacer { flex: 1; }
  .top { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr); }
  .preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .stage { position: relative; flex: 1; min-height: 0; background: var(--bg); }
  .stage svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .box { fill: color-mix(in srgb, var(--accent) 30%, transparent); stroke: var(--accent); stroke-width: 2; }
  .box.animated { stroke: var(--warn); }
  .tag { fill: var(--text); font-size: 14px; text-anchor: middle; pointer-events: none; }
  .tag.animated { fill: var(--warn); font-weight: 700; }
  .stext { font-family: var(--mono, monospace); }
  .camera { fill: none; stroke: var(--ok); stroke-width: 3; stroke-dasharray: 12 8; }
  .camtag { fill: var(--ok); font-size: 16px; }
  .values { position: absolute; left: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 1px; font-size: 11px; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--panel) 85%, transparent); border-radius: 6px; padding: 4px 8px; max-width: 60%; pointer-events: none; }
  .values .on { color: var(--accent); }
  .fired { color: var(--warn); }
  .side { overflow-y: auto; background: var(--panel); border-left: 1px solid var(--line); padding: 4px 12px 16px; }
  section { padding: 8px 0; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  label.row { justify-content: flex-start; }
  section input:not([type]), section select { width: 150px; }
  section input[type="number"] { width: 80px; }
  input.val { width: 110px; }
  .unit { display: flex; align-items: center; gap: 4px; }
  .buttons { display: flex; gap: 4px; flex-wrap: wrap; }
  .danger { color: var(--error); }
  .warn { color: var(--warn); margin: 0; }
  .small { font-size: 11px; margin: 0; }
  .curve { width: 100%; height: 70px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; }
  .cl { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .cp { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .curvenums { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .curvenums input { width: 64px; }
  .tiny { font-size: 11px; }
  .timeline { display: grid; grid-template-columns: auto minmax(0, 1fr); border-top: 1px solid var(--line); background: var(--panel); min-height: 0; }
  .tracks { overflow-y: auto; border-right: 1px solid var(--line); display: flex; flex-direction: column; }
  .thead { height: 24px; line-height: 24px; padding: 0 8px; font-size: 11px; color: var(--dim); text-transform: uppercase; border-bottom: 1px solid var(--line); flex: none; }
  .trow { height: 28px; flex: none; text-align: left; border: none; border-radius: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trow.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .ticon { display: inline-block; width: 16px; color: var(--dim); }
  .adds { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 4px; }
  .adds button { font-size: 11px; padding: 2px 6px; }
  .lanes { overflow: auto; position: relative; background: var(--bg); }
  .inner { position: relative; min-height: 100%; }
  .ruler { position: sticky; top: 0; z-index: 2; height: 24px; background: var(--panel); border-bottom: 1px solid var(--line); cursor: col-resize; touch-action: none; }
  .tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--line); padding-left: 3px; font-size: 10px; line-height: 24px; color: var(--dim); font-variant-numeric: tabular-nums; pointer-events: none; }
  .lane { position: relative; height: 28px; border-bottom: 1px solid var(--line); }
  .lane.on { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .span { position: absolute; top: 13px; height: 2px; background: color-mix(in srgb, var(--accent) 55%, transparent); pointer-events: none; }
  .span.step { background: repeating-linear-gradient(90deg, var(--accent) 0 4px, transparent 4px 8px); }
  .key { position: absolute; top: 7px; width: 14px; height: 14px; margin-left: -7px; padding: 0; border: 2px solid var(--accent); background: var(--panel); transform: rotate(45deg); border-radius: 2px; cursor: ew-resize; touch-action: none; z-index: 1; }
  .key.event { transform: none; border-radius: 50%; border-color: var(--warn); }
  .key.sound { transform: none; border-color: var(--ok); }
  .key.sel { background: var(--accent); }
  .key.event.sel { background: var(--warn); }
  .key.sound.sel { background: var(--ok); }
  .end { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px dashed var(--line); pointer-events: none; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid var(--error); pointer-events: none; z-index: 3; }
</style>
