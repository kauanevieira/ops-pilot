import { useEffect, useMemo, useRef } from "react";
import type { ChatResponseWire } from "@domain/wire.ts";
import { EventView } from "./events/index.tsx";
import { parseTrace } from "./parse-trace.ts";

interface Props {
  result: ChatResponseWire;
  onClose: () => void;
}

/** FR-009: only the metrics that came with the result; an absent one is never shown as 0. */
function metricLines(result: ChatResponseWire): string[] {
  const m = result.metrics;
  const lines = [`motivo de parada: ${result.stoppedReason}`, `chamadas ao modelo: ${m.llmCalls}`, `latência: ${m.latencyMs} ms`];
  if (m.promptTokens !== undefined) lines.push(`tokens de entrada: ${m.promptTokens}`);
  if (m.modelUsed !== undefined) lines.push(`modelo: ${m.modelUsed}`);
  if (m.historyMessages !== undefined) lines.push(`histórico: ${m.historyMessages}`);
  if (m.summaryCoveredMessages !== undefined) lines.push(`resumo cobre: ${m.summaryCoveredMessages}`);
  if (m.recalledMemories !== undefined) lines.push(`memórias: ${m.recalledMemories}`);
  if (m.contextBreakdown !== undefined) {
    const b = m.contextBreakdown;
    lines.push(
      `contexto estimado: ${b.total} (mensagem ${b.message}, histórico ${b.history}, resumo ${b.summary}, memórias ${b.memories})`,
    );
  }
  return lines;
}

export function TraceDrawer({ result, onClose }: Props) {
  const events = useMemo(() => parseTrace(result.trace), [result.trace]);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Whatever opened the drawer gets the focus back when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, []);

  return (
    <div
      className="backdrop"
      data-testid="trace-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Raciocínio" tabIndex={-1} ref={panelRef}>
        <div className="drawer-head">
          <h2>Raciocínio</h2>
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="metrics">
          {metricLines(result).map((line) => (
            <span key={line} className="metric">
              {line}
            </span>
          ))}
        </div>
        <ol className="trace-list">
          {events.map((parsed, index) => (
            <EventView key={index} parsed={parsed} />
          ))}
        </ol>
      </div>
    </div>
  );
}
