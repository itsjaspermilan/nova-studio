// The Rust test runner behind scripts/test.sh: builds every test of the workspace once (cargo test --no-run), then runs the
// test binaries side by side instead of one after another as `cargo test` does, the slowest first, each into a log of its own.
//
//   node scripts/lib/test-runner.mjs quick            everything except the long tests
//   node scripts/lib/test-runner.mjs all              everything, the long tests too (each in a process of its own, started first)
//   node scripts/lib/test-runner.mjs one <name>       the tests whose names contain <name> (a long one too), or one test file's
//                                                     tests when <name> is a file's name (mountain_post)
//
// A long test is one marked `#[ignore = "long: ..."]` in a file under crates/*/tests/ (plain `cargo test` skips it as well).
// Other ignored tests (measurements, a device) are never run here. The times of the last run are kept in
// target/nova-test-times.json (to start the slowest first) and each job's whole output in target/nova-test-logs/.
// Options: --jobs N (test binaries at once; NOVA_TEST_JOBS), -p <package> (only that package's tests).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith("-") ? args.shift() : "quick";
if (!["quick", "all", "one"].includes(mode)) usage(`unknown mode '${mode}'`);
const filter = mode === "one" ? args.shift() : undefined;
if (mode === "one" && !filter) usage("one needs a test's name (or a part of it, or a test file's name)");
let jobs = Number(process.env.NOVA_TEST_JOBS) || Math.max(2, Math.round(cpus().length / 3));
const packages = [];
while (args.length) {
  const a = args.shift();
  if (a === "--jobs" || a === "-j") jobs = Number(args.shift());
  else if (a === "-p" || a === "--package") packages.push(args.shift());
  else usage(`unknown option '${a}'`);
}
if (!(jobs >= 1)) usage("--jobs is a number from 1");

function usage(why) {
  console.error(`test.sh: ${why}\nusage: scripts/test.sh [quick|all|one <name>] [--jobs N] [-p package]`);
  process.exit(2);
}

const target = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(repo, "target");
const logs = join(target, "nova-test-logs");
const timesFile = join(target, "nova-test-times.json");

// ---- build ---------------------------------------------------------------------------------------------------------
const scope = packages.length ? packages.flatMap((p) => ["-p", p]) : ["--workspace"];
const started = Date.now();
process.stderr.write(`building the tests (cargo test ${scope.join(" ")} --no-run)...\n`);
const build = spawnSync("cargo", ["test", ...scope, "--no-run", "--message-format=json-render-diagnostics"], {
  cwd: repo,
  encoding: "utf8",
  maxBuffer: 256 << 20,
  stdio: ["ignore", "pipe", "inherit"],
});
if (build.status !== 0) {
  console.error("test.sh: the tests do not build (above)");
  process.exit(1);
}
const binaries = [];
for (const line of build.stdout.split("\n")) {
  if (!line.startsWith("{")) continue;
  const m = JSON.parse(line);
  if (m.reason !== "compiler-artifact" || !m.profile?.test || !m.executable) continue;
  const kind = m.target.kind[0];
  // (a package's own unit tests are named after the package; an integration test file after itself)
  // (package_id is "path+file:///.../src-tauri#nova-studio@0.1.0", or ".../nova-runtime#0.1.0" when the folder has its name)
  const [where, which = ""] = m.package_id.split("#");
  const pkg = which.includes("@") ? which.split("@")[0] : basename(where);
  const name = kind === "test" ? m.target.name : `${pkg} (${kind} ${m.target.name})`;
  binaries.push({ name, kind, target: m.target.name, exe: m.executable, cwd: dirname(m.manifest_path), src: m.target.src_path });
}
const buildSecs = (Date.now() - started) / 1000;
process.stderr.write(`built in ${buildSecs.toFixed(1)} s: ${binaries.length} test binaries\n`);

// ---- the long tests ------------------------------------------------------------------------------------------------
/// `#[ignore = "long: ..."]` followed by its `fn`, in each integration test file.
function longTests(file) {
  const out = [];
  const text = readFileSync(file, "utf8");
  const re = /#\[ignore\s*=\s*"long:[^"]*"\]\s*(?:#\[[^\]]*\]\s*)*fn\s+(\w+)/g;
  for (let m; (m = re.exec(text)); ) out.push(m[1]);
  return out;
}
const long = [];
for (const b of binaries) if (b.kind === "test" && existsSync(b.src)) for (const t of longTests(b.src)) long.push({ bin: b, test: t });

