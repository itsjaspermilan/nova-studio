<script lang="ts">
  import { onMount } from "svelte";
  import { MAX_RUNS, buildTable, compilePattern, expandRuns, fillScript, matchLines, placeholders, toCsv, type SimOption, type SimRun, type SimTable } from "../lib/sim";
  import { studio } from "../lib/store.svelte";

  // What to run and what to look for. Remembered for this project in the browser.
  const KEY = () => `nova-sim:${studio.project?.root ?? ""}`;
  let script = $state("sims/play.json");
  let frames = $state(600);
  let repeat = $state(1);
  let options: SimOption[] = $state([]);
  let optionText: string[] = $state([]); // the values as typed, "a, b, c"
  let pattern = $state("");
  let columnText = $state("");

  let busy = $state(false);
  let cancel = false;
  let progress = $state("");
  let error = $state("");
  let table: SimTable | null = $state(null);
  let lastLog: string[] = $state([]);
  let scriptWords: string[] = $state([]);

  const SKIP = /(^|\/)(nova|[^/]*\.(scene|sprite|model|song|sfx|layers))\.json$|^\.nova\/|^exports\//;
  const scripts = $derived(studio.files.filter((f) => !f.dir && f.path.endsWith(".json") && !SKIP.test(f.path)).map((f) => f.path));
  const exists = $derived(studio.files.some((f) => f.path === script));

  onMount(() => {
    void studio.refreshFiles(); // scripts recorded or written since the list was last read
    try {
      const saved = JSON.parse(localStorage.getItem(KEY()) ?? "null");
      if (saved) {
        script = saved.script ?? script;
        frames = saved.frames ?? frames;
        repeat = saved.repeat ?? repeat;
        options = saved.options ?? [];
        optionText = options.map((o) => o.values.join(", "));
        pattern = saved.pattern ?? "";
        columnText = saved.columns ?? "";
      }
    } catch {
      /* nothing remembered */
    }
    void look();
  });
  $effect(() => {
    const state = { script, frames, repeat, options, pattern, columns: columnText };
    try {
      localStorage.setItem(KEY(), JSON.stringify(state));
    } catch {
      /* private window: nothing is remembered */
    }
  });
  $effect(() => {
    script; // look again when another script is chosen
    void look();
  });

  /// Which {{placeholders}} the script uses, to offer them as options.
  async function look() {
    scriptWords = [];
    if (!studio.files.some((f) => f.path === script)) return;
    try {
      const f = await studio.api!.readFile(script);
      if (f.text !== null) scriptWords = placeholders(f.text);
    } catch {
      /* not readable */
    }
  }

  const setValues = (i: number, text: string) => {
    optionText[i] = text;
    options[i]!.values = text.split(",").map((v) => v.trim()).filter(Boolean);
  };
  const addOption = (name = "") => {
    options.push({ name, values: [] });
    optionText.push("");
  };
  const removeOption = (i: number) => {
    options.splice(i, 1);
    optionText.splice(i, 1);
  };
  const columns = $derived(columnText.split(",").map((c) => c.trim()));
  const runs: SimRun[] = $derived(expandRuns(options, repeat));

  async function record() {
    if (studio.running) return studio.say("error", "A game is already running; stop it first.");
    studio.panelOpen = true;
    await studio.play(script);
    studio.say("info", `Play the game, then close its window. What you pressed is saved in ${script}.`);
  }
  async function writeOne() {
    if (!exists) {
      await studio.api!.createFile(script, '[\n  { "at": 0, "for": 300, "hold": { "key:KeyW": 1 } }\n]\n');
      await studio.refreshFiles();
    }
    await studio.openFile(script);
  }

  async function go() {
    error = "";
    table = null;
    const compiled = compilePattern(pattern);
    if (!compiled.ok) return void (error = compiled.error);
    if (!exists) return void (error = `There is no script called ${script} yet. Record one or write one.`);
    if (runs.length > MAX_RUNS) return void (error = `That is ${runs.length} runs; the most is ${MAX_RUNS}.`);
    busy = true;
    cancel = false;
    try {
      const file = await studio.api!.readFile(script);
      if (file.text === null) throw new Error(`${script} is not a text file`);
      const results: { run: SimRun; rows: string[][] }[] = [];
      for (const [i, run] of runs.entries()) {
        if (cancel) break;
        progress = `Run ${i + 1} of ${runs.length}${Object.keys(run.values).length ? ": " + Object.entries(run.values).map(([k, v]) => `${k} = ${v}`).join(", ") : ""}`;
        // a script with {{placeholders}} is filled in for this run and written beside the project's scratch files
        let input = script;
        if (placeholders(file.text).length) {
          input = ".nova/sim/run.json";
          await studio.api!.writeFile(input, fillScript(file.text, run.values));
        }
        const report = await studio.api!.runHeadless({ frames, input });
        lastLog = report.log;
        if (report.timed_out) throw new Error(`${progress} took too long and was stopped`);
        if (!report.ok && !report.log.length) throw new Error(`${progress} did not run (exit ${report.exit ?? "?"})`);
        results.push({ run, rows: matchLines(report.log, compiled.re) });
      }
      table = buildTable({ options, columns, repeat }, results);
      progress = cancel ? `Stopped after ${results.length} of ${runs.length} runs.` : `Done: ${runs.length} run${runs.length === 1 ? "" : "s"}, ${table.rows.length} matching line${table.rows.length === 1 ? "" : "s"}.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function saveCsv() {
    if (!table) return;
    try {
      await studio.api!.writeFile("sims/results.csv", toCsv(table));
      await studio.refreshFiles();
      studio.say("info", "Wrote sims/results.csv");
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  const pick = (line: string) => (pattern = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-?\d+(\.\d+)?/g, "(-?\\d+(?:\\.\\d+)?)"));
</script>

<div class="sim">
  <header>
    <h2>Simulate</h2>
    <span class="dim">Play the game with no window, many times, and collect what it prints into a table. Good for balancing: lap times for each car, how long a level takes.</span>
    <span class="spacer"></span>
    <button onclick={() => (studio.tool = null)}>Close</button>
  </header>

  <section>
    <h3>1 · The input script</h3>
    <p class="dim">What is pressed, frame by frame. Record it by playing, or write it by hand (a list of <code>{"{ \"at\": 0, \"for\": 300, \"hold\": { \"key:KeyW\": 1 } }"}</code>).</p>
    <div class="row">
      <input type="text" bind:value={script} list="sim-scripts" aria-label="script file" class="wide" />
      <datalist id="sim-scripts">{#each scripts as s (s)}<option value={s}></option>{/each}</datalist>
      <button onclick={record} disabled={studio.running} title="Runs the game; when you close its window, what you pressed is saved here">● Record a play session</button>
      <button onclick={writeOne}>{exists ? "Open it" : "Write one"}</button>
      <span class={exists ? "ok" : "dim"}>{exists ? "found" : "not there yet"}</span>
    </div>
    {#if studio.running}<p class="dim small">The game is open. Play, then close its window with the window's close button (the Stop button would lose the recording).</p>{/if}
  </section>

  <section>
    <h3>2 · What to try</h3>
    <div class="row">
      <label>Frames per run <input type="number" min="1" step="60" bind:value={frames} /></label>
      <span class="dim small">60 frames are one second of play</span>
      <label>Run each <input type="number" min="1" max="50" bind:value={repeat} /> time{repeat === 1 ? "" : "s"}</label>
    </div>
    <p class="dim small">Options change the script between runs: write <code>{"{{car}}"}</code> in the script and add an option called <code>car</code> with values <code>0, 1, 2</code>. Every combination is run.</p>
    {#each options as o, i (i)}
      <div class="row">
        <input type="text" placeholder="name" bind:value={o.name} aria-label={`option ${i + 1} name`} class="name" />
        <span>=</span>
        <input type="text" placeholder="values, separated by commas" value={optionText[i]} oninput={(e) => setValues(i, e.currentTarget.value)} aria-label={`option ${i + 1} values`} class="wide" />
        <button class="ghost" aria-label={`remove option ${i + 1}`} onclick={() => removeOption(i)}>✕</button>
      </div>
    {/each}
    <div class="row">
      <button onclick={() => addOption()}>＋ Option</button>
      {#each scriptWords.filter((w) => !options.some((o) => o.name === w)) as w (w)}
        <button class="ghost" onclick={() => addOption(w)} title="The script uses this">＋ {w}</button>
      {/each}
      <span class="dim">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
    </div>
  </section>

  <section>
    <h3>3 · What to look for in what the game prints</h3>
    <div class="row">
      <label class="grow">Lines matching <input type="text" bind:value={pattern} placeholder={"lap (\\d+): ([0-9.]+)"} class="wide mono" aria-label="pattern" /></label>
    </div>
    <div class="row">
      <label class="grow">Column names <input type="text" bind:value={columnText} placeholder="lap, time" class="wide" aria-label="column names" /></label>
    </div>
    <p class="dim small">A <em>regular expression</em>. Each bracket <code>(…)</code> becomes a column; with no brackets the whole line is one column. Print lines from Lua with <code>nova.log("lap " .. n .. ": " .. t)</code>.</p>
  </section>

  <section>
    <div class="row">
      {#if busy}
        <button class="danger" onclick={() => (cancel = true)}>Stop</button>
      {:else}
        <button class="primary" onclick={go} disabled={!runs.length}>▶ Run {runs.length} time{runs.length === 1 ? "" : "s"}</button>
      {/if}
      <span class="dim">{progress}</span>
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}

    {#if table}
      {#if table.rows.length}
        <div class="scroll">
          <table aria-label="Results">
            <thead><tr>{#each table.head as h (h)}<th>{h}</th>{/each}</tr></thead>
            <tbody>
              {#each table.rows as r, i (i)}<tr>{#each r as c, k (k)}<td>{c}</td>{/each}</tr>{/each}
            </tbody>
          </table>
        </div>
        <div class="row"><button onclick={saveCsv}>Save as sims/results.csv</button></div>
      {:else}
        <p class="dim">No line matched. Open “What the game printed” below to see its lines, and click one to make a pattern from it.</p>
      {/if}
    {/if}

    {#if lastLog.length}
      <details>
        <summary class="dim">What the game printed in the last run ({lastLog.length} lines)</summary>
        <div class="log mono">
          {#each lastLog.slice(-200) as line, i (i)}<button class="ghost line" onclick={() => pick(line)} title="Make a pattern from this line">{line}</button>{/each}
        </div>
      </details>
    {/if}
  </section>
</div>

<style>
  .sim { height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: var(--bg); }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h2 { margin: 0; font-size: 16px; }
  .spacer { flex: 1; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  h3 { margin: 0 0 4px; font-size: 13px; }
  p { margin: 2px 0 6px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
  .row label { display: flex; align-items: center; gap: 6px; }
  .row label.grow { flex: 1; }
  input.wide { flex: 1; min-width: 200px; }
  input.name { width: 120px; }
  input[type="number"] { width: 80px; }
  .ok { color: var(--ok); }
  .err { color: var(--error); white-space: pre-wrap; }
  .small { font-size: 11px; }
  .scroll { max-height: 320px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 3px 10px; border-bottom: 1px solid var(--line); }
  th { position: sticky; top: 0; background: var(--panel-2); }
  .log { max-height: 180px; overflow: auto; font-size: 11px; display: flex; flex-direction: column; align-items: flex-start; }
  .line { text-align: left; padding: 0 4px; white-space: pre; border-color: transparent; }
</style>
