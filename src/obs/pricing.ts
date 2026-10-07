import { modelPricesSchema, type ModelPrices } from "../domain/schemas.ts";

/**
 * Reads `OPENROUTER_PRICES` (a JSON object, optional). Absent or empty means
 * no prices: only `:free` models then have a known cost. An invalid value
 * throws — the caller (`src/index.ts`) refuses to start, same rule as `PORT`.
 */
export function readModelPrices(raw: string | undefined): ModelPrices {
  if (raw === undefined || raw.trim() === "") return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('OPENROUTER_PRICES não é um JSON válido (esperado: {"<modelo>": <USD por 1M tokens de entrada>}).');
  }
  const parsed = modelPricesSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `OPENROUTER_PRICES inválida: cada valor deve ser um número ≥ 0 (USD por 1M tokens de entrada). ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
