// A fresh git worktree uses the main checkout's node_modules and release build (scripts/lib/worktree.sh), the binary only
// when the worktree's engine sources are the ones it was built from, and never writes into the main checkout.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseBinary, stableBinary } from "./binaries";

const helper = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/lib/worktree.sh");
let top = "";
let main = "";
let tree = "";
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const sh = (fn: string, ...args: string[]) => {
  const r = spawnSync("bash", ["-c", `. "$0"; ${fn} "$@"`, helper, ...args], { encoding: "utf8" });
  return { out: r.stdout.trim(), err: r.stderr.trim() };
};
const pick = () => sh(`f() { nova_pick_bin "$1" nova "$NOVA_RUNTIME_INPUTS"; }; f`, tree);
const listing = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

beforeAll(() => {
  top = realpathSync(mkdtempSync(join(tmpdir(), "nova-worktree-")));
  main = join(top, "main");
  put(join(main, "crates/nova-runtime/src/lib.rs"), "fn a() {}\n");
  put(join(main, "Cargo.toml"), "[workspace]\n");
  put(join(main, "studio/package-lock.json"), "{}\n");
  put(join(main, ".gitignore"), "/target\nnode_modules\n");
  git(top, "init", "-q", "-b", "main", main);
  git(main, "add", ".");
  git(main, "commit", "-qm", "one");
  put(join(main, "studio/node_modules/.bin/tool"), "#!/bin/sh\n");
  put(join(main, "target/release/nova"), "#!/bin/sh\necho main\n");
  chmodSync(join(main, "target/release/nova"), 0o755);
  // the binary is newer than the sources it was built from
  const later = new Date(Date.now() + 5000);
  utimesSync(join(main, "target/release/nova"), later, later);
  tree = join(main, ".claude/worktrees/agent-x");
  git(main, "worktree", "add", "-q", "-b", "agent-x", tree);
});
afterAll(() => rmSync(top, { recursive: true, force: true }));

describe("a fresh git worktree", () => {
  it("finds the main checkout", () => {
    expect(sh("nova_main_checkout", tree).out).toBe(main);
    expect(sh("nova_main_checkout", main).out).toBe("");
  });

  it("uses the main checkout's binary when its engine sources are the same, and says so", () => {
    const r = pick();
    expect(r.out).toBe(join(main, "target/release/nova"));
    expect(r.err).toMatch(/^worktree: using the main checkout's nova/);
    expect(releaseBinary(tree, "nova", helper)).toBe(join(main, "target/release/nova"));
  });

  it("refuses it when the worktree's engine sources changed, and says what to build", () => {
    put(join(tree, "crates/nova-runtime/src/lib.rs"), "fn b() {}\n");
    const r = pick();
    expect(r.out).toBe("");
    expect(r.err).toMatch(/not using the main checkout's nova: this worktree's engine sources differ .* cargo build --release -p nova-runtime --bin nova\s+\(about 4 minutes/);
    // one run asks once: a test and the server it calls agree on the binary, however the main checkout changes meanwhile
    expect(releaseBinary(tree, "nova", helper)).toBe(join(main, "target/release/nova"));
    git(tree, "checkout", "--", ".");
    put(join(tree, "crates/nova-runtime/src/new.rs"), "\n");
    expect(pick().err).toMatch(/new engine source files/);
    rmSync(join(tree, "crates/nova-runtime/src/new.rs"));
    expect(pick().out).toBe(join(main, "target/release/nova"));
  });

  it("refuses a binary older than the main checkout's sources, or built from uncommitted changes", () => {
    const src = join(main, "crates/nova-runtime/src/lib.rs");
    const later = new Date(Date.now() + 60_000);
    utimesSync(src, later, later);
    expect(pick().err).toMatch(/older than its sources \(crates\/nova-runtime\/src\/lib.rs\)/);
    put(src, "fn c() {}\n");
    expect(pick().err).toMatch(/main checkout has uncommitted changes/);
    git(main, "checkout", "--", ".");
    const now = new Date();
    utimesSync(src, now, now);
  });

  it("prefers the worktree's own build, and NOVA_BIN over both", () => {
    put(join(tree, "target/release/nova"), "#!/bin/sh\n");
    chmodSync(join(tree, "target/release/nova"), 0o755);
    expect(pick().out).toBe(join(tree, "target/release/nova"));
    process.env.NOVA_BIN = "/somewhere/nova";
    try {
      expect(releaseBinary(tree, "nova", helper)).toBe("/somewhere/nova");
    } finally {
      delete process.env.NOVA_BIN;
    }
    rmSync(join(tree, "target"), { recursive: true });
  });

  it("keeps a test run on its own copy of the binary while it is rebuilt", () => {
    const bin = join(top, "built/nova");
    const build = (says: string, at: number) => {
      rmSync(bin, { force: true }); // (cargo puts a new file in its place)
      put(bin, `#!/bin/sh\necho ${says}\n`);
      chmodSync(bin, 0o755);
      utimesSync(bin, new Date(at), new Date(at));
    };
    build("one", Date.now() - 1000);
    const snap = stableBinary(bin);
    expect(snap).not.toBe(bin);
    expect(stableBinary(bin)).toBe(snap);
    expect(execFileSync(snap, { encoding: "utf8" })).toBe("one\n");
    build("two", Date.now());
    expect(execFileSync(snap, { encoding: "utf8" })).toBe("one\n");
    const next = stableBinary(bin);
    expect(next).not.toBe(snap);
    expect(execFileSync(next, { encoding: "utf8" })).toBe("two\n");
    // outside the tests the path itself, so the studio's server takes up a new build at once
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(stableBinary(bin)).toBe(bin);
    } finally {
      process.env.VITEST = vitest;
    }
  });

  it("clones node_modules into the worktree without touching the main checkout, and git ignores the clone", () => {
    const before = listing(join(main, "studio/node_modules"));
    expect(sh("nova_node_modules", tree).out).toBe(join(main, "studio/node_modules"));
    const r = sh("nova_clone_node_modules", tree);
    expect(r.err).toMatch(/cloned the main checkout's/);
    expect(existsSync(join(tree, "studio/node_modules/.bin/tool"))).toBe(true);
    writeFileSync(join(tree, "studio/node_modules/.bin/tool"), "changed\n");
    expect(listing(join(main, "studio/node_modules"))).toEqual(before);
    expect(execFileSync("cat", [join(main, "studio/node_modules/.bin/tool")], { encoding: "utf8" })).toBe("#!/bin/sh\n");
    expect(git(tree, "status", "--porcelain")).toBe("");
  });

  it("does not clone node_modules that would not fit the worktree's lock file", () => {
    rmSync(join(tree, "studio/node_modules"), { recursive: true });
    put(join(tree, "studio/package-lock.json"), '{"changed": true}\n');
    expect(sh("nova_clone_node_modules", tree).err).toMatch(/package-lock.json differs/);
    expect(existsSync(join(tree, "studio/node_modules"))).toBe(false);
    git(tree, "checkout", "--", ".");
  });
});
