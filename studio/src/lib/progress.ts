// Which lesson steps a person has ticked off, kept in the browser's storage when it works and in memory when it does not.

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "nova.help.done";

function defaultStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage can be blocked
  }
}

export class Progress {
  #done = new Set<string>();
  #store: Store | null;
  constructor(store: Store | null = defaultStore()) {
    this.#store = store;
    try {
      const raw = store?.getItem(KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(list)) for (const k of list) if (typeof k === "string") this.#done.add(k);
    } catch {
      // damaged storage: start fresh
    }
  }
  has(lesson: string, step: number) {
    return this.#done.has(`${lesson}:${step}`);
  }
  toggle(lesson: string, step: number) {
    const key = `${lesson}:${step}`;
    if (!this.#done.delete(key)) this.#done.add(key);
    try {
      this.#store?.setItem(KEY, JSON.stringify([...this.#done]));
    } catch {
      // not saved, still ticked for this session
    }
    return this.has(lesson, step);
  }
  count(lesson: string, steps: number) {
    let n = 0;
    for (let i = 0; i < steps; i++) if (this.has(lesson, i)) n++;
    return n;
  }
}
