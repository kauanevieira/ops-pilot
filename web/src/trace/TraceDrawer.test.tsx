import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ChatResponseWire, TraceEventWire } from "@domain/wire.ts";
import { TraceDrawer } from "./TraceDrawer.tsx";

// Typed by the wire schema: changing the trace on the API breaks this fixture's typecheck (research R-010).
const TRACE: TraceEventWire[] = [
  { type: "summarize", content: "resumo da conversa", absorbedMessages: 3, nodeName: "context" },
  { type: "route", route: "react", strategy: "react", reason: "pedido simples", source: "router", nodeName: "router" },
  { type: "thought", content: "vou listar os alertas", nodeName: "react" },
  { type: "action", tool: "list_alerts", args: { status: "open", filter: { severity: ["critical", "high"] } } },
  { type: "observation", content: "3 alertas abertos", tool: "list_alerts" },
  { type: "observation", content: "serviço fora do ar", tool: "get_service", isError: true },
  { type: "plan", steps: ["listar alertas", "ver runbook"], revision: 2 },
  { type: "critique", content: "aprovado: ok" },
  { type: "fallback", from: "a/primario", to: "c/reserva", reason: "rate_limit" },
  { type: "answer", content: "resposta final" },
];

function resultWith(trace: unknown[], metrics: Partial<ChatResponseWire["metrics"]> = {}): ChatResponseWire {
  return {
    answer: "resposta final",
    trace,
    metrics: { llmCalls: 4, latencyMs: 812, ...metrics },
    stoppedReason: "completed",
    conversationId: "c1",
    requestId: "r1",
  };
}

const events = () => screen.getAllByTestId("trace-event");

