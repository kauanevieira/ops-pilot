import { DEFAULT_API_URL, parseApiUrl } from "../api/url.ts";

const KEY = "opspilot.apiUrl";

export interface ApiUrlSetting {
  url: string;
  source: "saved" | "default";
  /** `false` when the browser storage is unavailable: the choice will not be remembered (FR-018). */
  persistent: boolean;
}

/** The only thing the war room writes to the browser (UI3). Every access is guarded. */
export function loadApiUrl(storage: Storage | null): ApiUrlSetting {
  if (!storage) return { url: DEFAULT_API_URL, source: "default", persistent: false };
  try {
    const saved = storage.getItem(KEY);
    if (saved !== null) {
      const parsed = parseApiUrl(saved);
      if (parsed.ok) return { url: parsed.url, source: "saved", persistent: true };
    }
    return { url: DEFAULT_API_URL, source: "default", persistent: true };
  } catch {
    return { url: DEFAULT_API_URL, source: "default", persistent: false };
  }
}

/** `true` when the value was actually stored. */
export function saveApiUrl(storage: Storage | null, url: string): boolean {
  try {
    storage?.setItem(KEY, url);
    return storage !== null;
  } catch {
    return false;
  }
}

export function resetApiUrl(storage: Storage | null): boolean {
  try {
    storage?.removeItem(KEY);
    return storage !== null;
  } catch {
    return false;
  }
}
