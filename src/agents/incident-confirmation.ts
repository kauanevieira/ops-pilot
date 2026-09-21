import { z } from "zod";
import { incidentStatusSchema, severitySchema } from "../domain/schemas.ts";
import type { ReasoningStrategy, RunOptions } from "./types.ts";
import type { StrategyResult, TraceEvent } from "../trace/types.ts";

/**
 * Amendment to 004-sqlite-persistence, found in live use (not in tests —
 * Principle V forbids tests that call the model, so this class of bug is
 * invisible to the suite by construction).
 *
 * `open_incident`'s tool observation always carries the real incident
 * (id, title, service, severity, status) as JSON. What reaches whoever is
 * on call is the model's own natural-language *synthesis* of that JSON —
 * and synthesis is free re-generation, not a guaranteed echo. Reinforcing
 * the tool's description ("always state id, title, service, severity,
 * status") was tried first and made things WORSE: across three live runs,
 * two produced a plausible-looking but fabricated id (wrong separator,
 * one a repeating placeholder pattern) instead of the real one. Asking a
 * probabilistic model to "always include X" does not stop it from
 * inventing X when it doesn't actually attend to the tool's output.
 *
 * The guarantee has to come from code, not from a nicer prompt: after a
 * strategy run, re-parse the actual `open_incident` observations from the
 * trace and, if the model's answer doesn't already quote the real id
 * verbatim, REPLACE the answer with a deterministic confirmation built
 * straight from that JSON. Replacing (not appending) is deliberate — with
 * a wrong id sitting next to a right one, whoever is on call has no way to
 * tell which to trust; only one id must ever be visible.
 */

const incidentConfirmationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  serviceId: z.string().min(1),
  severity: severitySchema,
  status: incidentStatusSchema,
});

type IncidentConfirmation = z.infer<typeof incidentConfirmationSchema>;

/**
 * Every `open_incident` observation in the trace that parsed as a real
 * incident record — the tool's error path (`{"error": "..."}`) fails this
 * schema on its own, so no special-casing of failure is needed here.
 */
function successfulIncidentCreations(trace: readonly TraceEvent[]): IncidentConfirmation[] {
  const incidents: IncidentConfirmation[] = [];
  for (const event of trace) {
    if (event.type !== "observation" || event.tool !== "open_incident") continue;
    try {
      incidents.push(incidentConfirmationSchema.parse(JSON.parse(event.content)));
    } catch {
      // Not a successful creation (domain error observation, or malformed) — skip.
    }
  }
  return incidents;
}

function formatConfirmation(incident: IncidentConfirmation): string {
  return (
    "Incidente aberto com sucesso:\n" +
    `- ID: ${incident.id}\n` +
    `- Título: ${incident.title}\n` +
    `- Serviço: ${incident.serviceId}\n` +
    `- Severidade: ${incident.severity}\n` +
    `- Status: ${incident.status}`
  );
}

/**
 * Pure — takes the trace and the model's answer, returns the answer to
 * actually show. If no incident was opened this run, or the model's
 * answer already quotes every opened incident's real id, the answer is
 * returned unchanged. Otherwise it's replaced entirely by a deterministic
 * block built from the tool's own JSON, one per incident opened.
 */
export function ensureIncidentConfirmation(trace: readonly TraceEvent[], answer: string): string {
  const incidents = successfulIncidentCreations(trace);
  if (incidents.length === 0) return answer;

  const allIdsQuotedVerbatim = incidents.every((incident) => answer.includes(incident.id));
  if (allIdsQuotedVerbatim) return answer;

  return incidents.map(formatConfirmation).join("\n\n");
}

/**
 * Wraps a strategy so every `run()` gets this guarantee — applied at the
 * base-factory level (agents/index.ts), before an optional
 * `withReflection` wrap, so a reflection cycle's critic judges the
 * already-corrected answer rather than a possibly-fabricated one.
 */
export function withIncidentConfirmation(strategy: ReasoningStrategy): ReasoningStrategy {
  return {
    name: strategy.name,
    async run(input: string, options?: RunOptions): Promise<StrategyResult> {
      const result = await strategy.run(input, options);
      return { ...result, answer: ensureIncidentConfirmation(result.trace, result.answer) };
    },
  };
}
