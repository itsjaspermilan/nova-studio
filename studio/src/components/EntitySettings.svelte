<script lang="ts">
  // The typed settings of a placed object, as its entity file declares them (`settings = { speed = { 4, min = 0, max = 10 } }`):
  // a slider or number box, a checkbox, a list, a colour picker, a vector or a pick of an object, sprite, sound or model.
  // What is picked is written to the scene file (even the default); ↺ leaves the setting out again, so the default applies.
  import { clampTo, colourHex, colourOf, propFor, referenceNames, settingProblem, type Setting } from "../lib/entity-settings";

  let {
    settings,
    props,
    files,
    objectNames,
    onset,
  }: {
    settings: Setting[];
    props: Record<string, unknown>;
    files: string[];
    objectNames: string[];
    /// Sets the prop (undefined leaves it out: the default).
    onset: (name: string, value: unknown) => void;
  } = $props();

  const AXES = ["x", "y", "z", "w"];
  const valueOf = (s: Setting) => (s.name in props ? props[s.name] : s.default);
  const isSet = (s: Setting) => s.name in props;
  const change = (s: Setting, v: unknown) => onset(s.name, propFor(s, v));
  const num = (raw: string, fallback: number) => {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : fallback;
  };
  const tip = (s: Setting) => [s.help, s.problem && `Problem in the entity file: ${s.problem}`].filter(Boolean).join("\n");
  const stepOf = (s: Setting) => (s.step !== undefined ? String(s.step) : s.min !== undefined && s.max !== undefined ? String(niceStep(s.max - s.min)) : "any");
  /// A slider without a step moves in about a hundredth of its range, rounded to 1, 2 or 5 of a power of ten.
  function niceStep(range: number) {
    if (!(range > 0)) return 1;
    const raw = range / 100;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw)!;
  }
  const label = (name: string) => name.replaceAll("_", " ");
  // a slider being dragged shows its number here and is written to the scene once, when it is let go (one undo step)
  let live: Record<string, number> = $state({});
</script>

<div class="settings">
  {#each settings as s (s.name)}
    {@const v = valueOf(s)}
    {@const wrong = s.name in props ? settingProblem(s, v) : null}
    <div class="setting" class:set={isSet(s)} title={tip(s)}>
      <div class="head">
        <span class="name">{label(s.name)}{#if s.help}<span class="help" aria-hidden="true">?</span>{/if}</span>
        {#if isSet(s)}<button class="ghost reset" title="Back to the default ({JSON.stringify(s.default ?? "none")})" aria-label="Reset {s.name} to its default" onclick={() => onset(s.name, undefined)}>↺</button>{/if}
      </div>
      {#if s.type === "number"}
        {@const n = typeof v === "number" ? v : undefined}
        <div class="line">
          {#if s.min !== undefined && s.max !== undefined}
            <input type="range" min={s.min} max={s.max} step={stepOf(s)} value={live[s.name] ?? n ?? s.min} aria-label="{s.name} slider" oninput={(e) => (live[s.name] = Number(e.currentTarget.value))} onchange={(e) => { delete live[s.name]; change(s, Number(e.currentTarget.value)); }} />
          {/if}
          <input class="number" type="number" min={s.min} max={s.max} step={stepOf(s)} value={live[s.name] ?? n ?? ""} placeholder="none" aria-label={s.name} onchange={(e) => { const x = num(e.currentTarget.value, NaN); change(s, Number.isNaN(x) ? undefined : clampTo(s, x)); }} />
        </div>
      {:else if s.type === "boolean"}
        <label class="check"><input type="checkbox" checked={v === true} aria-label={s.name} onchange={(e) => change(s, e.currentTarget.checked)} /> {v === true ? "yes" : "no"}</label>
      {:else if s.type === "choice"}
        <select value={String(v)} aria-label={s.name} onchange={(e) => change(s, (s.choices ?? []).find((c) => String(c) === e.currentTarget.value))}>
          {#each s.choices ?? [] as c (c)}<option value={String(c)}>{c === "" ? "(none)" : c}</option>{/each}
          {#if !(s.choices ?? []).includes(v as string)}<option value={String(v)}>{String(v)} (not a choice)</option>{/if}
        </select>
      {:else if s.type === "colour"}
        {@const c = colourOf(v)}
        <div class="line">
          <input type="color" value={c ? colourHex(c.slice(0, 3)) : "#000000"} aria-label={s.name} oninput={(e) => change(s, c && c.length > 3 ? [...colourOf(e.currentTarget.value)!, c[3]!] : e.currentTarget.value)} />
          <code class="dim small">{c ? colourHex(c) : "none"}</code>
        </div>
      {:else if s.type === "vector"}
        {@const list = Array.isArray(v) ? (v as number[]) : Array.from({ length: s.size ?? 2 }, () => 0)}
        <div class="line">
          {#each Array.from({ length: s.size ?? 2 }, (_, i) => i) as i (i)}
            <label class="axis">{AXES[i]}<input class="number" type="number" step={s.step ?? "any"} min={s.min} max={s.max} value={list[i] ?? 0} aria-label="{s.name} {AXES[i]}" onchange={(e) => { const next = [...list]; next[i] = clampTo(s, num(e.currentTarget.value, list[i] ?? 0)); change(s, next); }} /></label>
          {/each}
        </div>
      {:else if s.type === "text"}
        <input value={typeof v === "string" ? v : ""} aria-label={s.name} onchange={(e) => change(s, e.currentTarget.value)} />
      {:else}
        {@const names = referenceNames(s.type, files, objectNames)}
        <select value={typeof v === "string" ? v : ""} aria-label={s.name} onchange={(e) => change(s, e.currentTarget.value)}>
          <option value="">(none)</option>
          {#each names as n (n)}<option value={n}>{n}</option>{/each}
          {#if typeof v === "string" && v && !names.includes(v)}<option value={v}>{v} (missing)</option>{/if}
        </select>
      {/if}
      {#if wrong}<p class="bad small">This value {wrong}: the game will stop with an error.</p>{/if}
      {#if s.problem}<p class="bad small">The entity file: {s.problem}</p>{/if}
    </div>
  {/each}
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 6px; }
  .setting { display: flex; flex-direction: column; gap: 2px; padding: 4px 6px; border-left: 2px solid transparent; }
  .setting.set { border-left-color: var(--accent, #6aa0ff); }
  .head { display: flex; align-items: center; justify-content: space-between; min-height: 20px; }
  .name { font-size: 12px; }
  .setting:not(.set) .name { opacity: 0.75; }
  .help { display: inline-block; margin-left: 4px; width: 13px; height: 13px; line-height: 13px; text-align: center; border-radius: 50%; font-size: 9px; background: var(--border, #555); cursor: help; }
  .reset { padding: 0 6px; }
  .line { display: flex; gap: 6px; align-items: center; }
  .line input[type="range"] { flex: 1; min-width: 0; }
  .number { width: 72px; min-width: 0; padding: 2px 6px; }
  .line > .number:only-child { width: 100%; }
  .axis { display: flex; gap: 2px; align-items: center; flex: 1; min-width: 0; font-size: 11px; }
  .axis .number { width: 100%; }
  .check { display: flex; gap: 6px; align-items: center; font-size: 12px; }
  .bad { color: var(--danger, #e06c6c); margin: 0; }
  .small { font-size: 11px; }
</style>
