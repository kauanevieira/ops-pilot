export type ParsedApiUrl = { ok: true; url: string } | { ok: false; reason: string };

/**
 * FR-017: only absolute http/https URLs. The trailing slash is dropped and a
 * path prefix (`https://host/api`) is kept, so `joinApiUrl` can build every
 * request the same way.
 */
export function parseApiUrl(input: string): ParsedApiUrl {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "Informe a URL da API." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: "URL inválida. Use o formato http://host:porta." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "A URL precisa começar com http:// ou https://." };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${path}` };
}

export function joinApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const FALLBACK_API_URL = "http://localhost:3000";

function buildDefault(): string {
  const configured = import.meta.env.VITE_OPSPILOT_API_URL as string | undefined;
  if (configured) {
    const parsed = parseApiUrl(configured);
    if (parsed.ok) return parsed.url;
  }
  return FALLBACK_API_URL;
}

/** FR-019: fixed when the war room is built, `http://localhost:3000` when nothing is set. */
export const DEFAULT_API_URL = buildDefault();
