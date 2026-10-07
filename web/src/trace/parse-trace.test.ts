import { describe, expect, it } from "vitest";
import { parseTrace } from "./parse-trace.ts";

describe("parseTrace (FR-007, FR-008)", () => {
  it("keeps the received order and marks valid events as known", () => {
    const parsed = parseTrace([
      { type: "route", route: "react", strategy: "react", reason: "x", source: "router" },
      { type: "thought", content: "a" },
      { type: "answer", content: "b" },
    ]);
    expect(parsed.map((p) => p.kind)).toEqual(["known", "known", "known"]);
    expect(parsed.map((p) => (p.kind === "known" ? p.event.type : null))).toEqual(["route", "thought", "answer"]);
  });

  it("an event of an unknown type becomes unknown, with its type and raw value", () => {
    const raw = { type: "vote", ballots: 3 };
    expect(parseTrace([raw])).toEqual([{ kind: "unknown", type: "vote", raw }]);
  });

  it("a known type missing a required field becomes unknown, keeping its type", () => {
    const raw = { type: "action", args: {} };
    expect(parseTrace([raw])).toEqual([{ kind: "unknown", type: "action", raw }]);
  });

  it("a non-object becomes unknown with a null type", () => {
    expect(parseTrace(["texto", 42, null, [1]])).toEqual([
      { kind: "unknown", type: null, raw: "texto" },
      { kind: "unknown", type: null, raw: 42 },
      { kind: "unknown", type: null, raw: null },
      { kind: "unknown", type: null, raw: [1] },
    ]);
  });

  it("one bad event does not affect the others (UI1)", () => {
    const parsed = parseTrace([{ type: "thought", content: "a" }, { type: "vote" }, { type: "answer", content: "b" }]);
    expect(parsed.map((p) => p.kind)).toEqual(["known", "unknown", "known"]);
  });

  it("an empty trace is an empty list", () => {
    expect(parseTrace([])).toEqual([]);
  });
});
