import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { messagesToTrace } from "./from-messages.ts";

describe("messagesToTrace", () => {
  it("converts a full ReAct exchange without touching the network", () => {
    const messages = [
      new HumanMessage("quais alertas estão disparando?"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "list_alerts", args: { status: "firing" }, id: "call-1" }],
      }),
      new ToolMessage({ content: "3 alerts", tool_call_id: "call-1", name: "list_alerts" }),
      new AIMessage({ content: "Há 3 alertas disparando." }),
    ];

    const trace = messagesToTrace(messages);

    assert.deepEqual(
      trace.map((e) => e.type),
      ["action", "observation", "answer"],
    );

    const action = trace[0];
    assert.equal(action?.type, "action");
    if (action?.type === "action") {
      assert.equal(action.tool, "list_alerts");
      assert.deepEqual(action.args, { status: "firing" });
    }

    const observation = trace[1];
    assert.equal(observation?.type, "observation");
    if (observation?.type === "observation") {
      assert.equal(observation.content, "3 alerts");
      assert.equal(observation.tool, "list_alerts");
    }

    const answer = trace[2];
    assert.equal(answer?.type, "answer");
    if (answer?.type === "answer") {
      assert.equal(answer.content, "Há 3 alertas disparando.");
    }
  });

  it("emits multiple action events for multiple tool calls in one AIMessage", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "open_incident", args: { title: "A", service: "checkout", severity: "high" }, id: "c1" },
          { name: "open_incident", args: { title: "B", service: "payments", severity: "low" }, id: "c2" },
        ],
      }),
    ];

    const trace = messagesToTrace(messages);
    assert.equal(trace.length, 2);
    assert.equal(trace[0]?.type, "action");
    assert.equal(trace[1]?.type, "action");
  });

  it("is deterministic across repeated calls", () => {
    const messages = [new AIMessage({ content: "final answer" })];
    const first = messagesToTrace(messages);
    const second = messagesToTrace(messages);
    assert.deepEqual(first, second);
  });
});
