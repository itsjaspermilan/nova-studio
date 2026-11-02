<script lang="ts">
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import {
    FACES, History, addCube, addPart, afterRemoval, countCubes, cubeAt, duplicateNode, faceColor, newModel, parseModel, partAt, removeNode, samePath, serializeModel,
    setFaceColor, updateCube, updatePart, walk, namesOf, PROPS, type Face, type ModelDoc, type Path, type Prop, type Vec3,
  } from "../lib/model-doc";
  import { exportGlb } from "../lib/glb";
  import { addClip, findTrack, pathKey, removeClip, removeKey, samplePose, setKey, snapTime, updateClip, KEY_STEP, type Pose } from "../lib/model-anim";
  import { toBase64 } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path: filePath, text, onjson }: { path: string; text: string; onjson: () => void } = $props();

  const parsed = untrack(() => parseModel(text));
  const error = parsed.ok ? "" : parsed.error;
  let doc: ModelDoc = $state.raw(parsed.ok ? parsed.doc : newModel());
  let selected = $state<Path | null>(null);
  let showGrid = $state(true);
  // animation
  let mode = $state<"model" | "animate">("model");
  let clipIndex = $state(0);
  let animTime = $state(0);
  let playingAnim = $state(false);
  const history = new History();
  let tick = $state(0);
  const canUndo = $derived(tick >= 0 && history.canUndo);
  const canRedo = $derived(tick >= 0 && history.canRedo);
  const glbPath = untrack(() => filePath).replace(/\.model\.json$/i, ".glb");
  const modelName = glbPath.slice(glbPath.lastIndexOf("/") + 1).replace(/\.glb$/, "");

  let canvas: HTMLCanvasElement | undefined = $state();
  let box: HTMLDivElement | undefined = $state();
  let webglFailed = $state(false);

  // Editors with files of their own register a save hook; this one writes the .glb the game loads.
  onMount(() => {
    if (error) return;
    studio.saveHooks.set(filePath, async () => {
      const bytes = exportGlb((studio.sessions.get(filePath) as { doc: ModelDoc } | undefined)?.doc ?? doc);
      await studio.api!.writeModel(glbPath, `data:model/gltf-binary;base64,${toBase64(bytes)}`);
    });
    studio.sessions.set(filePath, { doc });
  });

  function commit(next: ModelDoc, keep = false) {
    if (!keep) history.record(doc);
    doc = next;
    tick++;
    studio.sessions.set(filePath, { doc });
    studio.edit(filePath, serializeModel(next));
  }
  const undo = () => {
    const p = history.undo(doc);
    if (p) commit(p, true);
  };
  const redo = () => {
    const n = history.redo(doc);
    if (n) commit(n, true);
  };

  // ---- three.js viewport ----------------------------------------------------------------------------
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let controls: OrbitControls | undefined;
  let modelGroup: THREE.Group | undefined;
  let grid: THREE.GridHelper | undefined;
  let outline: THREE.Box3Helper | undefined;
  let frameId = 0;
  const meshes: { mesh: THREE.Mesh; path: Path }[] = [];
  /// Part groups by name path, with how they are authored, so a clip can pose them and put them back.
  const groups = new Map<string, { group: THREE.Group; origin: Vec3; rotation: Vec3 }>();

  function setup() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas!, antialias: true });
    } catch {
      webglFailed = true;
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15171c);
    camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    camera.position.set(34, 28, 46);
    controls = new OrbitControls(camera, canvas!);
    controls.target.set(0, 8, 0);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(20, 40, 30);
    scene.add(sun);
    grid = new THREE.GridHelper(64, 32, 0x4a5163, 0x2c313c);
    scene.add(grid);
    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    rebuild();
    const loop = () => {
      frameId = requestAnimationFrame(loop);
      controls!.update();
      renderer!.render(scene!, camera!);
    };
    loop();
  }

  const colour = (hex: string) => {
    const c = new THREE.Color(hex.slice(0, 7));
    return c;
  };

  function rebuild() {
    if (!modelGroup) return;
    for (const m of meshes) {
      m.mesh.geometry.dispose();
      for (const mat of m.mesh.material as THREE.Material[]) mat.dispose();
    }
    meshes.length = 0;
    groups.clear();
    modelGroup.clear();
    const build = (list: ModelDoc["parts"], parent: THREE.Object3D, prefix: number[]) => {
      list.forEach((part, i) => {
        const parts = [...prefix, i];
        const group = new THREE.Group();
        groups.set(pathKey(namesOf(doc, parts)), { group, origin: [...part.origin], rotation: [...part.rotation] });
        group.position.set(...part.origin);
        group.rotation.set(...(part.rotation.map((d) => (d * Math.PI) / 180) as Vec3), "XYZ");
        group.name = part.name;
        part.cubes.forEach((cube, ci) => {
          const [sx, sy, sz] = cube.size;
          // BoxGeometry face order is +x, -x, +y, -y, +z, -z, the same as FACES (east, west, up, down, south, north).
          const materials = FACES.map((f) => new THREE.MeshLambertMaterial({ color: colour(faceColor(cube, f)), transparent: faceColor(cube, f).length === 9, opacity: faceColor(cube, f).length === 9 ? parseInt(faceColor(cube, f).slice(7, 9), 16) / 255 : 1 }));
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001)), materials);
          mesh.position.set(cube.from[0] + sx / 2, cube.from[1] + sy / 2, cube.from[2] + sz / 2);
          group.add(mesh);
          meshes.push({ mesh, path: { parts, cube: ci } });
        });
        parent.add(group);
        build(part.children, group, parts);
      });
    };
    build(doc.parts, modelGroup, []);
    applyPose();
  }

  /// Puts every part where the clip says at the current time (or where it was authored, outside animate mode).
  function applyPose() {
    if (!modelGroup) return;
    const clip = mode === "animate" ? doc.clips?.[clipIndex] : undefined;
    const pose: Map<string, Pose> = clip ? samplePose(clip, animTime, false) : new Map();
    for (const [key, g] of groups) {
      g.group.position.set(...g.origin);
      g.group.rotation.set(...(g.rotation.map((d) => (d * Math.PI) / 180) as Vec3), "XYZ");
      g.group.scale.set(1, 1, 1);
      const p = pose.get(key);
      if (p?.position) g.group.position.set(...p.position);
      if (p?.rotation) g.group.quaternion.set(...p.rotation);
      if (p?.scale) g.group.scale.set(...p.scale);
    }
    modelGroup.updateMatrixWorld(true);
    drawOutline();
  }

  function drawOutline() {
    if (!scene) return;
    if (outline) {
      scene.remove(outline);
      outline.dispose();
      outline = undefined;
    }
    if (!selected) return;
    const box3 = new THREE.Box3();
    const inside = (p: Path) => (selected!.cube === undefined ? p.parts.length >= selected!.parts.length && selected!.parts.every((n, i) => n === p.parts[i]) : samePath(p, selected));
    for (const m of meshes) if (inside(m.path)) box3.expandByObject(m.mesh);
    if (box3.isEmpty()) return;
    outline = new THREE.Box3Helper(box3, 0xffd166);
    scene.add(outline);
  }

  $effect(() => {
    doc; // redraw whenever the model changes
    if (modelGroup) untrack(rebuild);
  });
  $effect(() => {
    selected;
    untrack(drawOutline);
  });
  $effect(() => {
    animTime; clipIndex; mode;
    untrack(applyPose);
  });
  // Playback: advance the time every frame, wrapping if the clip loops and stopping at its end if not.
  $effect(() => {
    if (!playingAnim) return;
    let last = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const clip = untrack(() => doc.clips?.[clipIndex]);
      if (!clip) return void (playingAnim = false);
      let t = untrack(() => animTime) + (now - last) / 1000;
      last = now;
      if (t >= clip.duration) {
        if (clip.loop) t %= clip.duration;
        else {
          t = clip.duration;
          playingAnim = false;
        }
      }
      animTime = t;
      if (playingAnim) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  });
  $effect(() => {
    if (grid) grid.visible = showGrid;
  });

  $effect(() => {
    if (!box || !canvas || error) return;
    untrack(setup);
    const watch = new ResizeObserver(() => {
      if (!renderer || !camera) return;
      const w = Math.max(100, box!.clientWidth);
      const h = Math.max(100, box!.clientHeight);
      renderer.setSize(w, h, false);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    watch.observe(box);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frameId);
      controls?.dispose();
      for (const m of meshes) {
        m.mesh.geometry.dispose();
        for (const mat of m.mesh.material as THREE.Material[]) mat.dispose();
      }
      outline?.dispose();
      renderer?.dispose();
      renderer = undefined;
    };
  });

  // Click (without dragging) selects the cube under the pointer.
  let downAt: [number, number] | null = null;
  function pointerDown(e: PointerEvent) {
    downAt = [e.clientX, e.clientY];
  }
  function pointerUp(e: PointerEvent) {
    if (!downAt || !camera || !canvas) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    selected = hit ? (meshes.find((m) => m.mesh === hit.object)?.path ?? null) : null;
    canvas.focus();
  }

  function resetView() {
    camera?.position.set(34, 28, 46);
    controls?.target.set(0, 8, 0);
  }

  // ---- editing ------------------------------------------------------------------------------------------
  const rows = $derived(walk(doc));
  const cube = $derived(selected ? cubeAt(doc, selected) : undefined);
  const part = $derived(selected && selected.cube === undefined ? partAt(doc, selected.parts) : selected ? partAt(doc, selected.parts) : undefined);

  function newPart(parent: number[]) {
    const r = addPart(doc, parent);
    commit(r.doc);
    selected = r.path;
  }
  function newCube() {
    const target = selected?.parts ?? (doc.parts.length ? [0] : null);
    if (!target) return newPart([]);
    const r = addCube(doc, target);
    commit(r.doc);
    selected = r.path;
  }
  function remove() {
    if (!selected) return;
    const gone = selected;
    const next = removeNode(doc, gone);
    if (next === doc) return;
    commit(next);
    selected = afterRemoval(next, gone);
  }
  function duplicate() {
    if (!selected) return;
    const r = duplicateNode(doc, selected);
    if (!r) return;
    commit(r.doc);
    selected = r.path;
  }
  const num = (raw: string, fallback: number) => (Number.isFinite(Number(raw)) && raw.trim() !== "" ? Number(raw) : fallback);
  function setVec(kind: "from" | "size" | "origin" | "rotation", index: number, raw: string) {
    if (!selected) return;
    if (kind === "origin" || kind === "rotation") {
      const p = partAt(doc, selected.parts)!;
      const v = [...p[kind]] as Vec3;
      v[index] = num(raw, v[index]!);
      commit(updatePart(doc, selected.parts, { [kind]: v }));
    } else if (cube) {
      const v = [...cube[kind]] as Vec3;
      v[index] = num(raw, v[index]!);
      commit(updateCube(doc, selected, { [kind]: v }));
    }
  }
  function nudge(dx: number, dy: number, dz: number) {
    if (!selected) return;
    if (selected.cube !== undefined && cube) commit(updateCube(doc, selected, { from: [cube.from[0] + dx, cube.from[1] + dy, cube.from[2] + dz] }));
    else if (part) commit(updatePart(doc, selected.parts, { origin: [part.origin[0] + dx, part.origin[1] + dy, part.origin[2] + dz] }));
  }
  // ---- animation ----------------------------------------------------------------------------------------
  const clips = $derived(doc.clips ?? []);
  const clip = $derived(clips[clipIndex]);
  const partNames = $derived(selected ? namesOf(doc, selected.parts) : []);
  const authored = (p: NonNullable<typeof part>, prop: Prop): Vec3 => (prop === "position" ? p.origin : prop === "rotation" ? p.rotation : [1, 1, 1]);
  const toEuler = (q: [number, number, number, number]): Vec3 => {
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...q), "XYZ");
    return [e.x, e.y, e.z].map((r) => Math.round(((r * 180) / Math.PI) * 100) / 100) as Vec3;
  };
  /// The value of one property of the selected part right now: from the clip if it keys it, else as authored.
  function poseValue(prop: Prop): Vec3 {
    const p = part;
    if (!p) return [0, 0, 0];
    const pose = clip ? samplePose(clip, animTime, false).get(pathKey(partNames)) : undefined;
    if (prop === "position" && pose?.position) return pose.position;
    if (prop === "scale" && pose?.scale) return pose.scale;
    if (prop === "rotation" && pose?.rotation) return toEuler(pose.rotation);
    return authored(p, prop);
  }
  const keyedHere = (prop: Prop) => !!clip && !!findTrack(clip, partNames, prop)?.keys.some((k) => Math.abs(k.t - animTime) < KEY_STEP / 2);
  function keyProp(prop: Prop, value = poseValue(prop)) {
    if (clip && partNames.length) commit(setKey(doc, clipIndex, partNames, prop, animTime, value));
  }
  function setPoseValue(prop: Prop, index: number, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === "") return;
    const v = [...poseValue(prop)] as Vec3;
    v[index] = n;
    keyProp(prop, v); // editing a value in animate mode keys it at the current time
  }
  const keyTimes = $derived(
    clip && partNames.length
      ? [...new Set(PROPS.flatMap((prop) => findTrack(clip, partNames, prop)?.keys.map((k) => k.t) ?? []))].sort((a, b) => a - b)
      : [],
  );
  function newClip() {
    const r = addClip(doc);
    commit(r.doc);
    clipIndex = r.index;
    animTime = 0;
    mode = "animate";
  }
  function dropClip() {
    if (!clip || !confirm(`Delete the animation "${clip.name}"?`)) return;
    commit(removeClip(doc, clipIndex));
    clipIndex = Math.max(0, clipIndex - 1);
    animTime = 0;
    playingAnim = false;
  }
  function deleteKeysHere() {
    let next = doc;
    for (const prop of PROPS) next = removeKey(next, clipIndex, partNames, prop, animTime);
    if (next !== doc) commit(next);
  }
  const fmtTime = (t: number) => t.toFixed(2);

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 4 : 1;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === "d" && selected) {
      e.preventDefault();
      duplicate();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      remove();
    } else if (selected && !mod) {
      const moves: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], PageUp: [0, step, 0], PageDown: [0, -step, 0] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        nudge(...m);
      }
    }
  }
  const hexOf = (c: string) => c.slice(0, 7);
  const pickColour = (face: Face | "all", value: string) => selected && commit(setFaceColor(doc, selected, face, value));
  const label = (f: Face) => ({ east: "East +x", west: "West −x", up: "Top +y", down: "Bottom −y", south: "South +z", north: "North −z" })[f];
