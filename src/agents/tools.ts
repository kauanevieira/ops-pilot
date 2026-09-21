import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DomainError, RunbookNotFoundError, ServiceNotFoundError } from "../domain/errors.ts";
import { severitySchema } from "../domain/schemas.ts";
import type { OpsRepository } from "../store/repository.ts";
import { checkProviderStatus, formatProviderStatus, providerSchema } from "./provider-status.ts";

/**
 * Tools are built from a repository instance rather than a module-level
 * singleton, so the arena (US3) can give each strategy run its own
 * freshly-seeded state without runs interfering with each other (FR-030).
 *
 * Every description below follows the constitution's 6 rules (Principle
 * IV, contracts/ops-tools.md): (1) what it does, (2) when to use it, (3)
 * when NOT to, (4) what it returns — including the empty case, (5) every
 * field has its own `.describe()`, (6) closed sets are enums.
 *
 * `deps.fetchImpl` (005-provider-status-tool, R-007) is the one thing this
 * factory takes beyond the store — an optional override with a
 * `globalThis.fetch` default, so tests inject a fake fetch exactly where
 * they already call this factory, without threading a fetcher through the
 * strategy chain (`BASE_FACTORIES` → `createStrategy` → `resolveStrategy`),
 * which is public contract of the 003 HTTP layer.
 */
