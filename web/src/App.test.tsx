import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

function answer(conversationId: string, text: string, requestId = "r1") {
  return {
    answer: text,
    trace: [{ type: "answer", content: text }],
    metrics: { llmCalls: 1, latencyMs: 12 },
    stoppedReason: "completed",
    conversationId,
    requestId,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

function setup(
  responder: (call: number, body: Record<string, unknown>) => Response | Promise<Response>,
  options: { storage?: Storage | null } = {},
) {
  let call = 0;
  let id = 0;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    call += 1;
    return responder(call, JSON.parse(init.body as string));
  });
  const storage = options.storage !== undefined ? options.storage : memoryStorage();
  const { unmount } = render(
    <App
      fetch={fetchMock as unknown as typeof fetch}
      storage={storage}
      newId={() => `id-${++id}`}
      now={() => new Date("2026-10-07T12:00:00.000Z")}
    />,
  );
  return { fetchMock, storage, unmount };
}

const box = () => screen.getByRole("textbox", { name: /mensagem/i });
const sendButton = () => screen.getByRole("button", { name: /enviar/i });

describe("App · conversation (US1)", () => {
  it("shows the message right away, a thinking indicator, then the answer", async () => {
    let release!: (r: Response) => void;
    setup(() => new Promise<Response>((resolve) => (release = resolve)));

    await userEvent.type(box(), "quais alertas?");
    await userEvent.click(sendButton());

    expect(screen.getByText("quais alertas?")).toBeInTheDocument();
    expect(screen.getByText(/pensando/i)).toBeInTheDocument();
    expect(box()).toBeDisabled();
    expect(sendButton()).toBeDisabled();

    release(json(200, answer("c1", "3 alertas abertos")));
    expect(await screen.findByText("3 alertas abertos")).toBeInTheDocument();
    expect(screen.queryByText(/pensando/i)).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
  });

  it("sends the conversationId on the second turn", async () => {
    const { fetchMock } = setup((call) => json(200, answer("c1", `resposta ${call}`)));

    await userEvent.type(box(), "primeira");
    await userEvent.click(sendButton());
    await screen.findByText("resposta 1");
    await userEvent.type(box(), "segunda");
    await userEvent.click(sendButton());
    await screen.findByText("resposta 2");

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));
    expect(bodies[0]).toEqual({ message: "primeira" });
    expect(bodies[1]).toEqual({ message: "segunda", conversationId: "c1" });
  });

  it("New conversation clears the screen and drops the conversationId", async () => {
    const { fetchMock } = setup((call) => json(200, answer(`c${call}`, `resposta ${call}`)));

    await userEvent.type(box(), "primeira");
    await userEvent.click(sendButton());
    await screen.findByText("resposta 1");
    await userEvent.click(screen.getByRole("button", { name: /nova conversa/i }));

    expect(screen.queryByText("resposta 1")).not.toBeInTheDocument();
    await userEvent.type(box(), "outra");
    await userEvent.click(sendButton());
    await screen.findByText("resposta 2");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ message: "outra" });
  });

  it("Enter sends and Shift+Enter breaks the line", async () => {
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")));

    await userEvent.type(box(), "linha 1{Shift>}{Enter}{/Shift}linha 2");
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ message: "linha 1\nlinha 2" });
  });

  it("does not send an empty message", async () => {
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")));
    expect(sendButton()).toBeDisabled();
    await userEvent.type(box(), "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an API error becomes a readable bubble and retry resends the same text", async () => {
    const { fetchMock } = setup((call) =>
      call === 1
        ? json(503, { error: { code: "model_unavailable", message: "x" }, requestId: "r-err" })
        : json(200, answer("c1", "agora foi")),
    );

    await userEvent.type(box(), "tenta");
    await userEvent.click(sendButton());
    expect(await screen.findByText(/Nenhum modelo disponível/)).toBeInTheDocument();
    expect(screen.getByText("r-err")).toBeInTheDocument();
    expect(screen.getByText("tenta")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(await screen.findByText("agora foi")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ message: "tenta" });
  });

  it("conversation_not_found offers a new conversation that drops the id", async () => {
    const { fetchMock } = setup((call) =>
      call === 1
        ? json(200, answer("c1", "primeira"))
        : call === 2
          ? json(404, { error: { code: "conversation_not_found", message: "x" } })
          : json(200, answer("c9", "nova")),
    );

    await userEvent.type(box(), "um");
    await userEvent.click(sendButton());
    await screen.findByText("primeira");
    await userEvent.type(box(), "dois");
    await userEvent.click(sendButton());
    await screen.findByText(/não existe mais na API/);

    await userEvent.click(screen.getAllByRole("button", { name: /nova conversa/i }).at(-1)!);
    await userEvent.type(box(), "três");
    await userEvent.click(sendButton());
    await screen.findByText("nova");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string)).toEqual({ message: "três" });
  });

  it("a dead network points at the URL tried", async () => {
    setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await userEvent.type(box(), "oi");
    await userEvent.click(sendButton());
    expect(await screen.findByText(/Não foi possível falar com a API em http:\/\/localhost:3000/)).toBeInTheDocument();
  });
});