</script>

<svelte:window onkeydown={key} />

{#if error}
  <div class="bad">
    <p><strong>This model file can't be shown visually.</strong></p>
    <p class="dim">{error}</p>
    <button onclick={onjson}>Edit as JSON</button>
  </div>
{:else}
  <div class="editor3d">
    <aside class="outliner">
      <div class="row">
        <button onclick={() => newPart(selected?.parts ?? [])} title="New part inside the selected one">＋ Part</button>
        <button onclick={newCube} title="New cube in the selected part">＋ Cube</button>
      </div>
      <ul>
        {#each rows as r (r.parts.join("."))}
          <li>
            <button class="node" class:on={selected?.cube === undefined && samePath(selected, { parts: r.parts })} style:padding-left="{8 + r.depth * 14}px" onclick={() => (selected = { parts: r.parts })}>◈ {r.part.name}</button>
            {#each r.part.cubes as c, ci (ci)}
              <button class="node cube" class:on={samePath(selected, { parts: r.parts, cube: ci })} style:padding-left="{22 + r.depth * 14}px" onclick={() => (selected = { parts: r.parts, cube: ci })}>
                <i class="dot" style:background={hexOf(c.color)}></i>{c.name || `cube ${ci + 1}`}
              </button>
            {/each}
          </li>
        {/each}
      </ul>
    </aside>

    <div class="stage">
      <div class="bar">
        <button class="ghost" onclick={undo} disabled={!canUndo} aria-label="Undo">↶</button>
        <button class="ghost" onclick={redo} disabled={!canRedo} aria-label="Redo">↷</button>
        <button class:on={mode === "model"} onclick={() => { mode = "model"; playingAnim = false; }}>Model</button>
        <button class:on={mode === "animate"} onclick={() => { mode = "animate"; if (!clips.length) newClip(); }}>Animate</button>
        <label class="check"><input type="checkbox" bind:checked={showGrid} /> Grid</label>
        <button class="ghost" onclick={resetView}>Reset view</button>
        <span class="dim">{countCubes(doc)} cubes · saves {glbPath}</span>
        <span class="spacer"></span>
        <button class="ghost" onclick={onjson}>JSON</button>
      </div>
      <div class="view" bind:this={box}>
        {#if webglFailed}
          <p class="dim pad">3D drawing is not available in this window (WebGL could not start).</p>
        {/if}
        <canvas bind:this={canvas} tabindex="0" aria-label="3D view" onpointerdown={pointerDown} onpointerup={pointerUp}></canvas>
      </div>
      {#if mode === "animate" && clip}
        <div class="timeline">
          <div class="clips">
            <select bind:value={clipIndex} aria-label="Animation" onchange={() => { animTime = 0; playingAnim = false; }}>
              {#each clips as c, i (i)}<option value={i}>{c.name}</option>{/each}
            </select>
            <button onclick={newClip} title="New animation">＋</button>
            <input class="cname" value={clip.name} aria-label="Animation name" onchange={(e) => commit(updateClip(doc, clipIndex, { name: e.currentTarget.value }))} />
            <label class="inline">Length <input type="number" min="0.1" max="600" step="0.1" value={clip.duration} onchange={(e) => commit(updateClip(doc, clipIndex, { duration: Number(e.currentTarget.value) }))} /> s</label>
            <label class="check"><input type="checkbox" checked={clip.loop} onchange={(e) => commit(updateClip(doc, clipIndex, { loop: e.currentTarget.checked }))} /> Loop</label>
            <button class="danger" onclick={dropClip}>Delete</button>
          </div>
          <div class="scrub">
            <button class="primary" onclick={() => { if (animTime >= clip.duration) animTime = 0; playingAnim = !playingAnim; }}>{playingAnim ? "■" : "▶"}</button>
            <div class="track">
              <input type="range" min="0" max={clip.duration} step={KEY_STEP} value={animTime} aria-label="Time" oninput={(e) => { playingAnim = false; animTime = snapTime(Number(e.currentTarget.value)); }} />
              {#each keyTimes as t (t)}
                <button class="diamond" style:left="{(t / clip.duration) * 100}%" title="Key at {fmtTime(t)} s" aria-label="Jump to key at {fmtTime(t)} seconds" onclick={() => { playingAnim = false; animTime = t; }}>◆</button>
              {/each}
            </div>
            <span class="dim time">{fmtTime(animTime)} / {fmtTime(clip.duration)} s</span>
          </div>
        </div>
      {/if}
      <p class="hint dim">Drag to orbit · right-drag to pan · scroll to zoom · click a cube to select · arrows and PageUp/PageDown move it (⇧ for 4) · ⌘D duplicates · Delete removes</p>
    </div>

    <aside class="inspector">
      {#if mode === "animate"}
        <h3>Pose</h3>
        {#if !clip}
          <p class="dim small">Make an animation first (＋).</p>
        {:else if !selected || !part}
          <p class="dim small">Select a part (or one of its cubes) to pose it. Changing a value sets a key at {fmtTime(animTime)} s.</p>
        {:else}
          <p class="small"><strong>{partNames.join(" › ")}</strong></p>
          {#each [["position", "Position"], ["rotation", "Rotation (°)"], ["scale", "Scale"]] as [prop, label] (prop)}
            <h4>{label} {#if keyedHere(prop as Prop)}<span class="keyed" title="There is a key here">◆</span>{/if}</h4>
            <div class="vec">{#each poseValue(prop as Prop) as v, i (i)}<input type="number" step={prop === "scale" ? 0.1 : 1} value={v} aria-label={`${"xyz"[i]} ${prop}`} onchange={(e) => setPoseValue(prop as Prop, i, e.currentTarget.value)} />{/each}</div>
            <button class="ghost keybtn" onclick={() => keyProp(prop as Prop)}>◆ Key {prop}</button>
          {/each}
          <div class="row"><button class="danger" onclick={deleteKeysHere} disabled={!keyTimes.some((t) => Math.abs(t - animTime) < KEY_STEP / 2)}>Delete keys here</button></div>
          <p class="dim small">Properties with no key stay as modelled. Keys blend smoothly; rotations take the short way round.</p>
        {/if}
      {:else if selected && cube}
        <h3>Cube</h3>
        <label>Name <input value={cube.name ?? ""} placeholder="optional" onchange={(e) => commit(updateCube(doc, selected!, { name: e.currentTarget.value.trim() || undefined }))} /></label>
        <h4>Corner (from)</h4>
        <div class="vec">{#each cube.from as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " from"} onchange={(e) => setVec("from", i, e.currentTarget.value)} />{/each}</div>
        <h4>Size</h4>
        <div class="vec">{#each cube.size as v, i (i)}<input type="number" min="0" value={v} aria-label={"xyz"[i] + " size"} onchange={(e) => setVec("size", i, e.currentTarget.value)} />{/each}</div>
        <h4>Colour</h4>
        <label class="colour">All faces <input type="color" value={hexOf(cube.color)} onchange={(e) => pickColour("all", e.currentTarget.value)} /></label>
        {#each FACES as f (f)}
          <label class="colour">{label(f)} <input type="color" value={hexOf(faceColor(cube, f))} onchange={(e) => pickColour(f, e.currentTarget.value)} /></label>
        {/each}
        <div class="row"><button onclick={duplicate}>Duplicate</button><button class="danger" onclick={remove}>Delete</button></div>
      {:else if selected && part}
        <h3>Part</h3>
        <label>Name <input value={part.name} onchange={(e) => commit(updatePart(doc, selected!.parts, { name: e.currentTarget.value }))} /></label>
        <h4>Pivot position</h4>
        <div class="vec">{#each part.origin as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " origin"} onchange={(e) => setVec("origin", i, e.currentTarget.value)} />{/each}</div>
        <h4>Rotation (degrees)</h4>
        <div class="vec">{#each part.rotation as v, i (i)}<input type="number" value={v} aria-label={"xyz"[i] + " rotation"} onchange={(e) => setVec("rotation", i, e.currentTarget.value)} />{/each}</div>
        <p class="dim small">A part moves and turns about its pivot, with its cubes and child parts. Use parts for things that will move on their own later, like wheels.</p>
        <div class="row"><button onclick={duplicate}>Duplicate</button><button class="danger" onclick={remove} disabled={doc.parts.length === 1 && selected.parts.length === 1}>Delete</button></div>
      {:else}
        <h3>Model</h3>
        <label>Export scale <input type="number" step="0.001" min="0.0001" value={doc.scale} onchange={(e) => commit({ ...doc, scale: Math.max(0.0001, num(e.currentTarget.value, doc.scale)) })} /></label>
        <p class="dim small">World units per model unit. 1/16 = 0.0625 makes a 16-unit cube one world unit.</p>
        <p class="dim small">Saving writes <code>{glbPath}</code>. In Lua: <code>nova.model("{modelName}", x, y, z)</code>.</p>
        <p class="dim small">Click a cube in the view or the list to edit it. Colours are flat per face for now; textures and animation come later.</p>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .editor3d { height: 100%; display: grid; grid-template-columns: 170px minmax(0, 1fr) 210px; min-height: 0; }
  .outliner, .inspector { background: var(--panel); overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .outliner { border-right: 1px solid var(--line); padding: 0; }
  .outliner .row { padding: 8px; border-bottom: 1px solid var(--line); }
  .outliner ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
  .node { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: transparent; border-color: transparent; border-radius: 0; padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .node:hover { background: var(--panel-2); }
  .node.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .dot { width: 10px; height: 10px; border-radius: 2px; border: 1px solid #0006; flex: none; }
  .inspector { border-left: 1px solid var(--line); }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 4px; } .check input { margin: 0; }
  .spacer { flex: 1; }
  .view { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #15171c; }
  .view canvas { position: absolute; inset: 0; display: block; outline: none; touch-action: none; }
  .pad { padding: 24px; position: relative; z-index: 1; }
  .hint { margin: 0; padding: 3px 10px; font-size: 11px; border-top: 1px solid var(--line); background: var(--panel); }
  h3 { margin: 2px 0 4px; font-size: 13px; }
  h4 { margin: 6px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); }
  label input { color: var(--text); }
  .vec { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; } .vec input { min-width: 0; padding: 3px 4px; }
  .colour { flex-direction: row; align-items: center; justify-content: space-between; } .colour input { width: 44px; height: 24px; padding: 0; }
  .row { display: flex; gap: 6px; }
  .bar button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
  .timeline { background: var(--panel); border-top: 1px solid var(--line); padding: 6px 10px; display: flex; flex-direction: column; gap: 6px; }
  .clips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .cname { width: 110px; padding: 2px 6px; }
  .inline { flex-direction: row; align-items: center; gap: 4px; } .inline input { width: 64px; padding: 2px 6px; }
  .scrub { display: flex; gap: 10px; align-items: center; }
  .track { position: relative; flex: 1; height: 28px; }
  .track input[type="range"] { width: 100%; margin: 0; position: absolute; top: 0; accent-color: var(--accent); }
  .diamond { position: absolute; top: 14px; transform: translateX(-50%); padding: 0; border: none; background: transparent; color: var(--warn); font-size: 12px; line-height: 12px; cursor: pointer; }
  .time { width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
  .keyed { color: var(--warn); }
  .keybtn { align-self: flex-start; padding: 0 6px; font-size: 11px; }
  .small { font-size: 11px; margin: 4px 0; }
  .bad { padding: 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
