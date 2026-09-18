import { LlmCallCounter } from "./llm-counter.ts";
import { buildCritiqueContext, createLlmCritic, type Critic, type Critique } from "./critic.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StoppedReason, StrategyResult, TraceEvent } from "../trace/types.ts";

/** FR-004: with no explicit configuration, the cycle allows 2 reflections. */
export const DEFAULT_MAX_REFLECTIONS = 2;

export interface ReflectionOptions {
  /** Inteiro >= 0. `0` desliga a revisão inteira (FR-016, R-010). */
  maxReflections?: number;
  /** Ponto de injeção — não exposto na arena (R-004). */
  critic?: Critic;
}

function critiqueEvent(content: string): TraceEvent {
  return { type: "critique", content };
}

/**
 * Builds the feedback-enriched input for a regeneration (FR-012, R-002).
 * Re-runs the base strategy from scratch, but tells it what was already
 * done — including which actions already had side effects — so it doesn't
 * blindly repeat them. This is mitigation by context, not a domain
 * guarantee: nothing stops the model from opening a duplicate incident
 * anyway (R-002's documented limitation).
 */
function enrichInput(originalInput: string, previousAttempt: StrategyResult, critique: Critique): string {
  const actions = previousAttempt.trace.filter(
    (event): event is Extract<TraceEvent, { type: "action" }> => event.type === "action",
  );
  const observations = previousAttempt.trace.filter(
    (event): event is Extract<TraceEvent, { type: "observation" }> => event.type === "observation",
  );

  const actionsLog = actions.length
    ? actions
        .map((action, i) => `- ${action.tool}(${JSON.stringify(action.args)}) -> ${observations[i]?.content ?? "(sem observação registrada)"}`)
        .join("\n")
    : "(nenhuma ação foi executada na tentativa anterior)";

  return [
    `Pedido original do plantonista: ${originalInput}`,
    "",
    "Uma tentativa anterior respondeu:",
    previousAttempt.answer,
    "",
    "Essa resposta foi reprovada em revisão pelo seguinte motivo:",
    critique.feedback,
    "",
    "Ações já executadas na tentativa anterior, com o que cada uma observou (trate como fato consumado; NÃO repita nenhuma ação que já teve efeito, como abrir ou resolver um incidente):",
    actionsLog,
    "",
    "Gere uma nova resposta que corrija o problema apontado, reutilizando o que já foi observado sempre que possível e só acionando ferramentas para o que ainda falta.",
  ].join("\n");
}

/**
 * Decorates any ReasoningStrategy with a critique-and-regenerate cycle
 * (FR-001, FR-002): runs the base, has a critic judge the answer against
 * the attempt's own trace observations, and — on rejection — re-runs the
 * base with the critic's feedback in context, until approval or
 * `maxReflections` is exhausted. Never modifies the base strategy (FR-001).
 */
export function withReflection(strategy: ReasoningStrategy, options?: ReflectionOptions): ReasoningStrategy {
  const maxReflections = options?.maxReflections ?? DEFAULT_MAX_REFLECTIONS;
  const critic = options?.critic ?? createLlmCritic();

  return {
    name: `reflect:${strategy.name}`,

    async run(input: string, runOptions?: RunOptions): Promise<StrategyResult> {
      const started = Date.now();

      // Tentativa 1. `runOptions` é repassado íntegro — o orçamento de
      // iterações vale por tentativa, não é dividido (FR-005).
      let attempt = await strategy.run(input, runOptions);

      // FR-016, R-010: maxReflections=0 é atalho puro — sem revisão, sem
      // chamada extra, sem tocar no resultado da base.
      if (maxReflections <= 0) {
        return attempt;
      }

      const trace: TraceEvent[] = [...attempt.trace];
      let llmCalls = attempt.metrics.llmCalls;
      let stoppedReason: StoppedReason = attempt.stoppedReason;
      const critiqueCounter = new LlmCallCounter();

      for (let reflection = 0; reflection < maxReflections; reflection += 1) {
        let verdict: Critique;
        try {
          verdict = await critic(buildCritiqueContext(input, attempt), [critiqueCounter]);
        } catch {
          // FR-017, R-009: falha do crítico é fail-open — entrega a
          // resposta corrente, nunca propaga como erro de `run`.
          trace.push(critiqueEvent("indisponível: a revisão falhou e não pôde ser concluída"));
          llmCalls += critiqueCounter.calls;
          return {
            answer: attempt.answer,
            trace,
            metrics: { llmCalls, latencyMs: Date.now() - started },
            stoppedReason,
          };
        }

        trace.push(critiqueEvent(`${verdict.approved ? "aprovado" : "reprovado"}: ${verdict.feedback}`));

        if (verdict.approved) {
          llmCalls += critiqueCounter.calls;
          return {
            answer: attempt.answer,
            trace,
            metrics: { llmCalls, latencyMs: Date.now() - started },
            stoppedReason,
          };
        }

        // FR-020, R-006: um pedido HTTP cancelado (timeout ou desistência do
        // cliente) não deve disparar mais uma tentativa cara — encerra o
        // ciclo com o que já foi produzido, em vez de iniciar uma
        // regeneração que só seria descartada.
        if (runOptions?.signal?.aborted) {
          llmCalls += critiqueCounter.calls;
          return {
            answer: attempt.answer,
            trace,
            metrics: { llmCalls, latencyMs: Date.now() - started },
            stoppedReason,
          };
        }

        // FR-012: regenera com o feedback no contexto (R-002).
        const isLastReflection = reflection === maxReflections - 1;
        attempt = await strategy.run(enrichInput(input, attempt, verdict), runOptions);
        trace.push(...attempt.trace);
        llmCalls += attempt.metrics.llmCalls;
        // FR-015: reflexões esgotadas sem aprovação prevalece sobre o
        // stoppedReason da própria tentativa.
        stoppedReason = isLastReflection ? "max-reflections" : attempt.stoppedReason;
      }

      llmCalls += critiqueCounter.calls;
      return {
        answer: attempt.answer,
        trace,
        metrics: { llmCalls, latencyMs: Date.now() - started },
        stoppedReason,
      };
    },
  };
}