export function createOpsTools(store: OpsRepository, deps: { fetchImpl?: typeof fetch } = {}) {
  const listAlerts = tool(
    async ({ status }) => {
      const alerts = status === "all" ? store.listAlerts() : store.listAlerts(status);
      return JSON.stringify(alerts);
    },
    {
      name: "list_alerts",
      description:
        "Lista os alertas emitidos pelo monitoramento. Use quando o pedido for sobre o que está " +
        "disparando agora, o estado dos serviços ou 'como está o plantão'. Não use para incidentes " +
        "registrados por pessoas — alerta é sinal automático do monitoramento, incidente é trabalho " +
        "aberto por alguém; para esses, use list_incidents. Também não use para saber se um provedor " +
        "externo está fora do ar: alerta é o nosso monitoramento sobre os nossos serviços; para o " +
        "estado de um provedor, use check_provider_status. Devolve a lista de alertas com id, serviço, " +
        "resumo, severidade, status e horário em que disparou, em ordem cronológica; devolve lista " +
        "vazia quando nenhum alerta corresponde ao filtro.",
      schema: z.object({
        status: z
          .enum(["firing", "resolved", "all"])
          .default("firing")
          .describe(
            "Filtra por status do alerta: firing (disparando agora), resolved (já normalizado) ou all (todos). Padrão: firing.",
          ),
      }),
    },
  );

  const listIncidents = tool(
    async ({ status }) => {
      const incidents = status === "all" ? store.listIncidents() : store.listIncidents(status);
      return JSON.stringify(incidents);
    },
    {
      name: "list_incidents",
      description:
        "Lista os incidentes registrados, filtrados por status. Use quando o pedido for sobre o que " +
        "já foi registrado, o que continua em aberto ou o que já foi resolvido — inclusive para " +
        "descobrir o id de um incidente antes de resolvê-lo. Não use para saber o que o monitoramento " +
        "está acusando: isso é list_alerts. Devolve a lista de incidentes com id, título, serviço, " +
        "severidade, status, horário de abertura e de resolução; devolve lista vazia quando não há " +
        "incidente no status pedido.",
      schema: z.object({
        status: z
          .enum(["open", "resolved", "all"])
          .default("open")
          .describe(
            "Filtra por status do incidente: open (ainda em aberto), resolved (já resolvido) ou all (todos). Padrão: open.",
          ),
      }),
    },
  );

  const consultarRunbook = tool(
    async ({ service }) => {
      try {
        // Checked before the runbook itself (FR-029a): "no runbook for this
        // service" and "this service doesn't exist" are different messages
        // to whoever is on call, and collapsing them would make the model
        // suggest correcting a name that was right all along.
        if (!store.findService(service)) {
          throw new ServiceNotFoundError(service);
        }
        const runbook = store.findRunbook(service);
        if (!runbook) {
          throw new RunbookNotFoundError(service);
        }
        return JSON.stringify(runbook);
      } catch (error) {
        if (error instanceof DomainError) {
          return JSON.stringify({ error: error.message });
        }
        throw error;
      }
    },
    {
      name: "consultar_runbook",
      description:
        "Devolve o procedimento de resposta (runbook) escrito para um serviço. Use quando o pedido " +
        "for sobre o que fazer diante de um problema: como investigar, quais passos seguir, qual o " +
        "procedimento padrão daquele serviço. Não use para saber o que está acontecendo (list_alerts) " +
        "nem para registrar trabalho (open_incident). Devolve o título e os passos na ordem em que " +
        "devem ser seguidos; quando o serviço existe mas não tem runbook escrito, diz isso " +
        "explicitamente, em vez de devolver passos vazios.",
      schema: z.object({
        service: z
          .string()
          .min(1)
          .describe(
            "Id do serviço cujo runbook se quer consultar, em formato de slug minúsculo (ex.: checkout, payments, auth). Use list_alerts para descobrir os ids disponíveis.",
          ),
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
        "Abre um novo incidente para um serviço. Use quando o pedido for explicitamente para " +
        "registrar, abrir ou criar um incidente — normalmente a partir de um alerta que está " +
        "disparando. Não use para consultar o que já existe (list_incidents) nem para responder " +
        "perguntas sobre o estado dos serviços (list_alerts): esta ferramenta escreve, e abrir um " +
        "incidente que ninguém pediu é trabalho que alguém vai ter que resolver depois. Um pedido por " +
        "si só não é motivo para abrir; o pedido precisa dizer para abrir. Devolve o incidente criado, " +
        "com o id gerado e status 'open'.",
      schema: z.object({
        title: z
          .string()
          .min(1)
          .describe(
            "Título curto do incidente, descrevendo o problema como quem está de plantão o relataria. Ex.: 'Erro 500 no checkout acima do limiar'.",
          ),
        service: z
          .string()
          .min(1)
          .describe(
            "Id do serviço afetado, em formato de slug minúsculo (ex.: checkout, payments, auth). Precisa ser um serviço existente — use list_alerts para descobrir os ids.",
          ),
        severity: severitySchema.describe(
          "Gravidade do incidente: critical (impacto total), high (impacto grave), medium (degradação), low (menor). Não há padrão — escolha a partir do que o pedido descreve.",
        ),
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
      description:
        "Marca um incidente já aberto como resolvido. Use quando o pedido disser que o problema foi " +
        "corrigido, normalizado ou encerrado, e você souber o id do incidente. Não use sem o id — " +
        "descubra-o antes com list_incidents, e não invente um. Não use para fechar alertas: alerta " +
        "não se resolve por ferramenta. Devolve o incidente atualizado, com status 'resolved' e o " +
        "horário da resolução.",
      schema: z.object({
        id: z
          .string()
          .min(1)
          .describe(
            "Id do incidente a resolver, como devolvido por open_incident ou list_incidents (formato inc-<uuid>). Não invente: consulte list_incidents se não tiver o id.",
          ),
      }),
    },
  );

  const checkProviderStatusTool = tool(
    async ({ provider }) => {
      const result = await checkProviderStatus(provider, { fetchImpl: deps.fetchImpl });
      return formatProviderStatus(result);
    },
    {
      name: "check_provider_status",
      description:
        "Consulta a página pública de status de um provedor externo e diz se ele está operando " +
        "normalmente. Use quando houver suspeita de que o problema vem de fora — 'é o nosso ou é do " +
        "provedor?', 'o GitHub está fora?', uma dependência externa que parou de responder, um deploy " +
        "ou um login que falha sem alerta interno correspondente. Não use para o que o nosso " +
        "monitoramento está acusando (list_alerts) nem para o que foi registrado pelo plantão " +
        "(list_incidents): esta ferramenta olha para fora, e o que ela devolve é o que o provedor " +
        "publica sobre si, não o estado dos nossos serviços. Devolve uma linha com o nível do estado e " +
        "a descrição publicada pelo provedor; quando o provedor não responde ou responde fora do " +
        "formato esperado, devolve uma linha dizendo que o status não pôde ser confirmado — que não " +
        "deve ser lida como 'está tudo bem'.",
      schema: z.object({
        provider: providerSchema
          .default("github")
          .describe(
            "Provedor externo cuja página pública de status será consultada: github ou cloudflare. Padrão: github.",
          ),
      }),
    },
  );

  return [listAlerts, listIncidents, consultarRunbook, openIncident, resolveIncident, checkProviderStatusTool];
}
