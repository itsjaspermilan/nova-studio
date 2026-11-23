// Which `nova` (and `nova-ogg`) the tools run. NOVA_BIN / NOVA_OGG_BIN choose; otherwise this checkout's target/release;
// otherwise, in a git worktree that has not built its own, the main checkout's, but only when it is safe: the worktree's
// engine sources are byte for byte the ones that binary was built from. The rule is scripts/lib/worktree.sh's (one copy,
// shared with scripts/nova-mcp.sh); it says each choice in one line on stderr.
import { spawnSync } from "node:child_process";
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const INPUTS: Record<string, string> = { nova: "NOVA_RUNTIME_INPUTS", "nova-ogg": "NOVA_OGG_INPUTS" };
const ENV: Record<string, string> = { nova: "NOVA_BIN", "nova-ogg": "NOVA_OGG_BIN" };

/// The main checkout's binary, once asked about: every caller in one module graph (a test file and the server it calls) gets
/// the same answer. The main checkout changes under a worktree while other agents merge and build there, so two separate
/// asks a moment apart could disagree: a test that saw a binary while the server it calls found none (and failed), or the
/// other way round.
const picked = new Map<string, string>();

/// The binary to run for `name` ("nova" or "nova-ogg"), or this checkout's target/release path when none is found (the tools
/// then say it is not built and what to run).
export function releaseBinary(repo: string, name: "nova" | "nova-ogg", helper = join(repo, "scripts/lib/worktree.sh")): string {
  const chosen = process.env[ENV[name]!];
  if (chosen) return chosen;
  const own = join(repo, "target/release", name);
  if (existsSync(own)) return own;
  if (!existsSync(helper)) return own;
  const key = `${repo}\n${name}\n${helper}`;
  const before = picked.get(key);
  if (before !== undefined) return before;
  const r = spawnSync("bash", ["-c", `. "$1"; nova_pick_bin "$2" "$3" "$${INPUTS[name]}"`, "bash", helper, repo, name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 20_000,
  });
  const found = (r.stdout ?? "").trim();
  const bin = found && existsSync(found) ? found : own;
  picked.set(key, bin);
  return bin;
}

/// The binary to spawn for a whole test run: while vitest runs (VITEST), a private copy-on-write snapshot of `path`, so that a
/// `cargo build --release` of the same binary meanwhile (by this agent, or by another in the main checkout, whose binary a
/// worktree may borrow) can neither take it away for a moment nor swap in one built from other sources half way through
/// the run. Outside the tests (the studio's MCP server) the path itself, so a rebuilt binary is used from the next call.
/// Snapshots live in the temporary folder, one per binary build (named by its inode, time and size); a day-old one is removed.
export function stableBinary(path: string): string {
  if (!process.env.VITEST || !existsSync(path)) return path;
  try {
    const s = statSync(path);
    const root = join(tmpdir(), "nova-test-binaries");
    const dir = join(root, `${basename(path)}-${s.dev}-${s.ino}-${Math.round(s.mtimeMs)}-${s.size}`);
    const snap = join(dir, basename(path));
    if (existsSync(snap)) return snap;
    mkdirSync(root, { recursive: true });
    for (const old of readdirSync(root)) {
      const at = join(root, old);
      if (Date.now() - statSync(at).mtimeMs > 24 * 3600_000) rmSync(at, { recursive: true, force: true });
    }
    // (made in a folder of its own and renamed into place: several test workers may make the same one at once)
    const tmp = `${dir}.${process.pid}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    copyFileSync(path, join(tmp, basename(path)), constants.COPYFILE_FICLONE);
    // (`nova export desktop` reads the notices beside the program)
    const notices = join(dirname(path), "THIRD-PARTY.txt");
    if (existsSync(notices)) copyFileSync(notices, join(tmp, "THIRD-PARTY.txt"), constants.COPYFILE_FICLONE);
    const after = statSync(path);
    if (after.ino !== s.ino || after.mtimeMs !== s.mtimeMs || after.size !== s.size || statSync(join(tmp, basename(path))).size !== s.size) {
      rmSync(tmp, { recursive: true, force: true });
      return path; // (it was being rebuilt while copied: use it as it is)
    }
    chmodSync(join(tmp, basename(path)), 0o755);
    try {
      renameSync(tmp, dir);
    } catch {
      rmSync(tmp, { recursive: true, force: true }); // (another worker made it first)
    }
    return existsSync(snap) ? snap : path;
  } catch {
    return path;
  }
}
