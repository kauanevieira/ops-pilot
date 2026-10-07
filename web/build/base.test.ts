import { describe, expect, it } from "vitest";
import { resolveBase } from "./base";

// 017 FR-009/FR-009b, contracts/build-base.md
describe("resolveBase", () => {
  it.each([undefined, "", "   "])("falls back to /opspilot/ for %j", (raw) => {
    expect(resolveBase(raw)).toBe("/opspilot/");
  });

  it.each([
    ["/ops-pilot/", "/ops-pilot/"],
    ["/ops-pilot", "/ops-pilot/"],
    ["ops-pilot", "/ops-pilot/"],
    ["/", "/"],
    ["/a/b", "/a/b/"],
    ["//", "/"],
    ["//a///b//", "/a/b/"],
    ["  /ops-pilot  ", "/ops-pilot/"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(resolveBase(raw)).toBe(expected);
  });

  it.each(["https://x/y", "/a b", "/a/../b", "/a?x=1", "/a#b", "\\a"])(
    "rejects %j with a message naming the variable",
    (raw) => {
      expect(() => resolveBase(raw)).toThrow(
        `OPSPILOT_WEB_BASE inválido: "${raw}". Use um caminho como /ops-pilot/.`,
      );
    },
  );
});
