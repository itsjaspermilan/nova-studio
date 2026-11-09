// Recovery copies: every so often the studio keeps a copy of each document's unsaved text, so a crash, a power cut or a closed window does
// not lose work. The copies sit beside the studio's other settings (not in the project folder), per project; saving a document or closing
// its tab removes its copy. When a project opens, copies that differ from the file on disk are offered back (docs/studio-ux.md, section 5).

export interface Recovered {
  path: string;
  text: string;
  /// When the copy was made (milliseconds since 1970).
  at: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/// A project's copies hold at most this many characters in all; the oldest go first when a new one will not fit.
export const MAX_RECOVERY_CHARS = 2_500_000;

export class RecoveryStore {
  #key: string;
  #storage: Store;

  constructor(storage: Store, projectRoot: string) {
    this.#storage = storage;
    this.#key = `nova.recovery.v1:${projectRoot}`;
  }

  #read(): Record<string, Recovered> {
    try {
      const raw = this.#storage.getItem(this.#key);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {}; // unreadable: no copies
    }
  }

  #write(all: Record<string, Recovered>) {
    try {
      if (Object.keys(all).length === 0) this.#storage.removeItem(this.#key);
      else this.#storage.setItem(this.#key, JSON.stringify(all));
    } catch {
      // the storage is full or off: the studio carries on without copies
    }
  }

  list(): Recovered[] {
    return Object.values(this.#read()).sort((a, b) => a.path.localeCompare(b.path));
  }

  save(path: string, text: string, at = Date.now()): void {
    const all = this.#read();
    all[path] = { path, text, at };
    let total = Object.values(all).reduce((n, r) => n + r.text.length, 0);
    for (const old of Object.values(all).sort((a, b) => a.at - b.at)) {
      if (total <= MAX_RECOVERY_CHARS || old.path === path) continue;
      delete all[old.path];
      total -= old.text.length;
    }
    if (all[path] && all[path].text.length > MAX_RECOVERY_CHARS) delete all[path]; // too big to keep at all
    this.#write(all);
  }

  remove(path: string): void {
    const all = this.#read();
    if (!(path in all)) return;
    delete all[path];
    this.#write(all);
  }

  clear(): void {
    this.#write({});
  }
}
