import { z } from "zod";

/** Structured output for the planner node (FR-024, R-005). */
export const planSchema = z.object({
  steps: z.array(z.string().min(1)).min(1),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * Structured output for the replanner node: either the remaining steps, or
 * a final response when nothing is left (FR-025, FR-027).
 */
export const replanSchema = z.object({
  remainingSteps: z.array(z.string().min(1)),
  response: z.string().nullable(),
});
export type Replan = z.infer<typeof replanSchema>;
