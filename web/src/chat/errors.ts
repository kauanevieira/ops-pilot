import type { ChatOutcome } from "../api/client.ts";

export interface DisplayError {
  kind: "api" | "unreachable" | "malformed";
  /** The API's `error.code` (`kind = "api"`). */
  code?: string;
  /** What happened, in Portuguese (contracts/web-ui.md, "Mensagens de erro"). */
  message: string;
  /** Secondary text — the API's own message, only where it helps. */
  detail?: string;
  requestId?: string;
  /** The URL that was tried (`kind = "unreachable"`). */
  url?: string;
}

export type ErrorOutcome = Exclude<ChatOutcome, { kind: "answered" | "pending" | "denied" }>;

/** Codes whose retry makes sense without changing the message (contracts/web-ui.md). */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(["timeout", "model_unavailable", "internal"]);

/** Pure: an outcome that isn't an answer, as something to show (FR-005). */
export function toDisplayError(outcome: ErrorOutcome): DisplayError {
  switch (outcome.kind) {
    case "unreachable":
      return outcome.reason === "timeout"
        ? { kind: "unreachable", message: "Sem resposta da API em 190 s.", url: outcome.url }
        : {
            kind: "unreachable",
            message: `Não foi possível falar com a API em ${outcome.url}. Confira a URL na engrenagem e se esta origem está em OPSPILOT_CORS_ORIGINS.`,
            url: outcome.url,
          };
    case "malformed":
      return {
        kind: "malformed",
        message: "A API respondeu num formato inesperado.",
        ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
      };
    case "api-error": {
      const { code, message } = outcome.body.error;
      const base = { kind: "api" as const, code, ...(outcome.requestId ? { requestId: outcome.requestId } : {}) };
      switch (code) {
        case "invalid_body":
          return { ...base, message: "A API recusou a mensagem.", detail: message };
        case "unknown_strategy":
          return { ...base, message: "Estratégia desconhecida.", detail: message };
        case "conversation_not_found":
          return { ...base, message: "Esta conversa não existe mais na API." };
        case "timeout":
          return { ...base, message: "O OpsPilot não respondeu a tempo (180 s)." };
        case "model_unavailable":
          return { ...base, message: "Nenhum modelo disponível agora." };
        case "internal":
          return { ...base, message: "Erro interno da API." };
        default:
          return { ...base, message: `A API respondeu com erro ${code}.`, detail: message };
      }
    }
  }
}
