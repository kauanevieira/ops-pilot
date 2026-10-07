import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatAccepted } from "@domain/wire.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import type { ApprovalState } from "../state/conversation.ts";

const PENDING: ChatAccepted = {
  status: "pending_approval",
  requestId: "r2",
  conversationId: "c1",
  approval: {
    id: "ap-1",
    tool: "resolve_incident",
    args: { incidentId: "INC-42", notify: { channel: "#ops" } },
    description: "Resolver o incidente INC-42 (checkout fora do ar).",
    expiresAt: "2026-10-07T18:30:00.000Z",
  },
};

function card(state: ApprovalState, onDecide = vi.fn()) {
  render(<ApprovalCard id="p1" pending={PENDING} state={state} onDecide={onDecide} />);
  return onDecide;
}

describe("ApprovalCard (FR-012 to FR-015)", () => {
  it("shows the description, the tool, the args and both buttons", () => {
    card({ status: "pending" });
    expect(screen.getByText(/Resolver o incidente INC-42/)).toBeInTheDocument();
    expect(screen.getByText("resolve_incident")).toBeInTheDocument();
    expect(screen.getByText(/INC-42"/)).toBeInTheDocument();
    expect(screen.getByText(/#ops/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-07T18:30:00.000Z/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Negar" })).toBeEnabled();
  });

  it("clicking calls onDecide with the decision", async () => {
    const onDecide = card({ status: "pending" });
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(onDecide).toHaveBeenCalledWith("p1", "approve");
    await userEvent.click(screen.getByRole("button", { name: "Negar" }));
    expect(onDecide).toHaveBeenLastCalledWith("p1", "deny");
  });

  it("while deciding both buttons are disabled", () => {
    card({ status: "deciding", decision: "approve" });
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Negar" })).toBeDisabled();
    expect(screen.getByText(/enviando decisão/i)).toBeInTheDocument();
  });

  it.each([
    [{ status: "approved" } as const, "aprovado"],
    [{ status: "denied" } as const, "negado"],
  ])("a decided card (%j) shows the badge and no buttons", (state, badge) => {
    card(state);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Negar" })).not.toBeInTheDocument();
  });

  it("a rejected card shows the reason and no buttons", () => {
    card({ status: "rejected", reason: "Já decidida" });
    expect(screen.getByText("recusado")).toBeInTheDocument();
    expect(screen.getByText("Já decidida")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
  });

  it("a card without expiresAt does not mention an expiry", () => {
    const { approval, ...rest } = PENDING;
    const { expiresAt: _drop, ...withoutExpiry } = approval;
    render(<ApprovalCard id="p1" pending={{ ...rest, approval: withoutExpiry }} state={{ status: "pending" }} onDecide={vi.fn()} />);
    expect(screen.queryByText(/expira/i)).not.toBeInTheDocument();
  });
});
