// Calls Nova's tools for the recipes in this folder (scripts/nova-tool, the MCP server's tools from a shell). Run every recipe from the
// repository's root: scripts/env.sh node examples/mountain-post/tools/<recipe>.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GAME = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(GAME, "../..");
const ARGS = join(GAME, "build", "tool-args");

let calls = 0;
/// Runs one tool with its arguments; returns its text answer (and throws with the answer when it fails).
export function tool(name, args, { quiet = false } = {}) {
  mkdirSync(ARGS, { recursive: true });
  const file = join(ARGS, `${name}-${++calls}.json`);
  writeFileSync(file, JSON.stringify(args));
  let out;
  try {
    out = execFileSync(join(REPO, "scripts/nova-tool"), ["--project", GAME, name, `@${file}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`${name} failed:\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
  }
  const text = out.split("\n").filter((l) => !/^worktree:|rolldown|nova-mcp\.mjs|^\s*$/.test(l)).join("\n");
  if (/^ERROR|Error:/m.test(text)) throw new Error(`${name}: ${text}`);
  if (!quiet) console.log(`--- ${name} ${args.name ?? ""}\n${text.split("\n").slice(0, 6).join("\n")}`);
  return text;
}

/// Writes a file into the game (a scene, a data file) from a recipe.
export function put(rel, text) {
  const file = join(GAME, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export const r2 = (v) => Math.round(v * 100) / 100;
