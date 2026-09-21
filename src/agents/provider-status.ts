import { z } from "zod";

/**
 * Borda de I/O da feature 005 (Princípio I): fala com o mundo lá fora e
 * decide o que fazer quando ele não coopera. Fica fora de `tools.ts` de
 * propósito — timeout, retentativa, classificação de erro e validação
 * somam mais lógica do que as cinco ferramentas existentes juntas, e
 * `tools.ts` é o catálogo do que o modelo vê, não onde essa lógica deveria
 * morar (research.md R-008).
 */

export const providerSchema = z.enum(["github", "cloudflare"]);
export type ProviderName = z.infer<typeof providerSchema>;

/**
 * Constante do projeto, nunca montada com valor vindo do modelo (FR-005,
 * R-012) — o equivalente em HTTP do SQL concatenado que o Princípio II
 * proíbe. `satisfies` faz o `typecheck` reprovar um provedor acrescentado
 * ao enum sem URL correspondente.
 */
const PROVIDER_STATUS_URLS = {
  github: "https://www.githubstatus.com/api/v2/status.json",
  cloudflare: "https://www.cloudflarestatus.com/api/v2/status.json",
} as const satisfies Record<ProviderName, string>;

/**
 * Conjunto fechado (R-009): um indicador fora destes quatro valores é
 * tratado como resposta inválida, nunca repassado como estado desconhecido
 * — o consumidor é um modelo decidindo "é nosso ou é deles?", e um
 * indicador que ele não sabe interpretar é pior que uma recusa explícita.
 */
const indicatorSchema = z.enum(["none", "minor", "major", "critical"]);
export type Indicator = z.infer<typeof indicatorSchema>;

const statuspageResponseSchema = z.object({
  status: z.object({
    indicator: indicatorSchema,
    description: z.string(),
  }),
});

/** FR-027: quem está de plantão não conhece a convenção do statuspage.io. */
const INDICATOR_LABELS: Record<Indicator, string> = {
  none: "operacional",
  minor: "degradação parcial",
  major: "interrupção grave",
  critical: "interrupção crítica",
};

type FailureKind = "timeout" | "unavailable" | "invalid-response";

export type ProviderStatusResult =
  | { ok: true; provider: ProviderName; indicator: Indicator; description: string }
  | { ok: false; provider: ProviderName; failure: FailureKind; attempts: number };

interface ProviderStatusDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Marca uma resposta 5xx do provedor — o único caso em que o próprio corpo
 * da função lança de propósito, para reusar o mesmo `catch` que trata as
 * falhas do `fetch` (rede, timeout). `classify` precisa reconhecê-la
 * explicitamente: sem isso, ela cai no ramo padrão (`invalid-response`, que
 * NÃO retenta) e a retentativa de FR-010 simplesmente não acontece para
 * 5xx, com o sintoma escondido atrás de "resposta em formato inesperado".
 */
class UpstreamError extends Error {}

/**
 * Classifica uma falha de tentativa por identidade do erro (`error.name` /
 * `instanceof` sobre uma marca própria), nunca pela posição no código
 * (R-002, R-004): `res.json()` produz tanto `TimeoutError` (o limite de
 * espera cobre a leitura do corpo, não só os cabeçalhos) quanto
 * `SyntaxError` (corpo não-JSON), e as duas caem em lados opostos da
 * política de retentativa.
 */
function classify(error: unknown): { kind: FailureKind; retryable: boolean } {
  if (error instanceof Error && error.name === "TimeoutError") {
    return { kind: "timeout", retryable: true };
  }
  if (error instanceof UpstreamError) {
    // 5xx: falha do lado do provedor (FR-010).
    return { kind: "unavailable", retryable: true };
  }
  if (error instanceof TypeError) {
    // Falha de rede — conexão recusada, DNS, TLS (FR-010).
    return { kind: "unavailable", retryable: true };
  }
  // SyntaxError (corpo não-JSON) e falha de `.parse` (fora do esquema):
  // repetir dá o mesmo resultado (FR-012).
  return { kind: "invalid-response", retryable: false };
}