describe("TraceDrawer · events (FR-007, FR-008, UI1)", () => {
  it("shows every event in order, each with its own label (UI4: in text)", () => {
    render(<TraceDrawer result={resultWith([...TRACE, { type: "vote", ballots: 3 }])} onClose={() => {}} />);
    const labels = events().map((e) => e.getAttribute("data-label"));
    expect(labels).toEqual([
      "Resumo",
      "Rota",
      "Pensamento",
      "Ação",
      "Observação",
      "Observação",
      "Plano",
      "Crítica",
      "Troca de modelo",
      "Resposta",
      "Evento vote",
    ]);
    for (const e of events()) expect(within(e).getByText(e.getAttribute("data-label")!)).toBeInTheDocument();
  });

  it("route shows route, strategy, source and reason", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    const route = events()[1]!;
    expect(route).toHaveTextContent("react");
    expect(route).toHaveTextContent("router");
    expect(route).toHaveTextContent("pedido simples");
  });

  it("action shows the tool and nested args as a tree, never [object Object]", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    const action = events()[3]!;
    expect(action).toHaveTextContent("list_alerts");
    for (const text of ["status", "open", "filter", "severity", "critical", "high"]) {
      expect(action).toHaveTextContent(text);
    }
    expect(action.textContent).not.toContain("[object Object]");
  });

  it("observation flags an error and names the tool", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    expect(within(events()[4]!).queryByText("erro")).not.toBeInTheDocument();
    expect(within(events()[5]!).getByText("erro")).toBeInTheDocument();
    expect(events()[5]).toHaveTextContent("get_service");
  });

  it("plan shows the revision and numbered steps", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    const plan = events()[6]!;
    expect(plan).toHaveTextContent("rev. 2");
    expect(plan).toHaveTextContent("1.");
    expect(plan).toHaveTextContent("listar alertas");
    expect(plan).toHaveTextContent("2.");
    expect(plan).toHaveTextContent("ver runbook");
  });

  it("critique shows an approved badge from the aprovado: prefix, rejected from reprovado:", () => {
    render(
      <TraceDrawer
        result={resultWith([
          { type: "critique", content: "aprovado: ok" },
          { type: "critique", content: "reprovado: falta evidência" },
        ])}
        onClose={() => {}}
      />,
    );
    expect(within(events()[0]!).getByText("aprovado")).toBeInTheDocument();
    expect(within(events()[1]!).getByText("reprovado")).toBeInTheDocument();
  });

  it("fallback shows from → to and the reason; summarize shows the absorbed messages", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    const fb = events()[8]!;
    expect(fb).toHaveTextContent("a/primario");
    expect(fb).toHaveTextContent("c/reserva");
    expect(fb).toHaveTextContent("rate_limit");
    expect(events()[0]).toHaveTextContent("3 mensagens absorvidas");
  });

  it("shows the node that produced the event when present", () => {
    render(<TraceDrawer result={resultWith(TRACE)} onClose={() => {}} />);
    expect(events()[0]).toHaveTextContent("context");
    expect(events()[1]).toHaveTextContent("router");
    expect(events()[3]).not.toHaveTextContent(/nó:/);
  });

  it("an unknown event shows the raw JSON and does not stop the others (UI1)", () => {
    render(<TraceDrawer result={resultWith([{ type: "vote", ballots: 3 }, { type: "answer", content: "fim" }])} onClose={() => {}} />);
    expect(events()).toHaveLength(2);
    expect(events()[0]).toHaveTextContent('"ballots": 3');
    expect(events()[1]).toHaveTextContent("fim");
  });

  it("collapses long content and expands on request (FR-010)", async () => {
    const long = "x".repeat(2000);
    render(<TraceDrawer result={resultWith([{ type: "observation", content: long }])} onClose={() => {}} />);
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /mostrar tudo/i }));
    expect(screen.getByText(long)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /mostrar menos/i }));
    expect(screen.queryByText(long)).not.toBeInTheDocument();
  });

  it("collapses content with many lines too", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`).join("\n");
    render(<TraceDrawer result={resultWith([{ type: "thought", content: lines }])} onClose={() => {}} />);
    expect(screen.queryByText(/linha 30/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mostrar tudo/i })).toBeInTheDocument();
  });

  it("does not collapse short content", () => {
    render(<TraceDrawer result={resultWith([{ type: "thought", content: "curto" }])} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /mostrar tudo/i })).not.toBeInTheDocument();
  });
});

describe("TraceDrawer · header (FR-009)", () => {
  it("shows the stop reason and every metric that is present", () => {
    render(
      <TraceDrawer
        result={resultWith([], {
          promptTokens: 1500,
          modelUsed: "openai/gpt-4o-mini",
          historyMessages: 2,
          summaryCoveredMessages: 6,
          recalledMemories: 1,
          contextBreakdown: { message: 10, history: 20, summary: 5, memories: 3, total: 38 },
        })}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Raciocínio" });
    for (const text of [
      "completed",
      "chamadas ao modelo: 4",
      "latência: 812 ms",
      "tokens de entrada: 1500",
      "modelo: openai/gpt-4o-mini",
      "histórico: 2",
      "resumo cobre: 6",
      "memórias: 1",
      "contexto estimado: 38",
    ]) {
      expect(dialog).toHaveTextContent(text);
    }
  });

  it("an absent metric does not show up, and never as 0", () => {
    render(<TraceDrawer result={resultWith([])} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Raciocínio" });
    for (const text of ["tokens de entrada", "histórico", "resumo cobre", "memórias", "contexto estimado"]) {
      expect(dialog).not.toHaveTextContent(text);
    }
    expect(screen.queryByText(/^modelo:/)).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("chamadas ao modelo: 4");
  });

  it("a metric that is really 0 does show", () => {
    render(<TraceDrawer result={resultWith([], { historyMessages: 0 })} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("histórico: 0");
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>ver raciocínio</button>
      {open && <TraceDrawer result={resultWith(TRACE)} onClose={() => setOpen(false)} />}
    </>
  );
}

describe("TraceDrawer · closing", () => {
  it("Esc closes and returns focus to the opener", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "ver raciocínio" });
    await userEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Raciocínio" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("the close button closes", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "ver raciocínio" }));
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking outside closes, clicking inside does not", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "ver raciocínio" }));
    await userEvent.click(events()[0]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("trace-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
