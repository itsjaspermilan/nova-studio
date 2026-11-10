// Lists the licences of everything the studio and the runtime depend on (Rust crates from `cargo metadata`, npm packages from studio/node_modules)
// and writes licenses/third-party.md. It also says which are not plainly permissive, so that a person decides before they are shipped.
// Run:  scripts/env.sh node scripts/third-party-licenses.mjs        (offline: it reads what is already downloaded)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--offline"], { cwd: root, maxBuffer: 1 << 28 }).toString());
const members = new Set(meta.workspace_members);
const byId = new Map(meta.packages.map((p) => [p.id, p]));

// normal and build dependencies reachable from the workspace members (dev-only dependencies are not shipped)
const keep = new Set();
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const visit = (id) => {
  if (keep.has(id)) return;
  keep.add(id);
  for (const d of nodes.get(id)?.deps ?? []) if (d.dep_kinds.some((k) => k.kind !== "dev")) visit(d.pkg);
};
for (const id of members) visit(id);

const rust = [...keep].filter((id) => !members.has(id)).map((id) => byId.get(id)).map((p) => ({ name: p.name, version: p.version, license: p.license ?? (p.license_file ? `see ${p.license_file}` : "UNKNOWN"), repo: p.repository ?? "" }));

const npm = [];
const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "studio/package.json"), "utf8"));
for (const name of Object.keys(pkgJson.dependencies ?? {})) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, "studio/node_modules", name, "package.json"), "utf8"));
    npm.push({ name, version: p.version, license: typeof p.license === "string" ? p.license : (p.license?.type ?? "UNKNOWN"), repo: typeof p.repository === "string" ? p.repository : (p.repository?.url ?? "") });
  } catch {
    npm.push({ name, version: "?", license: "not installed here", repo: "" });
  }
}

const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|Zlib|Unicode-3\.0|Unicode-DFS-2016|CC0-1\.0|0BSD|BSL-1\.0|MPL-2\.0|Unlicense|MIT-0|OpenSSL|Apache-2\.0 WITH LLVM-exception|CDLA-Permissive-2\.0)$/;
const plain = (license) => license.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+|\s*\/\s*/).map((s) => s.trim());
const classify = (license) => {
  const parts = plain(license);
  // "A OR B": fine when any choice is permissive; "A AND B": every part must be
  if (/\sOR\s|\//.test(license)) return parts.some((p) => PERMISSIVE.test(p)) ? "ok" : "check";
  return parts.every((p) => PERMISSIVE.test(p)) ? "ok" : "check";
};
const all = [...rust.map((x) => ({ ...x, kind: "rust" })), ...npm.map((x) => ({ ...x, kind: "npm" }))];
const check = all.filter((x) => classify(x.license) === "check");

const counts = new Map();
for (const x of all) counts.set(x.license, (counts.get(x.license) ?? 0) + 1);
const line = (x) => `| ${x.name} | ${x.version} | ${x.license} | ${x.repo} |`;
const table = (list) => `| Package | Version | Licence | Source |\n| --- | --- | --- | --- |\n${list.sort((a, b) => a.name.localeCompare(b.name)).map(line).join("\n")}`;

const out = `# Third-party licences

Made by \`scripts/third-party-licenses.mjs\` on ${new Date().toISOString().slice(0, 10)} from \`cargo metadata\` (normal and build dependencies of the workspace) and
\`studio/package.json\`. It lists what the licence fields say; it is not legal advice, and a licence file that a crate ships is the real text. Lua's notice is in
\`licenses/\` already, fonts' in \`licenses/fonts/\`. **These notices are not yet bundled into built apps** (see TODO.md).

## Summary

${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `- ${l}: ${n}`).join("\n")}

## To look at before shipping (${check.length})

${check.length ? table(check) : "None: every licence field is a permissive one."}

## Rust crates (${rust.length})

${table(rust)}

## npm packages used by the studio (${npm.length})

${table(npm)}
`;
fs.writeFileSync(path.join(root, "licenses/third-party.md"), out);
console.log(`${rust.length} Rust crates, ${npm.length} npm packages, ${check.length} to look at`);
for (const x of check) console.log(`  ${x.kind}: ${x.name} ${x.version}: ${x.license}`);
