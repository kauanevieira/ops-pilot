import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { ClientTool } from "@langchain/core/tools";
import { memoryFactSchema } from "../domain/schemas.ts";
import type { OpsToolDefinition, ToolOutcome } from "../agents/tool-definitions.ts";
import type { MemoryStore } from "./memory-store.ts";

/**
 * Memory tool definitions, kept OUTSIDE `tool-definitions.ts` on purpose
 * (008-semantic-memory, R-014): `MCP_TOOL_NAMES` in
 * `src/mcp/ops-mcp-server.ts` is typed as `OpsToolName[]`, derived from
 * `defineOpsTools`'s return type — a tool that isn't defined there simply
 * cannot be named in that list without a compile error. FR-031 (never
 * exposed over MCP, which has no concept of a user) is a structural
 * guarantee, not a discipline to remember.
 *
 * `userId` is closed over at creation time, never a schema field
 * (FR-028): the model has no argument through which it could name a
 * different user, because there isn't one.
 */
const rememberFactSchema = z.object({
  fact: memoryFactSchema.describe(
    "O fato em uma frase curta e autocontida, em terceira pessoa ou primeira pessoa do " +
      "plantonista (ex.: 'É responsável pelo serviço checkout'). Até 500 caracteres.",
  ),
});

const forgetFactSchema = z.object({
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
 * Builds `remember_fact` and `forget_fact` scoped to one `userId`
 * (contracts/memory-tools.md). Built per request, from the HTTP handler —
 * never registered in `agents/index.ts`, which stays unaware memory
 * exists (FR-022, same principle as `withConversationHistory` in 007).
 */
export function defineMemoryTools(memoryStore: MemoryStore, userId: string) {
  const rememberFact: OpsToolDefinition<typeof rememberFactSchema> = {
    name: "remember_fact",
    description:
      "Guarda um fato duradouro sobre o plantonista para ser lembrado em conversas futuras. Use " +
      "quando a pessoa pedir explicitamente para você lembrar algo ('lembra que…', 'guarda isso') " +
      "ou quando ela afirmar algo estável sobre si ou sobre como trabalha — serviços pelos quais " +
      "responde, time, preferências de resposta. NÃO use para estado operacional (alertas, " +
      "incidentes, status de serviço): isso muda e já tem ferramentas próprias; NÃO use para " +
      "repetir fatos que já apareceram em 'Fatos lembrados' neste pedido. Devolve JSON " +
      "{ memoryId, fact, created }: created: true quando o fato foi guardado; created: false " +
      "quando já existia um fato equivalente — nesse caso fact é o texto que já estava guardado, " +
      "e nada novo foi gravado.",
    schema: rememberFactSchema,
    async run({ fact }): Promise<ToolOutcome> {
      const result = await memoryStore.remember(userId, fact);
      return { text: JSON.stringify(result), isError: false };
    },
  };

  const forgetFact: OpsToolDefinition<typeof forgetFactSchema> = {
    name: "forget_fact",
    description:
      "Apaga um fato lembrado sobre o plantonista, para que não seja mais usado. Use quando a " +
      "pessoa pedir para esquecer algo ou disser que um fato lembrado está errado ou desatualizado. " +
      "O memoryId é o identificador entre colchetes na seção 'Fatos lembrados' deste pedido; só é " +
      "possível esquecer fatos que apareceram ali. NÃO use para corrigir um fato mantendo-o: " +
      "esqueça o antigo e guarde o novo com remember_fact. Devolve JSON { forgotten: true } quando " +
      "o fato foi apagado, ou { forgotten: false } quando nenhum fato com esse id pertence a esta " +
      "pessoa — já esquecido, inexistente ou de outra pessoa.",
    schema: forgetFactSchema,
    async run({ memoryId }): Promise<ToolOutcome> {
      const forgotten = memoryStore.forget(userId, memoryId);
      return { text: JSON.stringify({ forgotten }), isError: !forgotten };
    },
  };

  return { remember_fact: rememberFact, forget_fact: forgetFact };
}

/**
 * LangChain adapter (same translation pattern as `tools.ts`): a
 * `ToolOutcome` becomes the plain string `tool()` expects. Returned as an
 * array of `ClientTool` — exactly `RunOptions.extraTools`'s element type
 * (agents/types.ts, R-011) — so the HTTP handler can spread it straight in.
 */
export function createMemoryTools(memoryStore: MemoryStore, userId: string): ClientTool[] {
  const defs = defineMemoryTools(memoryStore, userId);

  const rememberFact = tool(async (args) => (await defs.remember_fact.run(args)).text, {
    name: defs.remember_fact.name,
    description: defs.remember_fact.description,
    schema: defs.remember_fact.schema,
  });

  const forgetFact = tool(async (args) => (await defs.forget_fact.run(args)).text, {
    name: defs.forget_fact.name,
    description: defs.forget_fact.description,
    schema: defs.forget_fact.schema,
  });

  return [rememberFact, forgetFact];
}
