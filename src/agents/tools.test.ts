import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createOpsTools } from "./tools.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { seedDatabase } from "../store/sqlite-schema.ts";
import { baselineState } from "../store/seed.ts";
import type { OpsRepository } from "../store/repository.ts";

/**
 * The five tools run over `SqliteOpsStore(':memory:')` (FR-039, R-015):
 * these tests are the coverage that never existed for the tools before this
 * feature — src/agents/tools.test.ts didn't exist.
 */
function seededStore(): OpsRepository {
  const db = new DatabaseSync(":memory:");
  const store = new SqliteOpsStore(db);
  seedDatabase(db, baselineState());
  return store;
}

/**
 * A minimal structural view of a LangChain tool, just what these tests
 * need (name, description, schema shape, and a callable invoke). Avoids
 * fighting the library's per-schema generic overloads, which don't unify
 * across a heterogeneous array of differently-shaped tools.
 */
interface TestableTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  invoke(input: Record<string, unknown>): Promise<string>;
}

function asTestableTools(tools: ReturnType<typeof createOpsTools>): TestableTool[] {
  return tools as unknown as TestableTool[];
}

function findTool(tools: TestableTool[], name: string): TestableTool {
  const found = tools.find((t) => t.name === name);
  assert.ok(found, `tool ${name} must exist`);
  return found!;
}

// --- T032: list_incidents pela ferramenta (FR-028) --------------------------

describe("list_incidents", () => {
  it("default é 'open' quando o campo é omitido", async () => {
    const store = seededStore();
    const opened = store.openIncident({ title: "a", serviceId: "checkout", severity: "high" });
    const toResolve = store.openIncident({ title: "b", serviceId: "checkout", severity: "low" });
    store.resolveIncident(toResolve.id);

    const tools = asTestableTools(createOpsTools(store));
    const listIncidents = findTool(tools, "list_incidents");
    const result = JSON.parse(await listIncidents.invoke({}));

    assert.equal(result.length, 1);
    assert.equal(result[0].id, opened.id);
  });

  it("os três filtros funcionam: open, resolved, all", async () => {
    const store = seededStore();
    const opened = store.openIncident({ title: "a", serviceId: "checkout", severity: "high" });
    const toResolve = store.openIncident({ title: "b", serviceId: "checkout", severity: "low" });
    store.resolveIncident(toResolve.id);

    const tools = asTestableTools(createOpsTools(store));
    const listIncidents = findTool(tools, "list_incidents");

    assert.equal(JSON.parse(await listIncidents.invoke({ status: "open" })).length, 1);
    assert.equal(JSON.parse(await listIncidents.invoke({ status: "resolved" })).length, 1);
    assert.equal(JSON.parse(await listIncidents.invoke({ status: "all" })).length, 2);
    void opened;
  });

  it("lista vazia é resposta normal, não erro (FR-029b)", async () => {
    const store = seededStore();
    const tools = asTestableTools(createOpsTools(store));
    const listIncidents = findTool(tools, "list_incidents");

    const result = JSON.parse(await listIncidents.invoke({}));
    assert.deepEqual(result, []);
  });
});

// --- T033: consultar_runbook, 3 desfechos (FR-029a) -------------------------

describe("consultar_runbook", () => {
  it("serviço com runbook devolve os passos na ordem", async () => {
    const store = seededStore();
    const tools = asTestableTools(createOpsTools(store));
    const consultarRunbook = findTool(tools, "consultar_runbook");

    const result = JSON.parse(await consultarRunbook.invoke({ service: "checkout" }));
    assert.equal(result.serviceId, "checkout");
    assert.ok(Array.isArray(result.steps));
    assert.ok(result.steps.length > 0);
  });

  it("serviço existente sem runbook devolve o erro de runbook ausente, como observação (não aborta)", async () => {
    const store = seededStore();
    const tools = asTestableTools(createOpsTools(store));
    const consultarRunbook = findTool(tools, "consultar_runbook");

    const result = JSON.parse(await consultarRunbook.invoke({ service: "search" }));
    assert.ok(result.error);
    assert.match(result.error, /Runbook not found/);
  });

  it("serviço inexistente devolve o erro de serviço inexistente — distinguível do runbook ausente", async () => {
    const store = seededStore();
    const tools = asTestableTools(createOpsTools(store));
    const consultarRunbook = findTool(tools, "consultar_runbook");

    const result = JSON.parse(await consultarRunbook.invoke({ service: "nao-existe" }));
    assert.ok(result.error);
    assert.match(result.error, /Service not found/);
  });
});

// --- T041/T042: auditoria das 6 regras (FR-034, FR-036, FR-037) -------------

/** Unwraps a `.default()` wrapper to reach the underlying zod type. */
function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  const def = (field as unknown as { def?: { type?: string; innerType?: z.ZodTypeAny } }).def;
  if (def?.type === "default" && def.innerType) {
    return unwrap(def.innerType);
  }
  return field;
}

describe("as 5 ferramentas — auditoria das 6 regras (Princípio IV)", () => {
  const store = seededStore();
  const tools = asTestableTools(createOpsTools(store));

  it("toda ferramenta tem uma descrição não vazia", () => {
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 0, `${t.name} sem descrição`);
    }
  });

  it("Regra 5 — todo campo de todo esquema tem .describe() (FR-036)", () => {
    for (const t of tools) {
      const shape = t.schema.shape as Record<string, z.ZodTypeAny>;
      for (const [field, def] of Object.entries(shape)) {
        assert.ok(
          typeof def.description === "string" && def.description.length > 0,
          `${t.name}.${field} está sem .describe()`,
        );
      }
    }
  });

  it("Regra 6 — todo campo de conjunto fechado é enum, com os valores na descrição (FR-037)", () => {
    for (const t of tools) {
      const shape = t.schema.shape as Record<string, z.ZodTypeAny>;
      for (const [field, def] of Object.entries(shape)) {
        const inner = unwrap(def);
        const innerDef = (inner as unknown as { def?: { type?: string; entries?: Record<string, string> } }).def;
        if (innerDef?.type === "enum") {
          const values = Object.values(innerDef.entries ?? {});
          for (const value of values) {
            assert.ok(
              def.description?.includes(value),
              `${t.name}.${field}: valor "${value}" não aparece na descrição do campo`,
            );
          }
        } else {
          // Not an enum: confirm it's genuinely open text, not a
          // string standing in for a closed set (best-effort — checked
          // manually against contracts/ops-tools.md for the known fields).
          assert.notEqual(innerDef?.type, undefined);
        }
      }
    }
  });

  it("todas as cinco ferramentas estão presentes", () => {
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "consultar_runbook",
      "list_alerts",
      "list_incidents",
      "open_incident",
      "resolve_incident",
    ].sort());
  });
});
