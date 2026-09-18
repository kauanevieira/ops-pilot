import { z } from "zod";
import { createApp } from "./http/server.ts";

/**
 * `PORT` is external input like any other (a CLI flag, an HTTP body) and
 * the project's convention is that all of it is validated with zod
 * (R-011) — without this, `PORT=abc` would coerce to `NaN` and `listen`
 * would silently pick a random port instead of failing loudly.
 */
const portSchema = z.coerce.number().int().min(1).max(65535).default(3000);

function resolvePort(): number {
  try {
    return portSchema.parse(process.env.PORT);
  } catch (error) {
    console.error("PORT inválida:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function main(): void {
  const port = resolvePort();
  const app = createApp();

  app.listen(port, () => {
    console.log(`OpsPilot ouvindo em http://localhost:${port}`);
  });
}

main();
