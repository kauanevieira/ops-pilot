import { baselineState } from "../store/seed.ts";
import type { Service } from "../domain/schemas.ts";
import type { WorldState } from "../store/types.ts";

/**
 * `catalog` isn't part of the canonical 5-service seed
 * (001-reasoning-core, FR-019/FR-020) — adding it there would change that
 * feature's documented baseline for everyone. Scoped here instead: only
 * the bench scenarios see it, because C2 needs a third real service to
 * open an incident against.
 */
const CATALOG_SERVICE: Service = { id: "catalog", name: "Catalog" };

export function benchBaselineState(): WorldState {
  const base = baselineState();
  return { ...base, services: [...base.services, CATALOG_SERVICE] };
}

export interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  /**
   * Correctness is checked against the final STORE STATE after the run,
   * never the answer text: deterministic and offline-checkable, at the
   * cost of not verifying prose the agent might also get wrong (e.g. C1's
   * spoken count of critical alerts isn't scored, only its side effects).
   */
  readonly check: (initial: WorldState, final: WorldState) => boolean;
}

function checkDireto(initial: WorldState, final: WorldState): boolean {
  // Read-only question: the correct behavior leaves the store untouched.
  return final.incidents.length === initial.incidents.length;
}

// The prompt never spells out what "sev2" means in terms of our severity
// enum (critical | high | medium | low) — interpreting it correctly is
// part of what's scored. Mapped here to the on-call convention this
// scenario borrows from: SEV1=critical, SEV2=high, SEV3=medium, SEV4=low.
const SEV2_SEVERITY = "high";

function checkEstruturado(initial: WorldState, final: WorldState): boolean {
  const created = final.incidents.slice(initial.incidents.length);
  if (created.length !== 3) return false;

  const expectedOrder = ["checkout", "payments", "catalog"];
  const inOrder = created.every((incident, i) => incident.serviceId === expectedOrder[i]);
  const rightSeverity = created.every((incident) => incident.severity === SEV2_SEVERITY);
  const firstResolved = created[0]?.status === "resolved";
  const othersStillOpen = created[1]?.status === "open" && created[2]?.status === "open";

  return inOrder && rightSeverity && firstResolved && othersStillOpen;
}

function checkDinamico(initial: WorldState, final: WorldState): boolean {
  const oldestFiring = initial.alerts
    .filter((alert) => alert.status === "firing")
    .slice()
    .sort((a, b) => a.firedAt.getTime() - b.firedAt.getTime())[0];
  if (!oldestFiring) return false;

  const created = final.incidents.slice(initial.incidents.length);
  if (created.length !== 1) return false;

  return created[0]!.serviceId === oldestFiring.serviceId && created[0]!.status === "open";
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "C1",
    label: "direto",
    prompt: "quantos alertas críticos estão disparando?",
    check: checkDireto,
  },
  {
    id: "C2",
    label: "estruturado",
    prompt:
      "abra três incidentes sev2 para checkout, payment e catalog, nessa mesma ordem, e resolva o primeiro.",
    check: checkEstruturado,
  },
  {
    id: "C3",
    label: "dinâmico",
    prompt: "dos alertas disparando, abra um incidente para o mais antigo e diga quantos sobraram",
    check: checkDinamico,
  },
];
