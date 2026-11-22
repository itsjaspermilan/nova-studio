// Which `nova` (and `nova-ogg`) the tools run. NOVA_BIN / NOVA_OGG_BIN choose; otherwise this checkout's target/release;
// otherwise, in a git worktree that has not built its own, the main checkout's, but only when it is safe: the worktree's
// engine sources are byte for byte the ones that binary was built from. The rule is scripts/lib/worktree.sh's (one copy,
// shared with scripts/nova-mcp.sh); it says each choice in one line on stderr.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const INPUTS: Record<string, string> = { nova: "NOVA_RUNTIME_INPUTS", "nova-ogg": "NOVA_OGG_INPUTS" };
const ENV: Record<string, string> = { nova: "NOVA_BIN", "nova-ogg": "NOVA_OGG_BIN" };

/// The binary to run for `name` ("nova" or "nova-ogg"), or this checkout's target/release path when none is found (the tools
/// then say it is not built and what to run).
export function releaseBinary(repo: string, name: "nova" | "nova-ogg", helper = join(repo, "scripts/lib/worktree.sh")): string {
  const chosen = process.env[ENV[name]!];
  if (chosen) return chosen;
  const own = join(repo, "target/release", name);
  if (existsSync(own)) return own;
  if (!existsSync(helper)) return own;
  const r = spawnSync("bash", ["-c", `. "$1"; nova_pick_bin "$2" "$3" "$${INPUTS[name]}"`, "bash", helper, repo, name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 20_000,
  });
  const found = (r.stdout ?? "").trim();
  return found && existsSync(found) ? found : own;
}
