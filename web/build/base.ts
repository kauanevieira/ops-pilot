const DEFAULT_BASE = "/opspilot/";
const FORBIDDEN = /:\/\/|\s|\.\.|[?#\\]/;

/**
 * 017 FR-009/FR-009b: the public path the war room is built for. Empty means the 016 default;
 * a missing leading or trailing slash is added; anything that would produce broken asset URLs
 * stops the build instead.
 */
export function resolveBase(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return DEFAULT_BASE;
  if (FORBIDDEN.test(value)) {
    throw new Error(`OPSPILOT_WEB_BASE inválido: "${raw}". Use um caminho como /ops-pilot/.`);
  }
  const segments = value.split("/").filter((segment) => segment !== "");
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}
