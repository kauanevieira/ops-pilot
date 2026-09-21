import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "../store/db.ts";
import { seedDatabase } from "../store/sqlite-schema.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { baselineState } from "../store/seed.ts";
import { createOpsMcpServer } from "./ops-mcp-server.ts";

/**
 * Entry point for the `opspilot` MCP server (006-mcp-server). Transport is
 * stdio: the client speaks JSON-RPC 2.0 over this process's stdin/stdout,
 * one message per line.
 *
 * ⚠️ CRITICAL RULE: stdout is the protocol channel. This file, and every
 * module `src/mcp/` imports, MUST NOT write to it by any means other than
 * the transport itself — no `console.log`, `console.info`, `console.debug`,
 * no `process.stdout.write`. All diagnostics — startup, readiness,
 * configuration failure, technical error, shutdown — go to stderr via
 * `diag` below (FR-017 through FR-020; contracts/mcp-server.md).
 *
 * Registering this server with a client MUST use
 * `npm --prefix <repo> run --silent mcp` — WITHOUT `--silent`, `npm run`
 * itself writes the script's header to stdout before the server even
 * starts, corrupting the session with no `console.log` involved anywhere
 * in this codebase (006-mcp-server, research R-006). `--prefix` also
 * anchors the working directory at the repo root, so the default
 * `OPSPILOT_DB` path resolves to the same file the HTTP API uses,
 * regardless of the client's own cwd.
 */

/** Writes a diagnostic line to stderr — never to stdout (FR-017–FR-020). */
function diag(message: string): void {
  process.stderr.write(`[opspilot-mcp] ${message}\n`);
}

// Runtime guard (research R-005): redirects `console.log/info/debug` to
// stderr before anything else runs, in case a dependency imported below
// ever calls one of them. Nothing in this server's import graph does
// today (audited: src/store/, src/domain/, src/agents/tool-definitions.ts,
// src/agents/provider-status.ts) — this guard exists because the rule is
// critical and the failure mode (a corrupted stdio session) is silent and
// far from its cause.
console.log = (...args: unknown[]) => diag(args.map(String).join(" "));
console.info = console.log;
console.debug = console.log;

let shuttingDown = false;

async function main(): Promise<void> {
  const db = openDatabase();
  // Applies the DDL (FR-004 of 004-sqlite-persistence) — MUST run before
  // seedDatabase, which assumes the tables already exist. Same sequence as
  // src/index.ts, over the same OPSPILOT_DB file (FR-010).
  const store = new SqliteOpsStore(db);
  seedDatabase(db, baselineState());

  const server = createOpsMcpServer(store, {
    onToolTechnicalError: (toolName, error) => {
      diag(`falha técnica em ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const shutdown = (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    Promise.resolve(server.close())
      .catch(() => {})
      .finally(() => {
        store.close();
        diag(`encerrado (${reason})`);
        process.exit(0);
      });
  };

  // StdioServerTransport only reacts to stdin "data"/"error" (research
  // R-008) — it does not itself watch for "end", so a client closing its
  // side of stdio would otherwise leave the database connection open.
  process.stdin.once("end", () => shutdown("stdin fechado"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await server.connect(new StdioServerTransport());
  diag("pronto (stdio)");
}

main().catch((error) => {
  diag(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
