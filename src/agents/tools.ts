import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DomainError } from "../domain/errors.ts";
import { severitySchema } from "../domain/schemas.ts";
import type { OpsRepository } from "../store/repository.ts";

/**
 * Tools are built from a repository instance rather than a module-level
 * singleton, so the arena (US3) can give each strategy run its own
 * freshly-seeded state without runs interfering with each other (FR-030).
 */
export function createOpsTools(store: OpsRepository) {
  const listAlerts = tool(
    async ({ status }) => {
      const alerts = status === "all" ? store.listAlerts() : store.listAlerts(status);
      return JSON.stringify(alerts);
    },
    {
      name: "list_alerts",
      description:
        "Lista os alertas de monitoramento. Use quando o plantonista perguntar o que está disparando, o estado dos serviços ou 'como está o plantão.' status: firing | resolved | all",
      schema: z.object({
        status: z.enum(["firing", "resolved", "all"]).default("firing"),
      }),
    },
  );

  const openIncident = tool(
    async ({ title, service, severity }) => {
      try {
        const incident = store.openIncident({ title, serviceId: service, severity });
        return JSON.stringify(incident);
      } catch (error) {
        if (error instanceof DomainError) {
          return JSON.stringify({ error: error.message });
        }
        throw error;
      }
    },
    {
      name: "open_incident",
      description:
        "Abre um novo incidente para um serviço. Use quando o plantonista pedir para registrar/abrir um incidente a partir de um alerta.",
      schema: z.object({
        title: z.string().min(1),
        service: z.string().min(1),
        severity: severitySchema,
      }),
    },
  );

  const resolveIncident = tool(
    async ({ id }) => {
      try {
        const incident = store.resolveIncident(id);
        return JSON.stringify(incident);
      } catch (error) {
        if (error instanceof DomainError) {
          return JSON.stringify({ error: error.message });
        }
        throw error;
      }
    },
    {
      name: "resolve_incident",
      description: "Resolve um incidente aberto, dado o seu id.",
      schema: z.object({
        id: z.string().min(1),
      }),
    },
  );

  return [listAlerts, openIncident, resolveIncident];
}
