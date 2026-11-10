<script lang="ts">
  // The Languages table: one row per key, one column per language (locales/<code>.json), with the missing texts marked, {name} checks, the keys the
  // code asks for, and a CSV for a translator's spreadsheet. A change is written to every language file when the file is saved.
  import { onMount, untrack } from "svelte";
  import { addKey, addLanguage, buildTable, deleteKey, fromCsv, isKey, isLanguageCode, keysUsed, missing, placeholderProblems, removeLanguage, renameKey, serialize, setText, toCsv, type LocaleTable } from "../lib/locales";
  import { toBase64 } from "../lib/wav";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();
  const thisCode = untrack(() => path).replace(/^locales\//, "").replace(/\.json$/, "");

  let table = $state.raw<LocaleTable>({ languages: [], keys: [], text: {} });
  let loadErrors = $state<{ code: string; error: string }[]>([]);
  let ready = $state(false);
  let newLang = $state("");
  let newKeyText = $state("");
  let onlyMissing = $state(false);
  let used = $state<string[] | null>(null);
  let removed: string[] = []; // languages taken out: their files are deleted on save
  let csvFile: HTMLInputElement | undefined = $state();

  const files = $derived(studio.files.filter((f) => !f.dir && /^locales\/[^/]+\.json$/.test(f.path)).map((f) => f.path));

  async function load() {
    const loaded: { code: string; text: string }[] = [];
    for (const f of files) {
      const code = f.replace(/^locales\//, "").replace(/\.json$/, "");
      const tab = studio.tabs.find((t) => t.path === f);
      try {
        loaded.push({ code, text: tab && !tab.binary ? tab.text : ((await studio.api!.readFile(f)).text ?? "") });
      } catch {
        // unreadable: left out
      }
    }
    // the first column is the language the game falls back to: English when there is one
    loaded.sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.code.localeCompare(b.code)));
    const built = buildTable(loaded);
    table = built.table;
    loadErrors = built.errors;
    ready = true;
  }
  onMount(() => void load());

  function changed(next: LocaleTable) {
    table = next;
    // this tab's own file carries its text; the others are written by the save hook
    if (table.languages.includes(thisCode)) studio.edit(path, serialize(table, thisCode));
    studio.markPending(path);
  }
  $effect(() => {
    const p = path;
    studio.saveHooks.set(p, async () => {
      for (const l of table.languages) await studio.api!.writeFile(`locales/${l}.json`, serialize(table, l));
      for (const l of removed) await studio.api!.deleteFile(`locales/${l}.json`).catch(() => "");
      removed = [];
      await studio.refreshFiles();
    });
    return () => void studio.saveHooks.delete(p);
  });

  const problems = $derived(placeholderProblems(table));
  const gaps = $derived(missing(table));
  const gapSet = $derived(new Set(gaps.map((g) => `${g.lang}\u0000${g.key}`)));
  const shownKeys = $derived(onlyMissing ? table.keys.filter((k) => table.languages.some((l) => gapSet.has(`${l}\u0000${k}`))) : table.keys);
  const notInTable = $derived((used ?? []).filter((k) => !table.keys.includes(k)));

  function addLang() {
    const code = newLang.trim();
    if (!isLanguageCode(code) || table.languages.includes(code)) return;
    changed(addLanguage(table, code));
    removed = removed.filter((r) => r !== code);
    newLang = "";
  }
  function dropLang(code: string) {
    if (!confirm(`Remove the language "${code}" and delete its file when you save?`)) return;
    removed.push(code);
    changed(removeLanguage(table, code));
  }
  const keyOk = $derived(isKey(newKeyText.trim()) && !table.keys.includes(newKeyText.trim()));
  function addRow() {
    if (!keyOk) return;
    changed(addKey(table, newKeyText.trim()));
    newKeyText = "";
  }

  async function findUsed() {
    const sources: string[] = [];
    for (const f of studio.files.filter((f) => !f.dir && f.path.endsWith(".lua"))) {
      const tab = studio.tabs.find((t) => t.path === f.path);
      try {
        sources.push(tab && !tab.binary ? tab.text : ((await studio.api!.readFile(f.path)).text ?? ""));
      } catch {
        // skipped
      }
    }
    used = keysUsed(sources);
  }
  async function exportCsv() {
    const p = "exports/languages.csv";
    try {
      await studio.api!.writeExport(p, `data:text/csv;base64,${toBase64(new TextEncoder().encode(toCsv(table)))}`);
      await studio.refreshFiles();
      studio.say("info", `Saved ${p}. Open it in a spreadsheet; give it back with Import a sheet.`);
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  async function importCsv(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const next = fromCsv(table, await file.text());
    if (!next) return void studio.say("error", "That is not a languages sheet: the first line should be key, then a language code in each column (key,en,fr).");
    changed(next);
    studio.say("info", `Read ${file.name}: ${next.keys.length} keys, ${next.languages.length} languages.`);
  }
  const autosize = (n: HTMLTextAreaElement) => {
    const fit = () => ((n.style.height = "auto"), (n.style.height = `${Math.min(160, n.scrollHeight)}px`));
    fit();
    n.addEventListener("input", fit);
    return { destroy: () => n.removeEventListener("input", fit) };
  };
</script>

{#if !ready}
  <div class="pad dim">Loading…</div>
{:else}
  <div class="locale">
    <div class="bar">
      <h2>Languages</h2>
      <span class="dim">{table.keys.length} lines, {table.languages.length} language{table.languages.length === 1 ? "" : "s"}{gaps.length ? `, ${gaps.length} not written yet` : ""}</span>
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" bind:checked={onlyMissing} /> Only lines with a gap</label>
      <button class="ghost" onclick={exportCsv} title="Write the table as a CSV into the exports folder, for a spreadsheet">Export a sheet</button>
      <button class="ghost" onclick={() => csvFile?.click()} title="Read a CSV made by Export a sheet (new languages and lines are added)">Import a sheet</button>
      <input bind:this={csvFile} type="file" accept=".csv,text/csv" hidden onchange={importCsv} />
    </div>
    <p class="dim small">In Lua: <code>nova.t("menu.start")</code>, <code>nova.t("coins", {"{ count = 3 }"})</code>, and <code>nova.locale.set("fr")</code> to switch. The first column is the language the game falls back to. A <code>&#123;name&#125;</code> in a text is filled in by the game.</p>
    {#each loadErrors as e (e.code)}<p class="warn">locales/{e.code}.json cannot be read ({e.error}); it is left out until you fix the file.</p>{/each}
    {#each problems as p (p.lang + p.key)}<p class="warn small"><code>{p.key}</code> in {p.lang} {p.message}.</p>{/each}

    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th class="key">Key</th>
            {#each table.languages as l (l)}
              <th>{l}{#if l === table.languages[0]} <span class="dim small">(fallback)</span>{/if}<button class="ghost x" aria-label="Remove {l}" title="Remove this language" onclick={() => dropLang(l)}>✕</button></th>
            {/each}
            <th class="add">
              <form onsubmit={(e) => { e.preventDefault(); addLang(); }}>
                <input bind:value={newLang} placeholder="new language, e.g. fr" aria-label="New language code" size="14" />
                <button class="primary" disabled={!isLanguageCode(newLang.trim()) || table.languages.includes(newLang.trim())}>Add</button>
              </form>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each shownKeys as k (k)}
            <tr>
              <td class="key">
                <input class="keybox" value={k} aria-label="Key" onchange={(e) => { const v = e.currentTarget.value.trim(); const n = renameKey(table, k, v); if (n === table) e.currentTarget.value = k; else changed(n); }} />
              </td>
              {#each table.languages as l (l)}
                <td class:gap={gapSet.has(`${l}\u0000${k}`)}>
                  <textarea rows="1" use:autosize value={table.text[l]?.[k] ?? ""} aria-label="{k} in {l}" placeholder={gapSet.has(`${l}\u0000${k}`) ? "not written yet" : ""} onchange={(e) => changed(setText(table, l, k, e.currentTarget.value))}></textarea>
                </td>
              {/each}
              <td class="add"><button class="ghost danger" aria-label="Delete {k}" title="Delete this line from every language" onclick={() => changed(deleteKey(table, k))}>✕</button></td>
            </tr>
          {:else}
            <tr><td colspan={table.languages.length + 2} class="dim pad">{onlyMissing ? "Every line is written in every language." : "No lines yet. Add one below."}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <form class="newkey" onsubmit={(e) => { e.preventDefault(); addRow(); }}>
      <input bind:value={newKeyText} placeholder="new line, e.g. menu.start" aria-label="New key" />
      <button class="primary" disabled={!keyOk}>Add a line</button>
      <button type="button" class="ghost" onclick={findUsed} title="Look through the Lua files for nova.t(...) calls">Find the lines the code asks for</button>
    </form>
    {#if used}
      {#if notInTable.length}
        <p class="warn small">The code asks for {notInTable.length} line{notInTable.length === 1 ? "" : "s"} the table does not have:
          {#each notInTable as k (k)} <button class="chipbtn" onclick={() => changed(addKey(table, k))} title="Add this line">＋ {k}</button>{/each}
        </p>
      {:else}
        <p class="dim small">Every line the code asks for ({used.length}) is in the table.</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .locale { height: 100%; overflow: auto; padding: 12px 20px 40px; display: flex; flex-direction: column; gap: 8px; }
  .pad { padding: 12px; }
  .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 16px; }
  .spacer { flex: 1; }
  .wrap { overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); padding: 4px; vertical-align: top; text-align: left; min-width: 200px; }
  th { position: sticky; top: 0; background: var(--panel); z-index: 1; font-size: 12px; }
  th.key, td.key { min-width: 160px; width: 180px; }
  th.add, td.add { min-width: 0; width: 1%; white-space: nowrap; border-right: none; }
  .x { padding: 0 4px; margin-left: 6px; }
  textarea { width: 100%; resize: none; font: inherit; box-sizing: border-box; min-height: 28px; }
  td.gap textarea { background: color-mix(in srgb, #e0a030 12%, var(--bg)); }
  .keybox { width: 100%; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .newkey { display: flex; gap: 8px; }
  .newkey input { flex: 1; max-width: 320px; }
  .small { font-size: 11px; }
  .chipbtn { margin: 2px; padding: 1px 8px; border-radius: 10px; }
  th form { display: flex; gap: 4px; }
</style>
