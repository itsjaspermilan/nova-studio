#!/usr/bin/env node
// Calls one tool of the Nova MCP server over its real stdio protocol and prints the answer; pictures are saved to files.
//   scripts/env.sh node scripts/nova-mcp-call.mjs --project games/x check
//   scripts/env.sh node scripts/nova-mcp-call.mjs play '{"frames": 60}'      (NOVA_PROJECT says which game)
//   scripts/env.sh node scripts/nova-mcp-call.mjs --list                     every tool: its whole description and its parameters
//   scripts/env.sh node scripts/nova-mcp-call.mjs --help play                one tool: description, parameters with types, an example
// Arguments may also come from a file: `@path.json`. A tool's name may be given with or without its `nova_` prefix.
// `scripts/nova-tool` is the same through env.sh, so it runs from any folder: scripts/nova-tool --project games/x check
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "usage: nova-mcp-call.mjs [--project <folder>] <tool> [json args | @file]\n" +
  "       nova-mcp-call.mjs --list            every tool with its whole description and its parameters\n" +
  "       nova-mcp-call.mjs --help <tool>     one tool: its description, each parameter with its type, and an example\n" +
  "Run it as `scripts/env.sh node scripts/nova-mcp-call.mjs ...` (plain `node` is not set up on this machine), or as `scripts/nova-tool ...`.";

const argv = process.argv.slice(2);
const env = { ...process.env };
while (argv[0] === "--project" || argv[0]?.startsWith("--project=")) {
  const flag = argv.shift();
  const value = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv.shift();
  if (!value) {
    console.error(USAGE);
    process.exit(2);
  }
  env.NOVA_PROJECT = resolve(value);
}
const [name, raw = "{}"] = argv;
if (!name || name === "-h") {
  console.error(USAGE);
  process.exit(2);
}
const listing = name === "--list" || name === "--help" || name === "--describe";
const args = listing ? {} : JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw);
const server = spawn(join(root, "scripts/nova-mcp.sh"), [], { stdio: ["pipe", "pipe", "inherit"], env });
let buffer = "";
const waiting = new Map();
server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
  }
});
let next = 1;
const rpc = (method, params) =>
  new Promise((done) => {
    const id = next++;
    waiting.set(id, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

const typeOf = (p) => {
  const t = Array.isArray(p.type) ? p.type.join(" or ") : (p.type ?? "any");
  const of = p.items ? ` of ${Array.isArray(p.items.type) ? p.items.type.join(" or ") : (p.items.type ?? "any")}` : "";
  return `${t}${of}${p.enum ? ` (${p.enum.map((v) => JSON.stringify(v)).join(" | ")})` : ""}`;
};

/// One tool in full: what it does, every parameter with its type and what it means, and a call that works.
function describe(t) {
  const out = [`${t.name}`, `  ${t.description}`, "  parameters:"];
  const required = new Set(t.inputSchema.required ?? []);
  for (const [key, p] of Object.entries(t.inputSchema.properties ?? {})) {
    out.push(`    ${key}: ${typeOf(p)}${required.has(key) ? ", required" : ""}${p.description ? `. ${p.description}` : ""}`);
  }
  const example = t.inputSchema.examples?.[0];
  if (example) out.push(`  example: scripts/env.sh node scripts/nova-mcp-call.mjs ${t.name.replace(/^nova_/, "")} '${JSON.stringify(example)}'`);
  return out.join("\n");
}

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nova-mcp-call", version: "0" } });
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
let failed = false;
if (listing) {
  const r = await rpc("tools/list", {});
  const tools = r.result.tools;
  const wanted = argv[1];
  if (wanted) {
    const t = tools.find((x) => x.name === wanted || x.name === `nova_${wanted}`);
    if (t) console.log(describe(t));
    else {
      console.error(`there is no tool '${wanted}'. The tools: ${tools.map((x) => x.name.replace(/^nova_/, "")).join(", ")}`);
      failed = true;
    }
  } else if (name === "--list") {
    for (const t of tools) {
      const required = new Set(t.inputSchema.required ?? []);
      const keys = Object.keys(t.inputSchema.properties ?? {}).map((k) => (required.has(k) ? `${k}*` : k));
      console.log(`${t.name}\n  ${t.description}\n  parameters (* required): ${keys.join(", ")}\n`);
    }
    console.log("One tool with its parameters' types, what each means and an example: --help <tool>. Every tool takes `project` (or NOVA_PROJECT, or --project <folder> before the tool's name).");
  } else {
    console.error(`say which tool: ${name} <tool>. The tools: ${tools.map((x) => x.name.replace(/^nova_/, "")).join(", ")}`);
    failed = true;
  }
} else {
  const r = await rpc("tools/call", { name: name.startsWith("nova_") ? name : `nova_${name}`, arguments: args });
  if (r.error) {
    console.error(r.error.message);
    failed = true;
  } else {
    failed = !!r.result.isError;
    let shots = 0;
    for (const c of r.result.content) {
      if (c.type === "text") console.log(c.text);
      else if (c.type === "image") {
        const file = join(process.platform === "win32" ? tmpdir() : "/tmp", `nova-mcp-image-${Date.now()}-${shots++}.png`);
        writeFileSync(file, Buffer.from(c.data, "base64"));
        console.log(`[image saved: ${file}]`);
      }
    }
  }
}
server.stdin.end();
server.kill();
process.exit(failed ? 1 : 0);
