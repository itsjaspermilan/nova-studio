// Each workspace keeps its own layout: whether the project tree and the bottom panel are shown, and (through lib/resize.ts, under a key
// that names the workspace) how wide and tall they are. Remembered between runs; "Reset layout" puts the workspace's layout back to its default.

import { forgetSize } from "./resize";
import type { WorkspaceId } from "./workspaces";

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

export class Layout {
  #saved: Partial<Record<WorkspaceId, Partial<PanelState>>> = $state({});
  #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) this.#saved = JSON.parse(raw);
    } catch {
      this.#saved = {}; // not remembered or unreadable: the defaults
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
