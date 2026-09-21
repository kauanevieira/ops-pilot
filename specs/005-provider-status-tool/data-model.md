# Data Model: Status de provedores externos

**Feature**: `005-provider-status-tool` | **Fase**: 1 | **Data**: 2026-09-18

Esta feature **não adiciona entidade de domínio, tabela, coluna nem migração**. Nada é
persistido (R-014) e `src/domain/` e `src/store/` ficam intocados. O que segue são os tipos
em trânsito, todos internos a `src/agents/provider-status.ts`.

---

## Provedor suportado

Conjunto fechado, definido uma vez como enum zod e derivado por inferência (Princípio I):

```ts
export const providerSchema = z.enum(["github", "cloudflare"]);
export type ProviderName = z.infer<typeof providerSchema>;
```

| Valor | Origem de consulta | Padrão |
|---|---|---|
| `github` | `https://www.githubstatus.com/api/v2/status.json` | ✅ (FR-003) |
| `cloudflare` | `https://www.cloudflarestatus.com/api/v2/status.json` | |

A tabela vive no código como constante (R-012), ligada ao enum por `satisfies
Record<ProviderName, string>` — acrescentar um provedor ao enum sem URL reprova no
`typecheck`. Acrescentar um provedor é, por construção, mudança de dados: uma linha no enum
e uma na tabela.

**Invariantes**

- INV-1: todo `ProviderName` tem exatamente uma URL, fixa e versionada no projeto (FR-005).
- INV-2: nenhum valor vindo do modelo participa da construção da URL (FR-005, FR-008, R-012).
- INV-3: o conjunto é fechado no esquema da ferramenta, nunca `z.string()` (FR-032,
  Princípio IV regra 6).

---

## Resposta do provedor (fronteira de entrada)

O que se valida do corpo recebido — o mínimo que a feature usa, com todo o resto descartado
(FR-023, R-009):

```ts
const statuspageResponseSchema = z.object({
  status: z.object({
    indicator: z.enum(["none", "minor", "major", "critical"]),
    description: z.string(),
  }),
});
```

| Campo | Tipo | Significado |
|---|---|---|
| `status.indicator` | enum fechado | nível da ocorrência, do normal ao crítico |
| `status.description` | texto | frase publicada pelo provedor, ex. `All Systems Operational` |

**Invariantes**

- INV-4: o corpo é validado antes de qualquer uso; o que não satisfaz o esquema é falha,
  nunca estado parcial (FR-021, FR-022).
- INV-5: campos não declarados são descartados e nunca chegam ao agente (FR-023, FR-026).
- INV-6: um indicador desconhecido é resposta inválida, não um estado repassado (R-009).

> ⚠️ O pedido da feature nomeia o campo como `indicador`; o payload real do padrão
> statuspage.io o chama `indicator`. O esquema valida o nome real — ver Assumptions na spec.

---

## Resultado da consulta (fronteira de saída)

O tipo interno que a função devolve, antes de virar a linha de texto:

```ts
type ProviderStatusResult =
  | { ok: true;  provider: ProviderName; indicator: Indicator; description: string }
  | { ok: false; provider: ProviderName; failure: FailureKind; attempts: number };

type FailureKind = "timeout" | "unavailable" | "invalid-response";
```

`FailureKind` é o que a FR-017 exige distinguir, e é o que a linha de erro traduz:

| `FailureKind` | Quando | Retenta? |
|---|---|---|
| `timeout` | espera de 5 s esgotada em uma tentativa | sim (R-005) |
| `unavailable` | falha de rede, ou HTTP 5xx | sim |
| `unavailable` | HTTP 4xx | não (FR-011) |
| `invalid-response` | corpo não-JSON, ou fora do esquema | não (FR-012) |

**Invariantes**

- INV-7: `attempts` ∈ {1, 2} sempre; nunca 3 (FR-010, SC-005).
- INV-8: o resultado de sucesso nunca é construído a partir de um corpo não validado (INV-4).
- INV-9: a forma textual de `ok: false` é inconfundível com a de `ok: true` (FR-019) — ver
  `contracts/check-provider-status.md`.

---

## Tradução do indicador para a linha de retorno

| `indicator` | Texto na linha |
|---|---|
| `none` | `operacional` |
| `minor` | `degradação parcial` |
| `major` | `interrupção grave` |
| `critical` | `interrupção crítica` |

A tabela existe para que a resposta sirva a quem está de plantão sem conhecer a convenção do
statuspage.io (FR-027). A `description` publicada pelo provedor vem logo depois, íntegra: é
ela que costuma dizer *o que* está degradado.

---

## O que esta feature NÃO toca

- `src/domain/schemas.ts` e `src/domain/errors.ts` — o estado de um provedor externo não é
  entidade do OpsPilot, e a falha ao consultá-lo não é erro de domínio: é uma observação
  sobre o mundo lá fora, e não uma regra de negócio violada.
- `src/store/**` — nada é lido nem gravado (R-014).
- O esquema do banco, o seed e o `.env.example` — nenhuma configuração nova (FR-006, SC-010).
