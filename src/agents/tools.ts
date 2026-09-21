import { tool } from "@langchain/core/tools";
import type { OpsRepository } from "../store/repository.ts";
import { defineOpsTools } from "./tool-definitions.ts";

/**
 * LangChain adapter over the tool definitions in `tool-definitions.ts`
 * (006-mcp-server, R-002) — that module is the single source of truth for
 * name, description, schema and execution (the 6 rules of Principle IV
 * live there, not here); this file only translates a `ToolOutcome` into
 * the plain string LangChain's `tool()` expects. The MCP adapter
 * (`src/mcp/ops-mcp-server.ts`) translates the same definitions into MCP's
 * `{ content, isError }` shape instead.
 *
 * Tools are built from a repository instance rather than a module-level
 * singleton, so the arena (US3) can give each strategy run its own
 * freshly-seeded state without runs interfering with each other (FR-030).
 *
 * `deps.fetchImpl` (005-provider-status-tool, R-007) is the one thing this
 * factory takes beyond the store — an optional override with a
 * `globalThis.fetch` default, so tests inject a fake fetch exactly where
 * they already call this factory, without threading a fetcher through the
 * strategy chain (`BASE_FACTORIES` → `createStrategy` → `resolveStrategy`),
 * which is public contract of the 003 HTTP layer.
 *
 * The array is built explicitly by definition, rather than mapped
 * generically over `Object.values(...)`, because LangChain's `tool()` is
 * overloaded per schema shape and a generic map doesn't unify cleanly
 * across a heterogeneous array of differently-shaped tools.
 */
export function createOpsTools(store: OpsRepository, deps: { fetchImpl?: typeof fetch } = {}) {
  const defs = defineOpsTools(store, deps);

  const listAlerts = tool(async (args) => (await defs.list_alerts.run(args)).text, {
    name: defs.list_alerts.name,
    description: defs.list_alerts.description,
    schema: defs.list_alerts.schema,
  });

  const listIncidents = tool(async (args) => (await defs.list_incidents.run(args)).text, {
    name: defs.list_incidents.name,
    description: defs.list_incidents.description,
    schema: defs.list_incidents.schema,
  });

  const consultarRunbook = tool(async (args) => (await defs.consultar_runbook.run(args)).text, {
    name: defs.consultar_runbook.name,
    description: defs.consultar_runbook.description,
    schema: defs.consultar_runbook.schema,
  });

  const openIncident = tool(async (args) => (await defs.open_incident.run(args)).text, {
    name: defs.open_incident.name,
    description: defs.open_incident.description,
    schema: defs.open_incident.schema,
  });

  const resolveIncident = tool(async (args) => (await defs.resolve_incident.run(args)).text, {
    name: defs.resolve_incident.name,
    description: defs.resolve_incident.description,
    schema: defs.resolve_incident.schema,
  });

  const checkProviderStatusTool = tool(
    async (args) => (await defs.check_provider_status.run(args)).text,
    {
      name: defs.check_provider_status.name,
      description: defs.check_provider_status.description,
      schema: defs.check_provider_status.schema,
    },
  );

  return [listAlerts, listIncidents, consultarRunbook, openIncident, resolveIncident, checkProviderStatusTool];
}
