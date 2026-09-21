import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../package.json" with { type: "json" };
import { defineOpsTools, type OpsToolName } from "../agents/tool-definitions.ts";
import type { OpsRepository } from "../store/repository.ts";

/**
 * The subset of `defineOpsTools` published over MCP (006-mcp-server,
 * research R-003). This is an explicit allow-list, not a filter over "all
 * definitions minus a few": a definition added later to
 * `tool-definitions.ts` must be named here on purpose to reach an MCP
 * client (FR-005) — `consultar_runbook` and `check_provider_status` stay
 * internal-agent-only, the latter because it needs `fetchImpl`, which no
 * MCP client configures.
 */
export const MCP_TOOL_NAMES = ["list_alerts", "list_incidents", "open_incident", "resolve_incident"] as const satisfies readonly OpsToolName[];

/**
 * Reports a technical (non-domain) failure from a tool's execution, for
 * the caller to route to stderr (FR-014) — this factory does no I/O of its
 * own (Principle I). The exception itself still propagates, for the SDK to
 * turn into an `isError` result (006-mcp-server, research R-004).
 */
export type OnToolTechnicalError = (toolName: string, error: unknown) => void;

/**
 * Builds the MCP server `opspilot`, publishing `MCP_TOOL_NAMES` over the
 * same tool definitions the internal agent uses (006-mcp-server, R-002) —
 * no description, schema or execution is redeclared here. Pure
 * composition: no transport, no environment, no I/O (Principle I). The
 * entry point (`server.ts`) supplies the store and the transport.
 */
export function createOpsMcpServer(
  store: OpsRepository,
  deps: { fetchImpl?: typeof fetch; onToolTechnicalError?: OnToolTechnicalError } = {},
): McpServer {
  const definitions = defineOpsTools(store, { fetchImpl: deps.fetchImpl });

  const server = new McpServer({ name: "opspilot", version: pkg.version });

  for (const name of MCP_TOOL_NAMES) {
    const definition = definitions[name];
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.schema },
      async (args: Parameters<typeof definition.run>[0]) => {
        try {
          // The cast below is the one spot in this file that needs it: the
          // SDK's `registerTool` callback is contravariant over the union
          // of the 4 possible argument shapes (one per tool in
          // MCP_TOOL_NAMES), which TypeScript collapses into their
          // intersection for a call site inside a loop. The value itself
          // was already validated by the SDK against `definition.schema`
          // just above, so this narrows nothing at runtime.
          const outcome = await definition.run(args as never);
          return {
            content: [{ type: "text" as const, text: outcome.text }],
            isError: outcome.isError,
          };
        } catch (error) {
          // Not a DomainError (those are already ToolOutcome.isError above)
          // — a technical failure. Report it for stderr (FR-014), then
          // re-throw so the SDK converts it into an `isError` result
          // without ending the session (research R-004).
          deps.onToolTechnicalError?.(definition.name, error);
          throw error;
        }
      },
    );
  }

  return server;
}
