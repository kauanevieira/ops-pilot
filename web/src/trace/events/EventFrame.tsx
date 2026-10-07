import type { ReactNode } from "react";

/** A kind maps to its `--ev-*` colour token (UI4: the label is always text as well). */
export type EventKind =
  | "route"
  | "thought"
  | "action"
  | "observation"
  | "error"
  | "plan"
  | "critique"
  | "answer"
  | "summarize"
  | "fallback"
  | "unknown";

interface Props {
  kind: EventKind;
  label: string;
  nodeName?: string | undefined;
  extra?: ReactNode;
  children?: ReactNode;
}

export function EventFrame({ kind, label, nodeName, extra, children }: Props) {
  const color = `var(--ev-${kind})`;
  return (
    <li
      className={`event${kind === "unknown" ? " event-unknown" : ""}`}
      style={{ borderLeftColor: color }}
      data-testid="trace-event"
      data-label={label}
    >
      <div>
        <span className="event-label" style={{ color }}>
          {label}
        </span>
        {extra}
        {nodeName && <span className="event-node"> nó: {nodeName}</span>}
      </div>
      {children}
    </li>
  );
}
