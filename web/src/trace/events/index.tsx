import type { ParsedTraceEvent } from "../parse-trace.ts";
import { ArgsTree } from "../ArgsTree.tsx";
import { Collapsible } from "../Collapsible.tsx";
import { EventFrame } from "./EventFrame.tsx";

/** FR-007: one presentation per known type; the `switch` is exhaustive over the wire schema. */
export function EventView({ parsed }: { parsed: ParsedTraceEvent }) {
  if (parsed.kind === "unknown") {
    let pretty: string;
    try {
      pretty = JSON.stringify(parsed.raw, null, 2) ?? String(parsed.raw);
    } catch {
      pretty = String(parsed.raw);
    }
    return (
      <EventFrame kind="unknown" label={parsed.type ? `Evento ${parsed.type}` : "Evento desconhecido"}>
        <Collapsible text={pretty} />
      </EventFrame>
    );
  }

  const event = parsed.event;
  const nodeName = event.nodeName;
  switch (event.type) {
    case "summarize":
      return (
        <EventFrame
          kind="summarize"
          label="Resumo"
          nodeName={nodeName}
          extra={
            <span className="event-node">
              {" "}
              {event.absorbedMessages === 1 ? "1 mensagem absorvida" : `${event.absorbedMessages} mensagens absorvidas`}
            </span>
          }
        >
          <Collapsible text={event.content} />
        </EventFrame>
      );
    case "route":
      return (
        <EventFrame kind="route" label="Rota" nodeName={nodeName}>
          <div className="event-body">
            {event.route} · {event.strategy} · origem: {event.source}
          </div>
          <div className="event-body">{event.reason}</div>
        </EventFrame>
      );
    case "thought":
      return (
        <EventFrame kind="thought" label="Pensamento" nodeName={nodeName}>
          <Collapsible text={event.content} />
        </EventFrame>
      );
    case "action":
      return (
        <EventFrame
          kind="action"
          label="Ação"
          nodeName={nodeName}
          extra={<code> {event.tool}</code>}
        >
          <ArgsTree args={event.args} />
        </EventFrame>
      );
    case "observation":
      return (
        <EventFrame
          kind={event.isError ? "error" : "observation"}
          label="Observação"
          nodeName={nodeName}
          extra={
            <>
              {event.tool && <code> {event.tool}</code>}
              {event.isError && <span className="badge badge-danger"> erro</span>}
            </>
          }
        >
          <Collapsible text={event.content} />
        </EventFrame>
      );
    case "plan":
      return (
        <EventFrame
          kind="plan"
          label="Plano"
          nodeName={nodeName}
          extra={<span className="event-node"> rev. {event.revision}</span>}
        >
          {event.steps.map((step, index) => (
            <div key={index} className="event-body">
              {index + 1}. {step}
            </div>
          ))}
        </EventFrame>
      );
    case "critique": {
      const verdict = /^aprovado:/i.test(event.content)
        ? "aprovado"
        : /^reprovado:/i.test(event.content)
          ? "reprovado"
          : null;
      return (
        <EventFrame
          kind="critique"
          label="Crítica"
          nodeName={nodeName}
          extra={
            verdict && (
              <span className={`badge ${verdict === "aprovado" ? "badge-ok" : "badge-danger"}`}> {verdict}</span>
            )
          }
        >
          <Collapsible text={event.content} />
        </EventFrame>
      );
    }
    case "fallback":
      return (
        <EventFrame kind="fallback" label="Troca de modelo" nodeName={nodeName}>
          <div className="event-body">
            {event.from} → {event.to}
          </div>
          <div className="event-body">motivo: {event.reason}</div>
        </EventFrame>
      );
    case "answer":
      return (
        <EventFrame kind="answer" label="Resposta" nodeName={nodeName}>
          <Collapsible text={event.content} />
        </EventFrame>
      );
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
