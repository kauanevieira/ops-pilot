import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL } from "../api/url.ts";
import { loadApiUrl, resetApiUrl, saveApiUrl } from "./api-url-store.ts";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwingStorage: Storage = new Proxy({} as Storage, {
  get() {
    return () => {
      throw new DOMException("blocked", "SecurityError");
    };
  },
});

describe("api-url-store", () => {
  it("returns the build default when nothing is saved", () => {
    expect(loadApiUrl(memoryStorage())).toEqual({ url: DEFAULT_API_URL, source: "default", persistent: true });
  });

  it("returns the saved URL", () => {
    const storage = memoryStorage({ "opspilot.apiUrl": "http://localhost:3999" });
    expect(loadApiUrl(storage)).toEqual({ url: "http://localhost:3999", source: "saved", persistent: true });
  });

  it("ignores an invalid saved value", () => {
    const storage = memoryStorage({ "opspilot.apiUrl": "lixo" });
    expect(loadApiUrl(storage)).toEqual({ url: DEFAULT_API_URL, source: "default", persistent: true });
  });

  it("saves and resets", () => {
    const storage = memoryStorage();
    expect(saveApiUrl(storage, "http://x:1")).toBe(true);
    expect(loadApiUrl(storage).url).toBe("http://x:1");
    expect(resetApiUrl(storage)).toBe(true);
    expect(loadApiUrl(storage).source).toBe("default");
  });

  it("falls back to the default and reports persistent=false when storage throws", () => {
    expect(loadApiUrl(throwingStorage)).toEqual({ url: DEFAULT_API_URL, source: "default", persistent: false });
    expect(saveApiUrl(throwingStorage, "http://x:1")).toBe(false);
    expect(resetApiUrl(throwingStorage)).toBe(false);
  });

  it("treats a missing storage (null) as not persistent", () => {
    expect(loadApiUrl(null).persistent).toBe(false);
    expect(saveApiUrl(null, "http://x:1")).toBe(false);
  });
});
