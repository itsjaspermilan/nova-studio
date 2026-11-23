// A record of slow, self-contained tests that passed, by the hash of everything they read: the studio's own code (every file
// of mcp/ and src/lib/, the tests among them), the locked packages, Node's version, and any other file the test names (a game's
// committed sounds it must make exactly, the `nova` and `nova-ogg` programs it runs). Such a test (it draws or renders with the
// makers and reads nothing else) gives the same answer again until one of those changes, so it is skipped, with the reason in
// the report, when it already passed with exactly these inputs. Most runs are by agents working on a game or the engine, not on
// the makers: for them the makers' minutes of drawing proved nothing new.
// Any change to the studio's code runs them all again. The record is in the git-ignored target/test-cache/;
// NOVA_TEST_NO_CACHE=1 runs everything (the merger does).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "vitest";

const studio = fileURLToPath(new URL("..", import.meta.url));
const file = join(studio, "../target/test-cache/passed.json");
const off = () => !["", "0", undefined].includes(process.env.NOVA_TEST_NO_CACHE);

let inputs: string | undefined;
/// The hash of everything such a test reads (once a process).
function inputsHash(): string {
  if (inputs) return inputs;
  const h = createHash("sha256");
  h.update(process.version);
  h.update(readFileSync(join(studio, "package-lock.json")));
  for (const dir of ["mcp", "src/lib"]) {
    for (const f of readdirSync(join(studio, dir), { recursive: true }).map(String).sort()) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(studio, dir, f));
      } catch {
        continue; // (a folder)
      }
      h.update(`\0${dir}/${f}\0`);
      h.update(bytes);
    }
  }
  return (inputs = h.digest("hex"));
}

function read(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/// The hash of files and folders (every file in them) outside the studio's code that a test also reads (a game's committed files).
function filesHash(paths: string[]): string {
  const h = createHash("sha256");
  for (const p of paths) {
    let list: string[];
    try {
      list = statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map((f) => join(p, String(f))).sort() : [p];
    } catch {
      list = [p];
    }
    for (const f of list) {
      h.update(`\0${f}\0`);
      try {
        if (statSync(f).isFile()) h.update(readFileSync(f));
      } catch {
        h.update("missing");
      }
    }
  }
  return h.digest("hex");
}

/// Call first in such a test, with its context and any file or folder outside mcp/ and src/lib/ that it reads: skips the test
/// when it already passed with these inputs. Returns what to call at the test's end, once everything in it has passed.
export function unlessPassedBefore(ctx: TestContext, ...reads: string[]): () => void {
  const key = createHash("sha256").update(`${inputsHash()}\0${filesHash(reads)}\0${ctx.task.file?.name ?? ""}\0${ctx.task.name}`).digest("hex");
  if (!off() && read()[key]) ctx.skip("it passed before with the same code (mcp/, src/lib/, packages, Node): NOVA_TEST_NO_CACHE=1 runs it");
  return () => {
    if (off()) return;
    try {
      // (other test workers write too: read again, add this one, write whole and rename into place)
      const now = read();
      now[key] = new Date().toISOString();
      mkdirSync(join(file, ".."), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      writeFileSync(tmp, JSON.stringify(now));
      renameSync(tmp, file);
    } catch {
      // not written: the next run runs it again
    }
  };
}
