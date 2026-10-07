import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { resolveBase } from "./build/base";

const here = path.dirname(fileURLToPath(import.meta.url));

/** research R-005: hosts that answer 404 on a deep link still get the app. */
function copyIndexTo404(): Plugin {
  return {
    name: "opspilot-404-fallback",
    apply: "build",
    closeBundle() {
      copyFileSync(path.join(here, "dist/index.html"), path.join(here, "dist/404.html"));
    },
  };
}

export default defineConfig({
  base: resolveBase(process.env.OPSPILOT_WEB_BASE),
  plugins: [react(), copyIndexTo404()],
  resolve: {
    // research R-003: one definition of the wire schemas, shared with the API.
    alias: { "@domain": path.resolve(here, "../src/domain") },
  },
  server: { fs: { allow: [".."] } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts"],
  },
});