describe("App · ver raciocínio (US2)", () => {
  it("opens the trace of that answer, and Esc closes it returning focus to the button", async () => {
    setup(() =>
      json(200, {
        ...answer("c1", "3 alertas abertos"),
        trace: [
          { type: "route", route: "react", strategy: "react", reason: "simples", source: "router" },
          { type: "action", tool: "list_alerts", args: { status: "open" } },
          { type: "answer", content: "3 alertas abertos" },
        ],
      }),
    );

    await userEvent.type(box(), "alertas?");
    await userEvent.click(sendButton());
    await screen.findByText("3 alertas abertos");
    expect(screen.getByText("react")).toBeInTheDocument(); // the strategy chosen, next to the answer

    const opener = screen.getByRole("button", { name: /ver raciocínio/i });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Raciocínio" });
    expect(dialog).toHaveTextContent("list_alerts");
    expect(screen.getAllByTestId("trace-event")).toHaveLength(3);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("each answer opens its own trace", async () => {
    setup((call) =>
      json(200, { ...answer("c1", `resposta ${call}`), trace: [{ type: "thought", content: `pensamento ${call}` }] }),
    );
    for (const text of ["um", "dois"]) {
      await userEvent.type(box(), text);
      await userEvent.click(sendButton());
      await screen.findByText(text === "um" ? "resposta 1" : "resposta 2");
    }
    const buttons = screen.getAllByRole("button", { name: /ver raciocínio/i });
    await userEvent.click(buttons[0]!);
    expect(screen.getByRole("dialog")).toHaveTextContent("pensamento 1");
  });
});

const gear = () => screen.getByRole("button", { name: /configurações/i });
const urlField = () => screen.getByRole("textbox", { name: /url da api/i });

async function changeUrl(url: string) {
  await userEvent.click(gear());
  await userEvent.clear(urlField());
  await userEvent.type(urlField(), url);
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
}

async function sendOne(text = "oi") {
  await userEvent.type(box(), text);
  await userEvent.click(sendButton());
}

describe("App · API URL gear (US4)", () => {
  it("opens with the default URL in use", async () => {
    setup(() => json(200, answer("c1", "ok")));
    await userEvent.click(gear());
    expect(urlField()).toHaveValue("http://localhost:3000");
  });

  it("saving sends the next request to the new URL", async () => {
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")));
    await changeUrl("http://localhost:3999");
    expect(screen.queryByRole("dialog", { name: "Configurações" })).not.toBeInTheDocument();
    await sendOne();
    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3999/chat");
  });

  it("the choice survives remounting the app (a reload)", async () => {
    const first = setup(() => json(200, answer("c1", "ok")));
    await changeUrl("https://host/api");
    first.unmount();

    const second = setup(() => json(200, answer("c1", "ok")), { storage: first.storage });
    await sendOne();
    await screen.findByText("ok");
    expect(second.fetchMock.mock.calls[0]![0]).toBe("https://host/api/chat");
  });

  it("an invalid URL keeps the previous one", async () => {
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")));
    await userEvent.click(gear());
    await userEvent.clear(urlField());
    await userEvent.type(urlField(), "isso nao e url");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await sendOne();
    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/chat");
  });

  it("Restore default goes back to the default URL", async () => {
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")));
    await changeUrl("http://localhost:3999");
    await userEvent.click(gear());
    await userEvent.click(screen.getByRole("button", { name: /restaurar padrão/i }));
    await sendOne();
    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/chat");
  });

  it("the header shows the URL in use", async () => {
    setup(() => json(200, answer("c1", "ok")));
    expect(screen.getByText(/http:\/\/localhost:3000 \(padrão\)/)).toBeInTheDocument();
    await changeUrl("http://localhost:3999");
    expect(screen.getByText("http://localhost:3999")).toBeInTheDocument();
  });

  it("with unavailable storage the app works with the default and says the choice is not remembered", async () => {
    const blocked = new Proxy({} as Storage, {
      get() {
        return () => {
          throw new DOMException("blocked", "SecurityError");
        };
      },
    });
    const { fetchMock } = setup(() => json(200, answer("c1", "ok")), { storage: blocked });
    await sendOne();
    await screen.findByText("ok");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/chat");

    await userEvent.click(gear());
    expect(screen.getByText(/não será lembrada/i)).toBeInTheDocument();
  });

  it("an unreachable API at the saved URL names that URL (US4-5)", async () => {
    setup(() => {
      throw new TypeError("Failed to fetch");
    });
    await changeUrl("http://localhost:3999");
    await sendOne();
    expect(await screen.findByText(/Não foi possível falar com a API em http:\/\/localhost:3999/)).toBeInTheDocument();
  });
});

const ACCEPTED_BODY = {
  status: "pending_approval",
  requestId: "r2",
  conversationId: "c1",
  approval: {
    id: "ap-1",
    tool: "resolve_incident",
    args: { incidentId: "INC-42" },
    description: "Resolver o incidente INC-42.",
  },
};

const DENIED_BODY = { status: "denied", approvalId: "ap-1", conversationId: "c1", requestId: "r3" };

async function askForApproval(text = "resolve o INC-42") {
  await userEvent.type(box(), text);
  await userEvent.click(sendButton());
  await screen.findByText(/Resolver o incidente INC-42/);
}

const approve = () => screen.getByRole("button", { name: "Aprovar" });
const deny = () => screen.getByRole("button", { name: "Negar" });

describe("App · approval (US3)", () => {
  it("a 202 becomes a card, and the composer stays blocked until it is decided", async () => {
    setup(() => json(202, ACCEPTED_BODY));
    await askForApproval();

    expect(screen.getByText("resolve_incident")).toBeInTheDocument();
    expect(approve()).toBeEnabled();
    expect(box()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });

  it("approve posts the decision and the final answer follows with its own trace", async () => {
    const { fetchMock } = setup((call) =>
      call === 1
        ? json(202, ACCEPTED_BODY)
        : json(200, { ...answer("c1", "INC-42 resolvido"), trace: [{ type: "answer", content: "INC-42 resolvido" }] }),
    );
    await askForApproval();
    await userEvent.click(approve());

    expect(await screen.findByText("INC-42 resolvido")).toBeInTheDocument();
    expect(screen.getByText("aprovado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ver raciocínio/i })).toBeInTheDocument();
    expect(box()).toBeEnabled();

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("http://localhost:3000/approvals/ap-1");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "approve" });
  });

  it("deny shows negado, runs nothing and frees the composer", async () => {
    const { fetchMock } = setup((call) => (call === 1 ? json(202, ACCEPTED_BODY) : json(200, DENIED_BODY)));
    await askForApproval();
    await userEvent.click(deny());

    expect(await screen.findByText("negado")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ decision: "deny" });
    expect(box()).toBeEnabled();
  });

  it("a double click makes a single decision call (UI2)", async () => {
    let release!: (r: Response) => void;
    const { fetchMock } = setup((call) =>
      call === 1 ? json(202, ACCEPTED_BODY) : new Promise<Response>((resolve) => (release = resolve)),
    );
    await askForApproval();

    await userEvent.dblClick(approve());
    expect(fetchMock).toHaveBeenCalledTimes(2); // /chat + one decision
    expect(approve()).toBeDisabled();
    expect(deny()).toBeDisabled();

    release(json(200, answer("c1", "feito")));
    await screen.findByText("feito");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [404, "approval_not_found", "Pendência não encontrada"],
    [409, "approval_already_decided", "Já decidida"],
    [410, "approval_expired", "Expirou"],
  ])("a %i from the API closes the card with its reason (FR-015)", async (status, code, reason) => {
    setup((call) => (call === 1 ? json(202, ACCEPTED_BODY) : json(status, { error: { code, message: "x" } })));
    await askForApproval();
    await userEvent.click(approve());

    expect(await screen.findByText("recusado")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
  });

  it("a second 202 after approving shows a new card and keeps the first as approved", async () => {
    setup((call) =>
      call === 1
        ? json(202, ACCEPTED_BODY)
        : json(202, {
            ...ACCEPTED_BODY,
            approval: { ...ACCEPTED_BODY.approval, id: "ap-2", description: "Notificar o time." },
          }),
    );
    await askForApproval();
    await userEvent.click(approve());

    expect(await screen.findByText(/Notificar o time/)).toBeInTheDocument();
    expect(screen.getByText("aprovado")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Aprovar" })).toHaveLength(1);
    expect(box()).toBeDisabled();
  });

  it("a network failure on the decision brings the card back and shows the error", async () => {
    setup((call) => {
      if (call === 1) return json(202, ACCEPTED_BODY);
      throw new TypeError("Failed to fetch");
    });
    await askForApproval();
    await userEvent.click(approve());

    expect(await screen.findByText(/Não foi possível falar com a API/)).toBeInTheDocument();
    expect(approve()).toBeEnabled();
    expect(box()).toBeDisabled();
  });

  it("a 500 on the decision brings the card back and shows the error", async () => {
    setup((call) => (call === 1 ? json(202, ACCEPTED_BODY) : json(500, { error: { code: "internal", message: "x" } })));
    await askForApproval();
    await userEvent.click(approve());

    expect(await screen.findByText(/Erro interno da API/)).toBeInTheDocument();
    expect(approve()).toBeEnabled();
  });

  it("a malformed 202 is a readable error, never a broken card", async () => {
    setup(() => json(202, { status: "pending_approval", requestId: "r2" }));
    await userEvent.type(box(), "resolve");
    await userEvent.click(sendButton());

    expect(await screen.findByText(/formato inesperado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
  });
});
