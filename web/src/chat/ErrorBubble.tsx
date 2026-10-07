import type { DisplayError } from "./errors.ts";
import { RETRYABLE_CODES } from "./errors.ts";

interface Props {
  error: DisplayError;
  /** Only the last item can be retried, and only when nothing else is in flight. */
  canRetry: boolean;
  onRetry: () => void;
  onNewConversation: () => void;
}

export function ErrorBubble({ error, canRetry, onRetry, onNewConversation }: Props) {
  const retryable = error.kind !== "api" || RETRYABLE_CODES.has(error.code ?? "");
  const lostConversation = error.code === "conversation_not_found";

  return (
    <div className="bubble bubble-error" role="alert">
      <div>{error.message}</div>
      {error.detail && <div className="request-id">{error.detail}</div>}
      <div className="bubble-meta">
        {error.requestId && (
          <>
            <code className="request-id">{error.requestId}</code>
            <button
              type="button"
              className="link-btn"
              onClick={() => void navigator.clipboard?.writeText(error.requestId!)}
            >
              copiar
            </button>
          </>
        )}
        {lostConversation && (
          <button type="button" className="link-btn" onClick={onNewConversation}>
            Nova conversa
          </button>
        )}
        {retryable && canRetry && (
          <button type="button" className="link-btn" onClick={onRetry}>
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}
