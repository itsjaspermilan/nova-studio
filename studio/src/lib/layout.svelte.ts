// Each workspace keeps its own layout: whether the project tree and the bottom panel are shown, and (through lib/resize.ts, under a key
// that names the workspace) how wide and tall they are. Remembered between runs; "Reset layout" puts the workspace's layout back to its default.

import { forgetSize, rememberSize, savedSize } from "./resize";
import { WORKSPACE_IDS, type WorkspaceId } from "./workspaces";

export interface PanelState {
  treeOpen: boolean;
  panelOpen: boolean;
}

/// The default layouts: code and games want the problems and play panel; the art and sound workspaces start with just the tree.
export const DEFAULT_LAYOUT: Record<WorkspaceId, PanelState> = {
  engine: { treeOpen: true, panelOpen: true },
  model: { treeOpen: true, panelOpen: false },
  sprites: { treeOpen: true, panelOpen: false },
  sound: { treeOpen: true, panelOpen: false },
};

const STORE = "nova.layout.v1";
const NAMED = "nova.layouts.v1";
export const MAX_NAMED = 12;

/// A saved arrangement of the whole studio: for every workspace which panels are shown and how big the tree and the bottom panel are (null: the usual size).
export interface NamedLayout {
  workspaces: Record<WorkspaceId, PanelState & { treeSize: number | null; bottomSize: number | null }>;
}

export class Layout {
  #saved: Partial<Record<WorkspaceId, Partial<PanelState>>> = $state({});
  #storage: Pick<Storage, "getItem" | "setItem">;
  #named: Record<string, NamedLayout> = $state({});

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) this.#saved = JSON.parse(raw);
    } catch {
      this.#saved = {}; // not remembered or unreadable: the defaults
    }
    try {
      const raw = this.#storage.getItem(NAMED);
      if (raw) this.#named = cleanNamed(JSON.parse(raw));
    } catch {
      this.#named = {};
    }
  }

  get(id: WorkspaceId): PanelState {
    return { ...DEFAULT_LAYOUT[id], ...this.#saved[id] };
  }

  set(id: WorkspaceId, patch: Partial<PanelState>): void {
    this.#saved = { ...this.#saved, [id]: { ...this.#saved[id], ...patch } };
    this.#persist();
  }

  /// This workspace's layout back to the default: panels shown or hidden as first, and the usual sizes.
  reset(id: WorkspaceId): void {
    const { [id]: _gone, ...rest } = this.#saved;
    this.#saved = rest;
    forgetSize(sizeKey("tree", id));
    forgetSize(sizeKey("bottom", id));
    this.#persist();
  }

  /// The names of the saved layouts, in the order they were made.
  get names(): string[] {
    return Object.keys(this.#named);
  }

  /// Keeps how the studio is arranged now under a name (a name already used is replaced; at most MAX_NAMED). Returns false when there is no room or the name is empty.
  saveAs(name: string): boolean {
    const n = name.trim().slice(0, 40);
    if (!n || (!(n in this.#named) && this.names.length >= MAX_NAMED)) return false;
    const workspaces = Object.fromEntries(
      WORKSPACE_IDS.map((id) => [id, { ...this.get(id), treeSize: savedSize(sizeKey("tree", id)), bottomSize: savedSize(sizeKey("bottom", id)) }]),
    ) as NamedLayout["workspaces"];
    this.#named = { ...this.#named, [n]: { workspaces } };
    this.#persistNamed();
    return true;
  }

  /// Arranges the studio as a saved layout says. Panel sizes are read when a panel is drawn, so they show once the panel is next shown. False for an unknown name.
  apply(name: string): boolean {
    const l = this.#named[name];
    if (!l) return false;
    for (const id of WORKSPACE_IDS) {
      const w = l.workspaces[id];
      this.#saved = { ...this.#saved, [id]: { treeOpen: w.treeOpen, panelOpen: w.panelOpen } };
      rememberSize(sizeKey("tree", id), w.treeSize);
      rememberSize(sizeKey("bottom", id), w.bottomSize);
    }
    this.#persist();
    return true;
  }

  removeNamed(name: string): void {
    const { [name]: _gone, ...rest } = this.#named;
    this.#named = rest;
    this.#persistNamed();
  }

  #persistNamed() {
    try {
      this.#storage.setItem(NAMED, JSON.stringify(this.#named));
    } catch {
      // not remembered
    }
  }

  #persist() {
    try {
      this.#storage.setItem(STORE, JSON.stringify(this.#saved));
    } catch {
      // not remembered
    }
  }
}

/// The key a panel's size is remembered under in one workspace.
export const sizeKey = (panel: "tree" | "bottom", id: WorkspaceId) => `${panel}.${id}`;

export const layout = new Layout();

/// Keeps only well-formed saved layouts from what was read.
function cleanNamed(raw: unknown): Record<string, NamedLayout> {
  const out: Record<string, NamedLayout> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, v] of Object.entries(raw as Record<string, NamedLayout>)) {
    const ws = v?.workspaces;
    if (!ws || !WORKSPACE_IDS.every((id) => typeof ws[id]?.treeOpen === "boolean" && typeof ws[id]?.panelOpen === "boolean")) continue;
    const size = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);
    out[name] = { workspaces: Object.fromEntries(WORKSPACE_IDS.map((id) => [id, { treeOpen: ws[id].treeOpen, panelOpen: ws[id].panelOpen, treeSize: size(ws[id].treeSize), bottomSize: size(ws[id].bottomSize) }])) as NamedLayout["workspaces"] };
    if (Object.keys(out).length >= MAX_NAMED) break;
  }
  return out;
}