/**
 * Consulta o status publicado por um provedor, com no máximo duas
 * tentativas (INV-A, SC-005). Nunca lança: todo caminho termina num
 * `ProviderStatusResult` (FR-015, FR-016).
 */
export async function checkProviderStatus(
  provider: ProviderName,
  deps: ProviderStatusDeps = {},
): Promise<ProviderStatusResult> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const url = PROVIDER_STATUS_URLS[provider];

  for (let attempt = 1; attempt <= 2; attempt++) {
    // ⚠️ O sinal é criado DENTRO do laço, uma vez por tentativa (FR-009,
    // R-003). Criá-lo uma vez fora do laço e reusá-lo nas duas tentativas
    // é a forma "óbvia" de escrever isto, e é um bug silencioso: um sinal
    // já disparado faz a segunda tentativa falhar na hora com o erro da
    // primeira, e TODOS os testes de contagem de tentativas continuam
    // verdes — o número de chamadas ao fetch injetado ainda é 2. O que
    // pega essa regressão é o teste que afirma que nenhum sinal recebido
    // pelo dublê chegou já abortado (T020).
    const signal = AbortSignal.timeout(5000);
    try {
      const response = await doFetch(url, { signal });

      if (response.status >= 500) {
        // Falha do lado do provedor: retenta (FR-010).
        throw new UpstreamError(`upstream respondeu ${response.status}`);
      }
      if (!response.ok) {
        // 4xx é atribuível ao pedido: repetir não mudaria o resultado
        // (FR-011) — sai sem retentativa.
        return { ok: false, provider, failure: "unavailable", attempts: attempt };
      }

      // O limite de espera cobre também a leitura do corpo (R-004): o
      // mesmo `signal` que pode abortar o fetch pode abortar o parse.
      const body: unknown = await response.json();
      const parsed = statuspageResponseSchema.parse(body);
      return {
        ok: true,
        provider,
        indicator: parsed.status.indicator,
        description: parsed.status.description,
      };
    } catch (error) {
      const { kind, retryable } = classify(error);
      if (!retryable || attempt === 2) {
        return { ok: false, provider, failure: kind, attempts: attempt };
      }
      // Sem espera entre tentativas (assunção registrada em research.md
      // R-005): com uma única retentativa, um recuo progressivo só
      // somaria latência ao pior caso, já ~10s.
    }
  }

  // Inatingível: o laço sempre retorna dentro de si (2 iterações fixas).
  throw new Error("unreachable");
}

const FAILURE_LABELS: Record<FailureKind, (attempts: number) => string> = {
  timeout: (attempts) => `o provedor não respondeu em 5s, ${attempts} tentativa${attempts > 1 ? "s" : ""}`,
  unavailable: (attempts) => `o provedor não está respondendo, ${attempts} tentativa${attempts > 1 ? "s" : ""}`,
  "invalid-response": (attempts) =>
    `resposta em formato inesperado, ${attempts} tentativa${attempts > 1 ? "s" : ""}`,
};

/**
 * Formata o resultado como uma linha de texto (FR-024, FR-025) — retorno
 * compacto, para não inflar o contexto do modelo (R-010). Nunca devolve o
 * corpo bruto recebido do provedor (FR-026).
 *
 * A linha de falha sempre começa por "não foi possível confirmar o
 * status": nenhum retorno de sucesso produz esse prefixo, o que é o que
 * garante que um erro nunca seja lido como "provedor operando normalmente"
 * (FR-019).
 */
export function formatProviderStatus(result: ProviderStatusResult): string {
  if (result.ok) {
    return `${result.provider}: ${INDICATOR_LABELS[result.indicator]} — ${result.description}`;
  }
  const reason = FAILURE_LABELS[result.failure](result.attempts);
  return `${result.provider}: não foi possível confirmar o status (${reason})`;
}
