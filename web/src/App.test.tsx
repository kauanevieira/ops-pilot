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

function setup(responder: (call: number, body: Record<string, unknown>) => Response | Promise<Response>) {
  let call = 0;
  let id = 0;
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    call += 1;
    return responder(call, JSON.parse(init.body as string));
  });
  const storage = memoryStorage();
  render(
    <App
      fetch={fetchMock as unknown as typeof fetch}
      storage={storage}
      newId={() => `id-${++id}`}
      now={() => new Date("2026-10-07T12:00:00.000Z")}
    />,
  );
  return { fetchMock, storage };
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
