import { useEffect, useRef } from "react";
import { parseTrace } from "../trace/parse-trace.ts";
import type { ConversationItem } from "../state/conversation.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ErrorBubble } from "./ErrorBubble.tsx";

interface Props {
  items: ConversationItem[];
  /** The one item that may show "Tentar de novo" (the last error, when idle). */
  retryItemId: string | null;
  onRetry: (text: string) => void;
  onNewConversation: () => void;
  /** US3: the person's decision on a pending card. */
  onDecide: (itemId: string, decision: "approve" | "deny") => void;
  /** US2: opens the trace of an answer. */
  onShowTrace?: (itemId: string) => void;
}

/** The strategy the router (or the override) chose, read from the route event. */
function strategyOf(trace: unknown[]): string | null {
  for (const parsed of parseTrace(trace)) {
    if (parsed.kind === "known" && parsed.event.type === "route") return parsed.event.strategy;
  }
  return null;
}

export function MessageList({ items, retryItemId, onRetry, onNewConversation, onDecide, onShowTrace }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items.length]);

  return (
    <div className="conversation" aria-live="polite">
      <div className="conversation-inner">
        {items.length === 0 && <p className="empty">Pergunte sobre alertas, incidentes e runbooks.</p>}
        {items.map((item) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={item.id} className="bubble bubble-user">
                  {item.text}
                </div>
              );
            case "answer": {
              const strategy = strategyOf(item.result.trace);
              return (
                <div key={item.id} className="bubble bubble-answer">
                  {item.result.answer}
                  <div className="bubble-meta">
                    {strategy && <span>{strategy}</span>}
                    <span>{item.result.metrics.latencyMs} ms</span>
                    {onShowTrace && (
                      <button type="button" className="link-btn" onClick={() => onShowTrace(item.id)}>
                        ver raciocínio
                      </button>
                    )}
                  </div>
                </div>
              );
            }
            case "error":
              return (
                <ErrorBubble
                  key={item.id}
                  error={item.error}
                  canRetry={item.id === retryItemId && item.retryText !== undefined}
                  onRetry={() => item.retryText !== undefined && onRetry(item.retryText)}
                  onNewConversation={onNewConversation}
                />
              );
            case "approval":
              return (
                <ApprovalCard key={item.id} id={item.id} pending={item.pending} state={item.state} onDecide={onDecide} />
              );
          }
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
