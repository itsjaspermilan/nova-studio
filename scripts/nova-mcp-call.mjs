#!/usr/bin/env node
// Calls one tool of the Nova MCP server over its real stdio protocol and prints the answer; pictures are saved to files.
//   NOVA_PROJECT=games/x node scripts/nova-mcp-call.mjs nova_check '{}'
//   node scripts/nova-mcp-call.mjs --list
// Arguments may also come from a file: `@path.json`.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [name, raw = "{}"] = process.argv.slice(2);
if (!name) {
  console.error("usage: nova-mcp-call.mjs <tool|--list> [json args | @file]");
  process.exit(2);
}
const args = name === "--list" ? {} : JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw);
const server = spawn(join(root, "scripts/nova-mcp.sh"), [], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
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
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nova-mcp-call", version: "0" } });
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
let failed = false;
if (name === "--list") {
  const r = await rpc("tools/list", {});
  for (const t of r.result.tools) console.log(`${t.name}: ${t.description.split("\n")[0].slice(0, 110)}`);
} else {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.error) {
    console.error(r.error.message);
    failed = true;
  } else {
    failed = !!r.result.isError;
    let shots = 0;
    for (const c of r.result.content) {
      if (c.type === "text") console.log(c.text);
      else if (c.type === "image") {
        const file = `/tmp/nova-mcp-image-${Date.now()}-${shots++}.png`;
        writeFileSync(file, Buffer.from(c.data, "base64"));
        console.log(`[image saved: ${file}]`);
      }
    }
  }
}
server.stdin.end();
server.kill();
process.exit(failed ? 1 : 0);
