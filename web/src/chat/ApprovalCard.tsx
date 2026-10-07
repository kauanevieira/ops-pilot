import type { ChatAccepted } from "@domain/wire.ts";
import type { ApprovalState } from "../state/conversation.ts";
import { ArgsTree } from "../trace/ArgsTree.tsx";

interface Props {
  id: string;
  pending: ChatAccepted;
  state: ApprovalState;
  onDecide: (id: string, decision: "approve" | "deny") => void;
}

/**
 * FR-012 to FR-015: the action the agent wants to run and is waiting on. Only
 * a pending card offers the buttons; once decided it shows what was decided
 * and nothing more (SC-004).
 */
export function ApprovalCard({ id, pending, state, onDecide }: Props) {
  const { approval } = pending;
  const open = state.status === "pending" || state.status === "deciding";

  return (
    <div className="approval-card" role="group" aria-label="Aprovação necessária">
      <h3>⚠ Aprovação necessária</h3>
      <div>{approval.description}</div>
      <div className="event-body">
        ferramenta: <code>{approval.tool}</code>
      </div>
      <ArgsTree args={approval.args} />
      {approval.expiresAt && <div className="request-id">expira em {approval.expiresAt}</div>}

      {open && (
        <div className="approval-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.status === "deciding"}
            onClick={() => onDecide(id, "approve")}
          >
            Aprovar
          </button>
          <button type="button" className="btn" disabled={state.status === "deciding"} onClick={() => onDecide(id, "deny")}>
            Negar
          </button>
          {state.status === "deciding" && <span className="request-id">enviando decisão…</span>}
        </div>
      )}
      {state.status === "approved" && <span className="badge badge-ok">aprovado</span>}
      {state.status === "denied" && <span className="badge badge-danger">negado</span>}
      {state.status === "rejected" && (
        <div className="approval-actions">
          <span className="badge badge-warn">recusado</span>
          <span>{state.reason}</span>
        </div>
      )}
    </div>
  );
}
