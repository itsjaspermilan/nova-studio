import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and does not want the screen cleared.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // (the examples folder next to the studio may be read in development, to try the editors on real projects)
  server: { port: 1420, strictPort: true, host: "127.0.0.1", fs: { allow: [".."] } },
  // (component tests mount Svelte components in jsdom, which needs the browser build of Svelte)
  // (only while testing: setting `conditions` replaces Vite's own, and the app needs those)
  ...(process.env.VITEST ? { resolve: { conditions: ["browser"] } } : {}),
  build: { target: "es2022", sourcemap: false },
  // (a test's time limit is there to catch a test that hangs, not to time it: vitest's 5 s default failed tests that take a
  // second or two alone whenever the machine was busy, as it is when several agents run their suites at once. A test that
  // needs longer still says so itself.)
  test: { environment: "node", include: ["src/**/*.test.ts", "mcp/**/*.test.ts"], setupFiles: ["src/test/dom.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
