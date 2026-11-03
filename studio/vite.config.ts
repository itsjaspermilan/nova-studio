import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and does not want the screen cleared.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // (the examples folder next to the studio may be read in development, to try the editors on real projects)
  server: { port: 1420, strictPort: true, host: "127.0.0.1", fs: { allow: [".."] } },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "node", include: ["src/**/*.test.ts", "mcp/**/*.test.ts"] },
});
