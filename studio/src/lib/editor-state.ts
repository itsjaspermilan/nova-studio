import type { EditorState } from "@codemirror/state";

// Per-file editor state, so undo history and the cursor survive switching tabs.
const states = new Map<string, EditorState>();

export const editorStates = {
  get: (path: string) => states.get(path),
  set: (path: string, state: EditorState) => void states.set(path, state),
  forget: (path: string) => void states.delete(path),
};
