// A small client for the Nova MCP server (scripts/nova-mcp.sh): starts it once and lets a script call its tools in order.
// The rally game's models, sounds, music, sprites and scenes are all made by calling the server's tools, like a person
// pressing buttons in the studio, so the files are the ones the studio's own editors write and can open again.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const GAME = join(root, "examples/pine-ridge-rally");

export async function connect(project = GAME) {
  const server = spawn(join(root, "scripts/nova-mcp.sh"), [], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, NOVA_PROJECT: project } });
  let buffer = "";
  const waiting = new Map();
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) {
        const m = JSON.parse(line);
        waiting.get(m.id)?.(m);
      }
    }
  });
  let next = 1;
  const rpc = (method, params) => new Promise((done) => {
    const id = next++;
    waiting.set(id, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "rally-authoring", version: "0" } });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    /// Calls a tool; throws with the server's message when it fails.
    async call(tool, args = {}) {
      const r = await rpc("tools/call", { name: `nova_${tool}`, arguments: args });
      if (r.error) throw new Error(`${tool}: ${r.error.message}`);
      const text = r.result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (r.result.isError) throw new Error(`${tool}(${args.name ?? ""}): ${text}`);
      return text;
    },
    close() {
      server.stdin.end();
      server.kill();
    },
  };
}

/// Runs `main(nova)` against a fresh connection and always closes it.
export async function withServer(main) {
  const nova = await connect();
  try {
    await main(nova);
  } finally {
    nova.close();
  }
}
