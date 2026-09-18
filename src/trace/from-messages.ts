import type { BaseMessage } from "@langchain/core/messages";
import type { TraceEvent } from "./types.ts";

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part === "object" && part !== null && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
      )
      .join("");
  }
  return "";
}

/**
 * Pure conversion of a LangGraph message list into the strategy's TraceEvent
 * sequence (R-002, FR-002, FR-003): AIMessage with tool_calls -> one `action`
 * per call; AIMessage with text content -> `thought`; ToolMessage ->
 * `observation`; the final AIMessage with no tool_calls -> `answer`.
 */
export function messagesToTrace(messages: readonly BaseMessage[]): TraceEvent[] {
  const events: TraceEvent[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message) continue;
    const type = message.getType();

    if (type === "ai") {
      const toolCalls = (message as unknown as { tool_calls?: { name: string; args: Record<string, unknown> }[] })
        .tool_calls;
      const text = contentToString(message.content);
      const isLast = i === messages.length - 1;

      if (text.trim().length > 0) {
        events.push({ type: isLast && !toolCalls?.length ? "answer" : "thought", content: text });
      }

      for (const call of toolCalls ?? []) {
        events.push({ type: "action", tool: call.name, args: call.args ?? {} });
      }
      continue;
    }

    if (type === "tool") {
      const toolMessage = message as unknown as { name?: string };
      events.push({
        type: "observation",
        content: contentToString(message.content),
        tool: toolMessage.name,
      });
      continue;
    }
  }

  return events;
}
