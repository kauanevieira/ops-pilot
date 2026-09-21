import { z } from "zod";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { createModel } from "./model.ts";
import type { StrategyResult } from "../trace/types.ts";

/** Structured output for the critic (FR-009, R-003). */
export const critiqueSchema = z.object({
  approved: z.boolean(),
  feedback: z
    .string()
    .describe(
      "se reprovado: o que está errado e o que falta corrigir, em específico e acionável, para orientar a próxima tentativa",
    ),
});
export type Critique = z.infer<typeof critiqueSchema>;

/**
 * What the critic is given to judge a single attempt (FR-008). Built by
 * `buildCritiqueContext`, a pure function, so the whole reflection cycle
 * stays testable offline (R-004).
 */
export interface CritiqueContext {
  input: string;
  answer: string;
  observations: { tool?: string; content: string; isError?: boolean }[];
  actions: { tool: string; args: Record<string, unknown> }[];
}

/**
 * `callbacks` lets the caller (the reflection decorator) attribute this
 * invocation's chat-model calls to its own per-run LlmCallCounter (FR-022,
 * R-008), the same way `.stream`/`.invoke` already take `callbacks`
 * elsewhere in `agents/`. A critic that makes no real model call (e.g. a
 * test fake) is free to ignore the array — it then correctly contributes 0
 * calls to the run's metrics.
 */
export type Critic = (context: CritiqueContext, callbacks: BaseCallbackHandler[]) => Promise<Critique>;

/**
 * Pure extraction of what the critic needs from a completed attempt
 * (FR-008, R-004). `input` is always the ORIGINAL request — as passed into
 * this reflection cycle — never the feedback-enriched one used to
 * regenerate; the critic judges against what the person actually asked
 * for. When `withConversationHistory` wraps this strategy from the
 * outside (007-persistent-conversation, R-008), that "original request"
 * already includes the conversation's history text, which is what lets
 * the critic correctly judge a context-dependent follow-up instead of
 * rejecting it for lacking a referent.
 */
export function buildCritiqueContext(input: string, result: StrategyResult): CritiqueContext {
  const observations: CritiqueContext["observations"] = [];
  const actions: CritiqueContext["actions"] = [];

  for (const event of result.trace) {
    if (event.type === "observation") {
      observations.push({ tool: event.tool, content: event.content, isError: event.isError });
    } else if (event.type === "action") {
      actions.push({ tool: event.tool, args: event.args });
    }
  }

  return { input, answer: result.answer, observations, actions };
}

const CRITIC_PROMPT =
  "Você é o crítico de um copiloto de plantão de operações. Avalie a resposta APENAS contra o " +
  "pedido e as observações do rastro de execução — nunca contra conhecimento próprio sobre o " +
  "que 'deveria' estar acontecendo. Reprove quando: (1) a resposta contradiz alguma observação; " +
  "(2) a resposta afirma um fato operacional (alerta, incidente, serviço, estado) que nenhuma " +
  "observação sustenta, inclusive quando não há observação alguma; (3) a resposta não atende, " +
  "ou atende só em parte, ao que foi pedido. Não reprove por estilo, tom ou verbosidade. Quando " +
  "reprovar, o feedback deve dizer especificamente o que falta ou o que está errado, de forma " +
  "acionável para a próxima tentativa.";

function formatObservations(observations: CritiqueContext["observations"]): string {
  if (observations.length === 0) return "(nenhuma observação registrada)";
  return observations
    .map((o) => `- ${o.tool ? `[${o.tool}] ` : ""}${o.isError ? "(erro) " : ""}${o.content}`)
    .join("\n");
}

function formatActions(actions: CritiqueContext["actions"]): string {
  if (actions.length === 0) return "(nenhuma ação executada)";
  return actions.map((a) => `- ${a.tool} ${JSON.stringify(a.args)}`).join("\n");
}

/**
 * Default critic: same model factory as the rest of the system, no model
 * config of its own (FR-007), judging with structured output (R-003). No
 * tools, no store access — it judges only with what's in the context
 * (assumption). `callbacks` is forwarded to `.invoke` so the caller can
 * attribute this call to its own metrics (FR-022, R-008).
 */
export function createLlmCritic(): Critic {
  return async (context, callbacks) => {
    return createModel()
      .withStructuredOutput<Critique>(critiqueSchema)
      .invoke(
        [
          ["system", CRITIC_PROMPT],
          [
            "user",
            `Pedido: ${context.input}\n` +
              `Ações executadas:\n${formatActions(context.actions)}\n` +
              `Observações:\n${formatObservations(context.observations)}\n` +
              `Resposta: ${context.answer}`,
          ],
        ],
        { callbacks },
      );
  };
}
