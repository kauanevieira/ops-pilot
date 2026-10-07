import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toDisplayError } from "./errors.ts";
import { ErrorBubble } from "./ErrorBubble.tsx";
import type { ErrorOutcome } from "./errors.ts";

function apiError(code: string, status: number, requestId?: string): ErrorOutcome {
  return {
    kind: "api-error",
    status,
    body: { error: { code, message: `msg da API (${code})` } },
    ...(requestId ? { requestId } : {}),
  };
}

function bubble(outcome: ErrorOutcome, handlers: { onRetry?: () => void; onNew?: () => void } = {}) {
  const error = toDisplayError(outcome);
  const onRetry = handlers.onRetry ?? vi.fn();
  const onNew = handlers.onNew ?? vi.fn();
  render(<ErrorBubble error={error} canRetry onRetry={onRetry} onNewConversation={onNew} />);
  return { error, onRetry, onNew };
}

describe("toDisplayError + ErrorBubble (FR-005, contracts/web-ui.md)", () => {
  it("invalid_body: says the API refused the message and quotes it", () => {
    bubble(apiError("invalid_body", 400));
    expect(screen.getByText(/A API recusou a mensagem/)).toBeInTheDocument();
    expect(screen.getByText(/msg da API \(invalid_body\)/)).toBeInTheDocument();
  });

  it("conversation_not_found: offers a new conversation", async () => {
    const { onNew } = bubble(apiError("conversation_not_found", 404));
    expect(screen.getByText(/não existe mais na API/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /nova conversa/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it.each([
    ["timeout", 504, /não respondeu a tempo \(180 s\)/],
    ["model_unavailable", 503, /Nenhum modelo disponível/],
    ["internal", 500, /Erro interno da API/],
  ])("%s: readable text and retry", async (code, status, text) => {
    const { onRetry } = bubble(apiError(code, status));
    expect(screen.getByText(text)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("an unknown code is shown generically", () => {
    bubble(apiError("coisa_nova", 418));
    expect(screen.getByText(/A API respondeu com erro coisa_nova/)).toBeInTheDocument();
  });

  it("shows the requestId with a copy button", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    bubble(apiError("internal", 500, "req-123"));
    expect(screen.getByText("req-123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copiar/i }));
    expect(writeText).toHaveBeenCalledWith("req-123");
  });

  it("unreachable (network): names the URL, the gear and OPSPILOT_CORS_ORIGINS", () => {
    bubble({ kind: "unreachable", url: "http://localhost:3999", reason: "network" });
    expect(screen.getByText(/http:\/\/localhost:3999/)).toBeInTheDocument();
    expect(screen.getByText(/engrenagem/)).toBeInTheDocument();
    expect(screen.getByText(/OPSPILOT_CORS_ORIGINS/)).toBeInTheDocument();
  });

  it("unreachable (timeout): says there was no answer in 190 s", () => {
    bubble({ kind: "unreachable", url: "http://h", reason: "timeout" });
    expect(screen.getByText(/Sem resposta da API em 190 s/)).toBeInTheDocument();
  });

  it("malformed: says the format was unexpected", () => {
    bubble({ kind: "malformed", status: 200 });
    expect(screen.getByText(/formato inesperado/)).toBeInTheDocument();
  });
});
