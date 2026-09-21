import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { ClientTool } from "@langchain/core/tools";
import type { OpsToolDefinition, ToolOutcome } from "../agents/tool-definitions.ts";
import type { MemoryStore } from "./memory-store.ts";

/**
 * Memory tool definitions, kept OUTSIDE `tool-definitions.ts` on purpose
 * (008-semantic-memory, R-014): `MCP_TOOL_NAMES` in
 * `src/mcp/ops-mcp-server.ts` is typed as `OpsToolName[]`, derived from
 * `defineOpsTools`'s return type — a tool that isn't defined there simply
 * cannot be named in that list without a compile error. FR-019 (never
 * exposed over MCP, which has no concept of a user) is a structural
 * guarantee, not a discipline to remember.
 *
 * 009-learning-reflector, FR-016/FR-017: `remember_fact` no longer exists.
 * Learning is entirely the reflector's job now (learning-reflector.ts),
 * running after each successful response — the agent itself never decides
 * to save a fact. `forget_fact` is renamed `forget_preference`, same
 * behavior, only the name and description changed
 * (contracts/memory-tools.md).
 *
 * `userId` is closed over at creation time, never a schema field
 * (FR-028 from 008): the model has no argument through which it could name
 * a different user, because there isn't one.
 */
const forgetPreferenceSchema = z.object({
  memoryId: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Identificador do fato, exatamente como aparece entre colchetes em 'Fatos lembrados' " +
        "(ex.: 'mem-3f2a…').",
    ),
});

/**
 * Builds `forget_preference` scoped to one `userId`
 * (contracts/memory-tools.md, emenda da 009). Built per request, from the
 * HTTP handler — never registered in `agents/index.ts`, which stays
 * unaware memory exists (same principle as `withConversationHistory` in
 * 007).
 */
export function defineMemoryTools(memoryStore: MemoryStore, userId: string) {
  const forgetPreference: OpsToolDefinition<typeof forgetPreferenceSchema> = {
    name: "forget_preference",
    description:
      "Apaga um fato lembrado sobre o plantonista, para que não seja mais usado. Use quando a " +
      "pessoa pedir para esquecer algo ou disser que um fato lembrado está errado ou " +
      "desatualizado. O memoryId é o identificador entre colchetes na seção 'Fatos lembrados' " +
      "deste pedido; só é possível esquecer fatos que apareceram ali. NÃO use para guardar nem " +
      "corrigir fatos: guardar é automático — o que a pessoa disser de novo sobre si nesta " +
      "mensagem é aprendido depois da resposta, sem ferramenta. NÃO use para estado " +
      "operacional (alertas, incidentes): eles não ficam na memória. Devolve JSON " +
      "{ forgotten: true } quando o fato foi apagado, ou { forgotten: false } quando nenhum " +
      "fato com esse id pertence a esta pessoa — já esquecido, inexistente ou de outra pessoa.",
    schema: forgetPreferenceSchema,
    async run({ memoryId }): Promise<ToolOutcome> {
      const forgotten = memoryStore.forget(userId, memoryId);
      return { text: JSON.stringify({ forgotten }), isError: !forgotten };
    },
  };

  return { forget_preference: forgetPreference };
}

/**
 * LangChain adapter (same translation pattern as `tools.ts`): a
 * `ToolOutcome` becomes the plain string `tool()` expects. Returned as an
 * array of `ClientTool` — exactly `RunOptions.extraTools`'s element type
 * (agents/types.ts, R-011) — so the HTTP handler can spread it straight in.
 */
export function createMemoryTools(memoryStore: MemoryStore, userId: string): ClientTool[] {
  const defs = defineMemoryTools(memoryStore, userId);

  const forgetPreference = tool(async (args) => (await defs.forget_preference.run(args)).text, {
    name: defs.forget_preference.name,
    description: defs.forget_preference.description,
    schema: defs.forget_preference.schema,
  });

  return [forgetPreference];
}
