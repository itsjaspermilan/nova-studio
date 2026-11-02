<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, type Extension } from "@codemirror/state";
  import { editorStates } from "../lib/editor-state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip, tooltips } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
  import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from "@codemirror/language";
  import { lua } from "@codemirror/legacy-modes/mode/lua";
  import { json } from "@codemirror/lang-json";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import { lintGutter, setDiagnostics } from "@codemirror/lint";
  import { tags as t } from "@lezer/highlight";
  import { complete, identifierAt, lookup } from "../lib/completions";
  import { markersFor } from "../lib/diagnostics";
  import { studio } from "../lib/store.svelte";

  let { path, text }: { path: string; text: string } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

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
      ...(isLua ? [StreamLanguage.define(lua), autocompletion({ override: [source] }), hover] : []),
      ...(isJson ? [json()] : []),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (void studio.save(path), true) },
        ...closeBracketsKeymap,
        ...completionKeymap,
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

  // Jump to a line when a problem is clicked.
  $effect(() => {
    const jump = studio.jump;
    if (!view || !jump || jump.path !== path) return;
    const line = view.state.doc.line(Math.min(Math.max(jump.line, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus();
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor { height: 100%; min-height: 0; }
  .editor :global(.cm-editor) { height: 100%; }
</style>
