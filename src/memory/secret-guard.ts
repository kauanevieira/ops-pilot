/**
 * Deterministic, model-independent check for credential-shaped text
 * (contracts/learning-reflector.md, secret-guard, R-008, FR-010). Applied
 * TWICE by the reflector: on the raw message, before the distiller is even
 * called, and on the distilled fact, before it is saved — the second
 * barrier behind the model's own instruction not to learn secrets.
 *
 * Pure and total: never throws, for any input, and an empty string is never
 * a secret (S1/S2).
 *
 * Errs on the side of blocking (spec, Assumptions): a phrase like
 * "a senha é pedida pelo SSO" is not a credential, but it matches the
 * keyword+separator+value shape (G5) and is deliberately accepted as a
 * false positive rather than narrowed until it misses real credentials
 * shaped the same way.
 */

// G1 — known token prefixes, each followed by enough opaque payload to be a
// real token rather than someone typing the prefix as a word.
const TOKEN_PREFIX_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/,
  /\bgh[pos]_[A-Za-z0-9_-]{10,}/,
  /\bgithub_pat_[A-Za-z0-9_-]{10,}/,
  /\bglpat-[A-Za-z0-9_-]{10,}/,
  /\bxox[abprs]-[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

// G2 — a JWT: three base64url segments separated by dots.
const JWT_PATTERN = /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/;

// G3 — a PEM private key block.
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

// G4 — credentials embedded in a URL: scheme://user:pass@host.
const URL_CREDENTIAL_PATTERN = /:\/\/[^\s/:@]+:[^\s/@]+@/;

// G5 — a secret keyword, in Portuguese or English, followed within a few
// words by a separator and a value with no internal spaces. Requires an
// actual assigned value — "chave de API" or "token" alone, with nothing
// attributed to them, is not a credential (see the "não bate" table in the
// contract).
const SECRET_KEYWORD_PATTERN =
  /\b(senha|password|passwd|token|secret|segredo|api[\s_-]?key|chave\s+de\s+api|credencial|bearer)\b(?:\s+\S+){0,3}?\s*(?::|=|é|eh|is)\s*(\S{4,})/i;

/** Shannon entropy, in bits per character. */
function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// G6 — a long, space-free run of letters/digits/symbols with both a letter
// and a digit and high entropy: the shape of a random token or key, even
// with no recognizable prefix.
const HIGH_ENTROPY_RUN_PATTERN = /[A-Za-z0-9+/=_-]{20,}/g;

function hasHighEntropyRun(text: string): boolean {
  const candidates = text.match(HIGH_ENTROPY_RUN_PATTERN);
  if (!candidates) return false;
  return candidates.some((candidate) => {
    const hasLetter = /[A-Za-z]/.test(candidate);
    const hasDigit = /[0-9]/.test(candidate);
    return hasLetter && hasDigit && shannonEntropy(candidate) >= 3.5;
  });
}

/**
 * `true` if `text` looks like it contains a credential of some kind — a
 * token, a password, a key, a JWT, a private key block, or a URL with
 * embedded credentials. See contracts/learning-reflector.md for the full
 * pattern table with worked examples.
 */
export function looksLikeSecret(text: string): boolean {
  if (text.length === 0) return false;
  if (TOKEN_PREFIX_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (JWT_PATTERN.test(text)) return true;
  if (PEM_PRIVATE_KEY_PATTERN.test(text)) return true;
  if (URL_CREDENTIAL_PATTERN.test(text)) return true;
  if (SECRET_KEYWORD_PATTERN.test(text)) return true;
  if (hasHighEntropyRun(text)) return true;
  return false;
}
