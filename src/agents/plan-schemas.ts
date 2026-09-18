import { z } from "zod";

/** Structured output for the planner node (FR-024, R-005). */
export const planSchema = z.object({
  steps: z
    .array(z.string().min(1))
    .describe("passos curtos, ordenados, executáveis com as ferramentas disponíveis"),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * Structured output for the replanner node (FR-025, FR-027): it must choose
 * one of three decisions — adjust the remaining plan, keep going as-is, or
 * end with a final answer.
 */
export const replanSchema = z.object({
  decision: z.enum(["ajustar", "seguir", "encerrar"]),
  plan: z
    .array(z.string().min(1))
    .default([])
    .describe("novo plano de passos restantes, usado apenas quando decision = ajustar"),
  answer: z.string().nullable().default(null).describe("resposta final, usada apenas quando decision = encerrar"),
});
export type Replan = z.infer<typeof replanSchema>;
