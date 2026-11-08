// The code editor's breakpoint gutter and the paused line (CodeMirror). Breakpoints move with the lines as you type, and
// the editor tells the debugger their new line numbers (`onLines`).

import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

class BreakMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-breakpoint";
    dot.title = "Breakpoint: the game stops here (click to remove)";
    return dot;
  }
}
const marker = new BreakMarker();

/// Replaces the breakpoints with these line numbers.
export const setBreakpoints = StateEffect.define<number[]>();
const toggleAt = StateEffect.define<number>();
/// The line the game is paused at (null: not paused here).
export const setPausedLine = StateEffect.define<number | null>();

function lineSet(state: EditorState, lines: number[]): RangeSet<GutterMarker> {
  const ranges = [...new Set(lines)]
    .filter((l) => l >= 1 && l <= state.doc.lines)
    .sort((a, b) => a - b)
    .map((l) => marker.range(state.doc.line(l).from));
  return RangeSet.of(ranges);
}

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpoints)) set = lineSet(tr.state, e.value);
      if (e.is(toggleAt)) {
        let has = false;
        set.between(e.value, e.value, () => {
          has = true;
        });
        set = has ? set.update({ filter: (from) => from !== e.value }) : set.update({ add: [marker.range(e.value)] });
      }
    }
    return set;
  },
});

/// The breakpoints' line numbers in this state.
export function breakpointLines(state: EditorState): number[] {
  const out: number[] = [];
  const cursor = state.field(breakpointField).iter();
  for (; cursor.value; cursor.next()) out.push(state.doc.lineAt(cursor.from).number);
  return [...new Set(out)];
}

const pausedDeco = Decoration.line({ class: "cm-paused-line" });
const pausedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPausedLine)) {
        deco = e.value && e.value <= tr.state.doc.lines ? Decoration.set([pausedDeco.range(tr.state.doc.line(e.value).from)]) : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/// The gutter to click in, and the paused line. `onLines` hears the breakpoints' lines whenever they change.
export function breakpointGutter(initial: number[], onLines: (lines: number[]) => void): Extension {
  return [
    breakpointField.init((state) => lineSet(state, initial)),
    pausedField,
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (v) => v.state.field(breakpointField),
      initialSpacer: () => marker,
      domEventHandlers: {
        mousedown(view, line) {
          view.dispatch({ effects: toggleAt.of(line.from) });
          return true;
        },
      },
    }),
    EditorView.updateListener.of((u) => {
      const before = u.startState.field(breakpointField);
      const after = u.state.field(breakpointField);
      if (before !== after) onLines(breakpointLines(u.state));
    }),
    EditorView.baseTheme({
      ".cm-breakpoint-gutter": { width: "14px", cursor: "pointer" },
      ".cm-breakpoint-gutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center" },
      ".cm-breakpoint": { display: "inline-block", width: "9px", height: "9px", borderRadius: "50%", background: "#e5484d" },
      ".cm-paused-line": { backgroundColor: "color-mix(in srgb, #e6b450 22%, transparent) !important", outline: "1px solid color-mix(in srgb, #e6b450 55%, transparent)" },
    }),
  ];
}
