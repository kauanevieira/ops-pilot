import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_TOOL_NAMES } from "./ops-mcp-server.ts";

/**
 * Process-level coverage (006-mcp-server, US1/US3): the requested test —
 * "sobe o server e valida o list de tools" — spawns the real
 * `src/mcp/server.ts` process, exactly as `npm run mcp` executes it (minus
 * npm itself, which is what corrupts stdout without `--silent` — see
 * research R-006 and contracts/mcp-server.md), and talks to it over real
 * stdio.
 *
 * `env` is passed explicitly (research R-011): without it,
 * `StdioClientTransport` only inherits the SDK's "safe" variables, and an
 * `OPSPILOT_DB` set in whoever runs the suite could otherwise leak into
 * the child.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVER_ARGS = ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/mcp/server.ts"];

function spawnClient(env: Record<string, string> = {}): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: SERVER_ARGS,
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH ?? "", OPSPILOT_DB: ":memory:", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "process-test-client", version: "0.0.0" });
  return { client, transport };
}

describe("src/mcp/server.ts — processo real (US1)", () => {
  it("sobe por stdio, se apresenta como opspilot e lista exatamente as 4 ferramentas", async () => {
    const { client, transport } = spawnClient();
    try {
      await client.connect(transport);
      const info = client.getServerVersion();
      assert.equal(info?.name, "opspilot");

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, [...MCP_TOOL_NAMES].sort());
    } finally {
      await client.close();
    }
  });
});

describe("src/mcp/server.ts — canal do protocolo (US3)", () => {
  it("todo o stdout de uma sessão completa é JSON-RPC válido (SC-004)", async () => {
    const chunks: Buffer[] = [];
    const child = spawn(process.execPath, SERVER_ARGS, {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: process.env.PATH ?? "", OPSPILOT_DB: ":memory:" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const send = (message: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw-stdout-test", version: "0.0.0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_alerts", arguments: {} } });
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "resolve_incident", arguments: { id: "inc-nope" } },
    });

    // Wait for the 4 responses (ids 1..4), then close stdin so the server
    // shuts down on its own (server.ts's "end" handler).
    await new Promise<void>((resolve, reject) => {
      const seen = new Set<number>();
      const timeout = setTimeout(() => reject(new Error("timed out waiting for responses")), 8000);
      const onData = () => {
        const text = Buffer.concat(chunks).toString("utf8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as { id?: number };
            if (typeof msg.id === "number") seen.add(msg.id);
          } catch {
            // ignore partial lines while streaming
          }
        }
        if ([1, 2, 3, 4].every((id) => seen.has(id))) {
          clearTimeout(timeout);
          child.stdout.off("data", onData);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      onData();
    });

    child.stdin.end();
    const code = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (code === null) child.kill();

    const stdout = Buffer.concat(chunks).toString("utf8");
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    assert.ok(lines.length >= 4, "esperava ao menos 4 linhas de resposta no stdout");
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.equal(parsed.jsonrpc, "2.0", `linha não é JSON-RPC 2.0: ${line}`);
    }

    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    assert.match(stderr, /pronto/);
  });

  it("OPSPILOT_DB inválida encerra com código 1, stdout vazio e a causa no stderr (FR-021)", async () => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(process.execPath, SERVER_ARGS, {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: process.env.PATH ?? "", OPSPILOT_DB: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for exit")), 8000);
      child.once("exit", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });

    assert.equal(code, 1);
    assert.equal(Buffer.concat(stdoutChunks).length, 0, "stdout deve ficar vazio numa falha de configuração");
    assert.match(Buffer.concat(stderrChunks).toString("utf8"), /OPSPILOT_DB inválida/);
  });
});

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments so the
 * static scan below checks actual code, not prose that happens to
 * mention the forbidden APIs while explaining why they're forbidden.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("src/mcp/*.ts — varredura estática (US3, FR-018, SC-005)", () => {
  it("nenhum arquivo de código escreve em stdout por fora do transporte do protocolo", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    assert.ok(files.length > 0, "esperava encontrar arquivos de código em src/mcp/");

    const forbidden = /console\.(log|info|debug)\s*\(|process\.stdout/;
    for (const file of files) {
      const contents = readFileSync(new URL(file, `file://${dir}`), "utf8");
      const withoutComments = stripComments(contents);
      // The guard in server.ts assigns TO console.log/info/debug (it
      // redirects them) — that's an assignment target, not a call, and
      // must not trip this scan. Strip assignment lines before matching.
      const withoutGuardAssignments = withoutComments
        .split("\n")
        .filter((line) => !/console\.(log|info|debug)\s*=/.test(line))
        .join("\n");
      assert.doesNotMatch(withoutGuardAssignments, forbidden, `${file} escreve diretamente no stdout`);
    }
  });

  it("ops-mcp-server.ts importa de tool-definitions.ts, nunca de tools.ts (armadilha 2)", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const contents = readFileSync(new URL("ops-mcp-server.ts", `file://${dir}`), "utf8");
    assert.match(contents, /from ["']\.\.\/agents\/tool-definitions\.ts["']/);
    assert.doesNotMatch(contents, /from ["']\.\.\/agents\/tools\.ts["']/);
  });
});
