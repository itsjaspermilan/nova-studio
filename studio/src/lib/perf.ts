// What the running game says about its speed: the runtime writes a line every second
//   fps=59.9 p95=17.1ms max=21.0ms upd=0.40ms lua=0.31ms render=1.20ms gpu=3.40ms draws=120 sprites=0 tris=88000 culled=12
// and `nova.hitch(ms)` writes `hitch: 31.2 ms (scene race; gpu 4.0 ms, 130 draws, lua 0.50 ms)` for each slow frame.

export interface PerfSample {
  fps: number;
  p95: number;
  max: number;
  update: number;
  lua: number;
  render: number;
  gpu: number;
  draws: number;
  triangles: number;
  sprites: number;
}

export interface Hitch {
  /// How long the frame took.
  ms: number;
  /// Everything else the line said (the scene, GPU time, draws, anything the game described).
  detail: string;
  /// When it was noticed, in seconds since the run began.
  at: number;
}

const number = (line: string, key: string): number | null => {
  const m = new RegExp(`(?:^|[\\s\\]])${key}=(-?[0-9.]+)`).exec(line);
  return m ? Number(m[1]) : null;
};

export function parsePerfLine(line: string): PerfSample | null {
  const fps = number(line, "fps");
  if (fps === null || number(line, "draws") === null) return null;
  return {
    fps,
    p95: number(line, "p95") ?? 0,
    max: number(line, "max") ?? 0,
    update: number(line, "upd") ?? 0,
    lua: number(line, "lua") ?? 0,
    render: number(line, "render") ?? 0,
    gpu: number(line, "gpu") ?? 0,
    draws: number(line, "draws") ?? 0,
    triangles: number(line, "tris") ?? 0,
    sprites: number(line, "sprites") ?? 0,
  };
}

export function parseHitchLine(line: string, at = 0): Hitch | null {
  const m = /hitch: ([0-9.]+) ms\s*(.*)$/.exec(line);
  if (!m) return null;
  // "(scene race; gpu 4.0 ms, ...) what the game said": the brackets go, and what follows is joined on
  const rest = /^\(([^)]*)\)\s*(.*)$/.exec(m[2]!.trim());
  const detail = rest ? [rest[1], rest[2]].filter(Boolean).join(" · ") : m[2]!.trim();
  return { ms: Number(m[1]), detail, at };
}

export const HISTORY = 60;
export const MAX_HITCHES = 30;

/// Keeps the latest numbers, the last minute of them for a graph and the recent hitches.
export class PerfTracker {
  latest: PerfSample | null = null;
  history: PerfSample[] = [];
  hitches: Hitch[] = [];
  /// The worst frame seen in the run so far.
  worst = 0;
  #started = Date.now();

  constructor(private readonly now: () => number = Date.now) {
    this.#started = now();
  }

  /// Reads one line of the game's output; returns whether it was about speed.
  feed(line: string): boolean {
    const sample = parsePerfLine(line);
    if (sample) {
      this.latest = sample;
      this.history = [...this.history.slice(-(HISTORY - 1)), sample];
      this.worst = Math.max(this.worst, sample.max);
      return true;
    }
    const hitch = parseHitchLine(line, (this.now() - this.#started) / 1000);
    if (hitch) {
      this.hitches = [hitch, ...this.hitches].slice(0, MAX_HITCHES);
      this.worst = Math.max(this.worst, hitch.ms);
      return true;
    }
    return false;
  }
}

/// How the frame rate looks to a beginner: good (at 55 or more), ok or slow.
export function health(s: PerfSample | null): "none" | "good" | "ok" | "slow" {
  if (!s) return "none";
  return s.fps >= 55 ? "good" : s.fps >= 30 ? "ok" : "slow";
}
