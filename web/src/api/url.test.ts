import { describe, expect, it } from "vitest";
import { joinApiUrl, parseApiUrl } from "./url.ts";

describe("parseApiUrl", () => {
  it("accepts http and https and drops the trailing slash", () => {
    expect(parseApiUrl("http://localhost:3000")).toEqual({ ok: true, url: "http://localhost:3000" });
    expect(parseApiUrl("http://localhost:3000/")).toEqual({ ok: true, url: "http://localhost:3000" });
    expect(parseApiUrl("  https://api.example.com  ")).toEqual({ ok: true, url: "https://api.example.com" });
  });

  it("keeps a path prefix", () => {
    expect(parseApiUrl("https://host/api/")).toEqual({ ok: true, url: "https://host/api" });
  });

  it.each(["", "   ", "ftp://host", "/relative", "localhost:3000", "not a url", "javascript:alert(1)"])(
    "rejects %j",
    (input) => {
      const result = parseApiUrl(input);
      expect(result.ok).toBe(false);
    },
  );
});

describe("joinApiUrl", () => {
  it("joins without a double slash", () => {
    expect(joinApiUrl("http://h:3000", "/chat")).toBe("http://h:3000/chat");
    expect(joinApiUrl("http://h:3000/", "/chat")).toBe("http://h:3000/chat");
    expect(joinApiUrl("https://h/api", "/chat")).toBe("https://h/api/chat");
    expect(joinApiUrl("https://h/api", "chat")).toBe("https://h/api/chat");
  });
});
