<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, type Extension } from "@codemirror/state";
  import { editorStates } from "../lib/editor-state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip, tooltips } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
  import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput, foldGutter, foldKeymap, foldService } from "@codemirror/language";
  import { commands } from "../lib/commands";
  import { SNIPPETS, expandSnippet, findDefinitions, findReferences, foldRanges, formatLua, renameSymbol, wordAt, type SourceFiles } from "../lib/lua-tools";
  import { lua } from "@codemirror/legacy-modes/mode/lua";
  import { json } from "@codemirror/lang-json";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import { lintGutter, setDiagnostics } from "@codemirror/lint";
  import { tags as t } from "@lezer/highlight";
  import { complete, identifierAt, lookup } from "../lib/completions";
  import { markersFor } from "../lib/diagnostics";
  import { studio } from "../lib/store.svelte";
  import { debug } from "../lib/debugger.svelte";
  import { breakpointGutter, breakpointLines, setBreakpoints, setPausedLine } from "../lib/breakpoints";

  let { path, text }: { path: string; text: string } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  /// A list of places (definitions, references) shown over the editor, and the rename box.
  let results = $state<{ title: string; items: { path: string; line: number; text: string }[] } | null>(null);
  let renaming = $state<{ word: string; member: boolean; value: string; error: string } | null>(null);

  /// Every Lua file in the project as text (an open tab's unsaved text wins over the file on disk).
  async function sources(): Promise<SourceFiles> {
    const out: SourceFiles = [];
    for (const f of studio.files.filter((f) => !f.dir && f.path.endsWith(".lua"))) {
      const tab = studio.tabs.find((t) => t.path === f.path);
      if (tab && !tab.binary) out.push({ path: f.path, text: tab.text });
      else {
        try {
          out.push({ path: f.path, text: (await studio.api!.readFile(f.path)).text ?? "" });
        } catch {
          // unreadable: skip it
        }
      }
    }
    return out;
  }
  const under = () => (view ? wordAt(view.state.doc.toString(), view.state.selection.main.head) : null);

  async function goToDefinition() {
    const w = under();
    if (!w) return studio.say("info", "Put the cursor on a name first.");
    const defs = findDefinitions(await sources(), w.word, path).filter((d) => !(d.path === path && d.from === w.from));
    if (!defs.length) return studio.say("info", `No definition of "${w.word}" in this project. It may be built in: hover it for its help.`);
    if (defs.length === 1) return void studio.openFile(defs[0]!.path, defs[0]!.line);
    results = { title: `Definitions of ${w.word}`, items: defs.map((d) => ({ path: d.path, line: d.line, text: `${d.fullName}${d.signature ?? ""}  (${d.kind})` })) };
  }
  async function showReferences() {
    const w = under();
    if (!w) return studio.say("info", "Put the cursor on a name first.");
    const refs = findReferences(await sources(), w.word, w.member);
    results = { title: `${refs.length} use${refs.length === 1 ? "" : "s"} of ${w.word}`, items: refs.map((r) => ({ path: r.path, line: r.line, text: r.preview })) };
  }
  function startRename() {
    const w = under();
    if (!w) return void studio.say("info", "Put the cursor on a name first.");
    renaming = { word: w.word, member: w.member, value: w.word, error: "" };
  }
  async function doRename() {
    if (!renaming) return;
    const all = await sources();
    const r = renameSymbol(all, renaming.word, renaming.value.trim(), renaming.member);
    if ("error" in r) {
      renaming.error = r.error;
      return;
    }
    const was = studio.active;
    for (const c of r.changes) {
      if (c.path === path && view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c.text } }); // (the listener tells the studio)
        continue;
      }
      if (!studio.tabs.some((t) => t.path === c.path)) await studio.openFile(c.path);
      editorStates.forget(c.path);
      studio.edit(c.path, c.text);
    }
    if (was) studio.active = was;
    studio.say("info", `Renamed ${renaming.word} to ${renaming.value.trim()} in ${r.total} place${r.total === 1 ? "" : "s"}, ${r.changes.length} file${r.changes.length === 1 ? "" : "s"}. Save to keep it; undo works in each file.`);
    renaming = null;
  }
  function formatNow() {
    if (!view) return;
    const text = view.state.doc.toString();
    const next = formatLua(text);
    if (next === text) return void studio.say("info", "Already tidy.");
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head).number;
    view.dispatch({ changes: { from: 0, to: text.length, insert: next } });
    const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: target.to } });
  }
  $effect(() => {
    if (!path.endsWith(".lua")) return;
    const ok = () => !!view;
    const offs = [
      commands.register({ id: "code.definition", title: "Go to definition", menu: "Code", icon: "search", keys: ["F12"], help: "Jump to where the name under the cursor is made (Cmd or Ctrl-click does it too)", enabled: ok, run: () => void goToDefinition() }),
      commands.register({ id: "code.references", title: "Find where it is used", menu: "Code", keys: ["Shift+F12"], enabled: ok, run: () => void showReferences() }),
      commands.register({ id: "code.rename", title: "Rename a name everywhere", menu: "Code", keys: ["F2"], help: "Every use in the project changes; names inside quotes and comments do not", enabled: ok, run: startRename }),
      commands.register({ id: "code.format", title: "Tidy this file's indentation", menu: "Code", keys: ["Shift+Alt+F"], help: "Re-indents by block and trims trailing spaces", enabled: ok, run: formatNow }),
    ];
    return () => offs.forEach((off) => off());
  });

  // folding: the lines of a block (function, if, for, while, do, repeat, table) collapse to its first line
  const folds = new WeakMap<object, Map<number, number>>();
  const foldLua = foldService.of((state, lineStart) => {
    let map = folds.get(state.doc);
    if (!map) {
      map = new Map();
      for (const r of foldRanges(state.doc.toString())) if (!map.has(r.from)) map.set(r.from, r.to);
      folds.set(state.doc, map);
    }
    const startLine = state.doc.lineAt(lineStart);
    const to = map.get(startLine.number);
    if (!to || to - 1 <= startLine.number - 1 || to - 1 < startLine.number + 0) return null;
    const endLine = state.doc.line(to - 1);
    return endLine.to > startLine.to ? { from: startLine.to, to: endLine.to } : null;
  });

  function snippetSource(context: CompletionContext) {
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const line = context.state.doc.lineAt(word.from);
    const before = line.text.slice(0, word.from - line.from);
    if (/[.:]\s*$/.test(before)) return null; // after a dot it is a field, not a snippet
    const indent = /^\s*/.exec(line.text)![0];
    return {
      from: word.from,
      options: SNIPPETS.map((sn) => ({
        label: sn.label,
        detail: `snippet: ${sn.detail}`,
        type: "text",
        boost: -1,
        apply: (v: EditorView, _c: unknown, from: number, to: number) => {
          const e = expandSnippet(sn.template);
          const text = e.text.replaceAll("\n", `\n${indent}`);
          const cursor = e.cursor + (e.text.slice(0, e.cursor).split("\n").length - 1) * indent.length;
          v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursor } });
        },
      })),
      validFor: /^\w*$/,
    };
  }

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: "#c792ea" },
    { tag: [t.string, t.special(t.string)], color: "#a5d6a7" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "#f78c6c" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "#6b7385", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.standard(t.variableName)], color: "#82aaff" },
    { tag: [t.propertyName, t.attributeName], color: "#89ddff" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "#9aa5b8" },
  ]);

  const theme = EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: "13px", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--dim)", border: "none" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--text)" },
    ".cm-cursor": { borderLeftColor: "var(--text)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
    ".cm-tooltip": { backgroundColor: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", color: "var(--text)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-2)", color: "#fff" },
    ".nova-hover": { padding: "6px 10px", maxWidth: "420px" },
    ".nova-hover code": { fontFamily: "ui-monospace, Menlo, monospace", color: "var(--accent)" },
    ".nova-hover p": { margin: "4px 0 0", color: "var(--dim)" },
  });

  function source(context: CompletionContext) {
    const before = context.state.sliceDoc(0, context.pos);
    const result = complete(before, studio.symbols);
    if (!result || (!context.explicit && result.options.length === 0)) return null;
    return {
      from: result.from,
      options: result.options.map((o) => ({ label: o.label, type: o.type, detail: o.detail, info: o.info })),
      validFor: /^[\w.\/-]*$/,
    };
  }

  const hover = hoverTooltip((v, pos) => {
    const id = identifierAt(v.state.doc.toString(), pos);
    const entry = id ? lookup(id) : null;
    if (!entry) return null;
    return {
      pos,
      create() {
        const dom = document.createElement("div");
        dom.className = "nova-hover";
        const code = document.createElement("code");
        code.textContent = entry.signature;
        const p = document.createElement("p");
        p.textContent = entry.doc;
        dom.append(code, p);
        return { dom };
      },
    };
  });

  function extensions(): Extension[] {
    const isLua = path.endsWith(".lua");
    const isJson = path.endsWith(".json");
    return [
      // (breakpoints: click left of a line number; only code can have them)
      ...(isLua ? [breakpointGutter(debug.linesOf(path), (lines) => debug.setBreakpoints(path, lines))] : []),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      lintGutter(),
      syntaxHighlighting(highlight),
      tooltips({ parent: document.body }),
      theme,
      ...(isLua
        ? [
            StreamLanguage.define(lua),
            autocompletion({ override: [source, snippetSource] }),
            hover,
            foldLua,
            foldGutter(),
            EditorView.domEventHandlers({
              mousedown(e, v) {
                if (e.button !== 0 || !(e.metaKey || e.ctrlKey)) return false;
                const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
                if (pos == null) return false;
                e.preventDefault();
                v.dispatch({ selection: { anchor: pos } });
                void goToDefinition();
                return true;
              },
            }),
          ]
        : []),
      ...(isJson ? [json()] : []),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (void studio.save(path), true) },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...foldKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) studio.edit(path, u.state.doc.toString());
      }),
    ];
  }

  $effect(() => {
    // Rebuilt per file: the parent keys this component by path. Typing changes `text`, which must
    // not rebuild the editor, so only `path` is tracked here.
    const file = path;
    const created = untrack(() => editorStates.get(file) ?? EditorState.create({ doc: text, extensions: extensions() }));
    const v = new EditorView({ state: created, parent: host });
    view = v;
    return () => {
      if (studio.tabs.some((t) => t.path === file)) editorStates.set(file, v.state);
      v.destroy();
      if (view === v) view = undefined;
    };
  });

  // Underline the checker's problems for this file.
  $effect(() => {
    const problems = studio.problemsByFile().get(path) ?? [];
    if (!view) return;
    const doc = view.state.doc.toString();
    const markers = markersFor(doc, problems).map((m) => ({ from: Math.min(m.from, doc.length), to: Math.min(m.to, doc.length), severity: m.severity, message: m.message }));
    view.dispatch(setDiagnostics(view.state, markers));
  });

  // Breakpoints changed outside the editor (Remove all, another project's): show the debugger's.
  $effect(() => {
    const lines = debug.linesOf(path);
    if (!view || !path.endsWith(".lua")) return;
    const shown = breakpointLines(view.state);
    if (shown.length !== lines.length || shown.some((l, i) => l !== [...lines].sort((a, b) => a - b)[i])) {
      view.dispatch({ effects: setBreakpoints.of(lines) });
    }
  });

  // The line the game is paused at, when it is in this file.
  $effect(() => {
    const p = debug.paused;
    const frame = p?.stack.find((f) => f.depth === debug.frame);
    const line = frame && frame.file === path ? frame.line : null;
    if (!view) return;
    view.dispatch({ effects: setPausedLine.of(line) });
  });

  // Jump to a line when a problem is clicked.
  $effect(() => {
    const jump = studio.jump;
    if (!view || !jump || jump.path !== path) return;
    const line = view.state.doc.line(Math.min(Math.max(jump.line, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus();
  });
</script>

<div class="codewrap">
<div class="editor" bind:this={host}></div>
{#if results}
  <div class="results" role="dialog" aria-label={results.title}>
    <div class="head"><strong>{results.title}</strong><button class="ghost" aria-label="Close the list" onclick={() => (results = null)}>✕</button></div>
    <ul>
      {#each results.items as item (item.path + ":" + item.line + ":" + item.text)}
        <li><button onclick={() => void studio.openFile(item.path, item.line)}><span class="where">{item.path}:{item.line}</span><span class="what">{item.text}</span></button></li>
      {:else}
        <li class="none">Nothing found.</li>
      {/each}
    </ul>
  </div>
{/if}
{#if renaming}
  <form class="rename" onsubmit={(e) => { e.preventDefault(); void doRename(); }}>
    <label>Rename <code>{renaming.word}</code> to
      <input bind:value={renaming.value} aria-label="New name" onkeydown={(e) => { if (e.key === "Escape") renaming = null; }} />
    </label>
    <button class="primary">Rename</button>
    <button type="button" class="ghost" onclick={() => (renaming = null)}>Cancel</button>
    {#if renaming.error}<span class="warn">{renaming.error}</span>{/if}
  </form>
{/if}
</div>

<style>
  .codewrap { position: relative; height: 100%; min-height: 0; }
  .editor { height: 100%; min-height: 0; }
  .editor :global(.cm-editor) { height: 100%; }
  .results { position: absolute; left: 12px; right: 12px; bottom: 12px; max-height: 40%; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 28px #0007; z-index: 5; }
  .results .head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--line); }
  .results ul { list-style: none; margin: 0; padding: 4px; }
  .results li button { display: flex; gap: 12px; width: 100%; text-align: left; background: transparent; border: none; border-radius: 4px; padding: 4px 8px; color: var(--text); }
  .results li button:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .results .where { color: var(--dim); font-family: ui-monospace, Menlo, monospace; font-size: 11px; white-space: nowrap; }
  .results .what { font-family: ui-monospace, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .results .none { padding: 8px; color: var(--dim); }
  .rename { position: absolute; top: 12px; right: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; box-shadow: 0 8px 28px #0007; z-index: 5; max-width: 420px; }
  .rename input { width: 150px; }
</style>
