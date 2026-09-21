import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOpsMcpServer, MCP_TOOL_NAMES } from "./ops-mcp-server.ts";
import { createOpsTools } from "../agents/tools.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { seedDatabase } from "../store/sqlite-schema.ts";
import { baselineState } from "../store/seed.ts";
import pkg from "../../package.json" with { type: "json" };
import type { OpsRepository } from "../store/repository.ts";

/**
 * In-process coverage (006-mcp-server, US1/US2/US4): a linked pair of
 * `InMemoryTransport` connects a real MCP `Client` to `createOpsMcpServer`
 * over a `SqliteOpsStore(":memory:")` the test itself holds — assertions
 * inspect that store's resulting state, per the constitution's Principle V
 * ("verificação... deve inspecionar o estado resultante, não o texto"),
 * rather than parsing tool output.
 */

interface Harness {
  client: Client;
  store: OpsRepository;
  close(): Promise<void>;
}

async function connectedHarness(): Promise<Harness> {
  const db = new DatabaseSync(":memory:");
  const store = new SqliteOpsStore(db);
  seedDatabase(db, baselineState());

  const server = createOpsMcpServer(store);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    store,
    async close() {
      await client.close();
    },
  };
}

// --- US1: discovery -----------------------------------------------------

describe("createOpsMcpServer — descoberta (US1)", () => {
  it("se apresenta com o nome opspilot e a versão do package.json", async () => {
    const { client, close } = await connectedHarness();
    try {
      const info = client.getServerVersion();
      assert.equal(info?.name, "opspilot");
      assert.equal(info?.version, pkg.version);
    } finally {
      await close();
    }
  });

  it("lista exatamente list_alerts, list_incidents, open_incident e resolve_incident", async () => {
    const { client, close } = await connectedHarness();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, [...MCP_TOOL_NAMES].sort());
    } finally {
      await close();
    }
  });
});

// --- US4: single source of truth -----------------------------------------

describe("createOpsMcpServer — fonte única (US4, FR-025)", () => {
  it("descrição e esquema anunciados são iguais aos da definição interna", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const { tools } = await client.listTools();
      const localTools = createOpsTools(store) as unknown as Array<{
        name: string;
        description: string;
        schema: z.ZodObject<z.ZodRawShape>;
      }>;

      for (const tool of tools) {
        const local = localTools.find((t) => t.name === tool.name);
        assert.ok(local, `${tool.name} deve existir também na definição interna`);
        assert.equal(tool.description, local!.description, `${tool.name}: descrição divergente`);
        assert.deepEqual(
          tool.inputSchema,
          z.toJSONSchema(local!.schema, { target: "draft-7", io: "input" }),
          `${tool.name}: esquema divergente`,
        );
      }
    } finally {
      await close();
    }
  });
});

// --- US2: execution over shared state ------------------------------------

describe("createOpsMcpServer — execução sobre o estado (US2)", () => {
  it("list_alerts sem argumentos devolve os alertas firing do seed, igual ao store", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const result = await client.callTool({ name: "list_alerts", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      assert.deepEqual(parsed, JSON.parse(JSON.stringify(store.listAlerts("firing"))));
      assert.notEqual(result.isError, true);
    } finally {
      await close();
    }
  });

  it("list_incidents sem argumentos devolve só os open", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      store.openIncident({ title: "a", serviceId: "checkout", severity: "high" });
      const toResolve = store.openIncident({ title: "b", serviceId: "checkout", severity: "low" });
      store.resolveIncident(toResolve.id);

      const result = await client.callTool({ name: "list_incidents", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text) as Array<{ status: string }>;
      assert.ok(parsed.every((i) => i.status === "open"));
      assert.equal(parsed.length, 1);
    } finally {
      await close();
    }
  });

  it("list_alerts com store vazio devolve [] sem isError (vazio não é erro)", async () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    const server = createOpsMcpServer(store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({ name: "list_alerts", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      assert.equal(content[0].text, "[]");
      assert.notEqual(result.isError, true);
    } finally {
      await client.close();
    }
  });

  it("open_incident cria o incidente no store, e o texto traz id e status open", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const result = await client.callTool({
        name: "open_incident",
        arguments: { title: "Erro 500 no checkout", service: "checkout", severity: "high" },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const created = JSON.parse(content[0].text);
      assert.equal(created.status, "open");
      assert.notEqual(result.isError, true);

      const open = store.listIncidents("open");
      assert.ok(open.some((i) => i.id === created.id));
    } finally {
      await close();
    }
  });

  it("resolve_incident marca o incidente como resolved no store", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const incident = store.openIncident({ title: "x", serviceId: "checkout", severity: "medium" });

      const result = await client.callTool({ name: "resolve_incident", arguments: { id: incident.id } });
      const content = result.content as Array<{ type: string; text: string }>;
      const resolved = JSON.parse(content[0].text);
      assert.equal(resolved.status, "resolved");
      assert.notEqual(result.isError, true);

      assert.equal(store.getIncident(incident.id)?.status, "resolved");
      assert.ok(store.getIncident(incident.id)?.resolvedAt);
    } finally {
      await close();
    }
  });

  it("paridade de texto com o adaptador LangChain para list_alerts e list_incidents (FR-016)", async () => {
    const db1 = new DatabaseSync(":memory:");
    const store1 = new SqliteOpsStore(db1);
    seedDatabase(db1, baselineState());

    const db2 = new DatabaseSync(":memory:");
    const store2 = new SqliteOpsStore(db2);
    seedDatabase(db2, baselineState());

    const server = createOpsMcpServer(store1);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const localTools = createOpsTools(store2) as unknown as Array<{
        name: string;
        invoke(args: Record<string, unknown>): Promise<string>;
      }>;

      for (const name of ["list_alerts", "list_incidents"] as const) {
        const mcpResult = await client.callTool({ name, arguments: {} });
        const content = mcpResult.content as Array<{ type: string; text: string }>;
        const local = localTools.find((t) => t.name === name)!;
        const localText = await local.invoke({});
        assert.equal(content[0].text, localText, `${name}: texto divergente entre MCP e LangChain`);
      }
    } finally {
      await client.close();
    }
  });
});