// ---- what to run ---------------------------------------------------------------------------------------------------
let times = {};
try {
  times = JSON.parse(readFileSync(timesFile, "utf8"));
} catch {
  // first run: no times yet
}
const todo = [];
const job = (name, bin, argv) => todo.push({ name, bin, argv });
if (mode === "one") {
  const file = binaries.find((b) => b.target === filter && b.kind === "test");
  if (file) {
    job(file.name, file, []);
    for (const l of long.filter((l) => l.bin === file)) job(`${file.name}::${l.test}`, file, ["--ignored", "--exact", l.test]);
  } else {
    for (const b of binaries) job(b.name, b, [filter]);
    for (const l of long.filter((l) => l.test.includes(filter))) job(`${l.bin.name}::${l.test}`, l.bin, ["--ignored", "--exact", l.test]);
  }
} else {
  if (mode === "all") for (const l of long) job(`${l.bin.name}::${l.test}`, l.bin, ["--ignored", "--exact", l.test]);
  for (const b of binaries) job(b.name, b, []);
  job("doc tests", null, []);
}
// the slowest first (long tests, then by the last run's time; one never timed counts as slow)
const rank = (j) => (j.argv.includes("--ignored") ? 1e6 : 0) + (times[j.name] ?? 100);
todo.sort((a, b) => rank(b) - rank(a));

// ---- run -----------------------------------------------------------------------------------------------------------
mkdirSync(logs, { recursive: true });
const results = [];
const env = {
  ...process.env,
  DYLD_FALLBACK_LIBRARY_PATH: [join(target, "debug/deps"), join(target, "debug"), process.env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(":"),
};
function run(j) {
  return new Promise((done) => {
    const t0 = Date.now();
    const file = join(logs, `${j.name.replace(/[^\w.-]+/g, "_")}.log`);
    const child = j.bin
      ? spawn(j.bin.exe, [...j.argv, "-q"], { cwd: j.bin.cwd, env: { ...env, CARGO_MANIFEST_DIR: j.bin.cwd } })
      : spawn("cargo", ["test", ...scope, "--doc", "-q"], { cwd: repo, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code, signal) => {
      const secs = (Date.now() - t0) / 1000;
      writeFileSync(file, out);
      const summary = [...out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
      const passed = summary.reduce((s, m) => s + Number(m[1]), 0);
      const failed = summary.reduce((s, m) => s + Number(m[2]), 0);
      const ok = code === 0;
      const r = { ...j, secs, ok, passed, failed, file, out, signal };
      results.push(r);
      if (!(mode === "one" && ok && passed === 0)) {
        console.log(`${ok ? "ok    " : "FAILED"} ${secs.toFixed(1).padStart(6)} s  ${j.name}${passed || failed ? `  (${passed} passed${failed ? `, ${failed} failed` : ""})` : ""}${signal ? `  [${signal}]` : ""}`);
      }
      done();
    });
  });
}
const runStart = Date.now();
// a long test runs on one thread: they all start at once, beside the `jobs` binaries (which use every core between them)
const single = todo.filter((j) => j.argv.includes("--exact"));
const queue = todo.filter((j) => !single.includes(j));
await Promise.all([
  ...single.map(run),
  ...Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }),
]);
const runSecs = (Date.now() - runStart) / 1000;

// ---- report --------------------------------------------------------------------------------------------------------
if (mode !== "one") {
  for (const r of results) if (r.ok) times[r.name] = Math.round(r.secs * 10) / 10;
  writeFileSync(timesFile, JSON.stringify(times, null, 1));
}
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  const at = r.out.indexOf("\nfailures:");
  console.log(`\n==== ${r.name} (whole output: ${r.file})\n${at >= 0 ? r.out.slice(at + 1) : r.out.slice(-6000)}`);
}
const passed = results.reduce((s, r) => s + r.passed, 0);
if (mode === "one" && passed === 0 && !failed.length) {
  console.log(`no test is named like '${filter}' (a long test is found by its name too; a test file by its name: mountain_post)`);
  process.exit(1);
}
const skipped = mode === "quick" && long.length ? `; ${long.length} long tests left out (scripts/test.sh all runs them)` : "";
console.log(
  `\n${failed.length ? `FAILED: ${failed.map((r) => r.name).join(", ")}` : "all passed"}: ${passed} tests in ${runSecs.toFixed(1)} s (build ${buildSecs.toFixed(1)} s, ${jobs} at once${skipped})`,
);
process.exit(failed.length ? 1 : 0);