// --- US2: domain and validation errors -----------------------------------

describe("createOpsMcpServer — erros (US2)", () => {
  it("open_incident com serviço inexistente devolve isError sem criar incidente", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const before = store.listIncidents().length;
      const result = await client.callTool({
        name: "open_incident",
        arguments: { title: "x", service: "nao-existe", severity: "low" },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      assert.equal(result.isError, true);
      assert.match(content[0].text, /Service not found/);
      assert.equal(store.listIncidents().length, before);
    } finally {
      await close();
    }
  });

  it("resolve_incident com id inexistente devolve isError", async () => {
    const { client, close } = await connectedHarness();
    try {
      const result = await client.callTool({ name: "resolve_incident", arguments: { id: "inc-nope" } });
      assert.equal(result.isError, true);
    } finally {
      await close();
    }
  });

  it("resolve_incident em incidente já resolvido devolve isError e preserva resolvedAt", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const incident = store.openIncident({ title: "x", serviceId: "checkout", severity: "low" });
      const resolved = store.resolveIncident(incident.id);

      const result = await client.callTool({ name: "resolve_incident", arguments: { id: incident.id } });
      assert.equal(result.isError, true);
      assert.equal(store.getIncident(incident.id)?.resolvedAt?.getTime(), resolved.resolvedAt?.getTime());
    } finally {
      await close();
    }
  });

  it("open_incident com severity fora do enum é recusado sem criar incidente", async () => {
    const { client, store, close } = await connectedHarness();
    try {
      const before = store.listIncidents().length;
      const result = await client.callTool({
        name: "open_incident",
        arguments: { title: "x", service: "checkout", severity: "bogus" },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      assert.equal(result.isError, true);
      assert.match(content[0].text, /critical/);
      assert.equal(store.listIncidents().length, before);
    } finally {
      await close();
    }
  });

  it("open_incident sem title é recusado", async () => {
    const { client, close } = await connectedHarness();
    try {
      const result = await client.callTool({
        name: "open_incident",
        arguments: { service: "checkout", severity: "low" },
      });
      assert.equal(result.isError, true);
    } finally {
      await close();
    }
  });

  it("consultar_runbook e check_provider_status não são expostas — chamada recusada", async () => {
    const { client, close } = await connectedHarness();
    try {
      for (const name of ["consultar_runbook", "check_provider_status"]) {
        const result = await client.callTool({ name, arguments: {} });
        assert.equal(result.isError, true);
        const content = result.content as Array<{ type: string; text: string }>;
        assert.match(content[0].text, /not found/i);
      }
    } finally {
      await close();
    }
  });

  it("falha técnica (não-domínio) vira isError, aciona onToolTechnicalError e a sessão continua", async () => {
    let reported: { toolName: string; error: unknown } | undefined;
    const brokenStore: OpsRepository = {
      listAlerts() {
        throw new Error("boom");
      },
      findService: () => undefined,
      openIncident: () => {
        throw new Error("unused");
      },
      resolveIncident: () => {
        throw new Error("unused");
      },
      getIncident: () => undefined,
      listIncidents: () => [],
      findRunbook: () => undefined,
    };

    const server = createOpsMcpServer(brokenStore, {
      onToolTechnicalError: (toolName, error) => {
        reported = { toolName, error };
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const result = await client.callTool({ name: "list_alerts", arguments: {} });
      assert.equal(result.isError, true);
      const content = result.content as Array<{ type: string; text: string }>;
      assert.match(content[0].text, /boom/);
      assert.equal(reported?.toolName, "list_alerts");

      // The session must still work after a technical failure.
      const again = await client.callTool({ name: "list_incidents", arguments: {} });
      assert.notEqual(again.isError, true);
    } finally {
      await client.close();
    }
  });
});

// --- 008/009-semantic-memory, FR-031/FR-019: memory tools are never exposed over MCP --

describe("MCP_TOOL_NAMES never includes a memory tool (FR-031, FR-019)", () => {
  it("neither forget_preference nor the retired remember_fact/forget_fact are in the allow-list", () => {
    // MCP_TOOL_NAMES is typed as `readonly OpsToolName[]`, derived from
    // `defineOpsTools`'s return type — a memory tool name literally cannot
    // be added to it without a compile error (R-014), since memory tools
    // are defined in a separate module (memory-tools.ts) that
    // `OpsToolName` doesn't know about. This test documents that
    // guarantee at runtime, in case the type-level one is ever weakened.
    assert.ok(!(MCP_TOOL_NAMES as readonly string[]).includes("forget_preference"));
    assert.ok(!(MCP_TOOL_NAMES as readonly string[]).includes("remember_fact"));
    assert.ok(!(MCP_TOOL_NAMES as readonly string[]).includes("forget_fact"));
  });
});
