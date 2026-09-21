# Contrato: ferramenta `check_provider_status`

**Feature**: `005-provider-status-tool` | **Fase**: 1 | **Data**: 2026-09-18

Acrescenta a **sexta** ferramenta ao catálogo estabelecido em
[`specs/004-sqlite-persistence/contracts/ops-tools.md`](../../004-sqlite-persistence/contracts/ops-tools.md),
que segue válido para as cinco existentes. A única alteração naquele contrato está na
§ "Fronteira recíproca", ao final.

---

## Assinatura

```
check_provider_status(provider?: "github" | "cloudflare") -> string
```

- Somente leitura. Não altera estado do OpsPilot (FR-007).
- Nunca lança para fora do corpo (FR-015).
- Sem credencial, sem variável de ambiente (FR-006).

## Esquema de entrada

| Campo | Tipo | Obrigatório | Padrão | `.describe()` |
|---|---|---|---|---|
| `provider` | `z.enum(["github","cloudflare"])` | não | `"github"` | "Provedor externo cuja página pública de status será consultada: github ou cloudflare. Padrão: github." |

Conjunto fechado como enum (Princípio IV, regra 6; FR-032). **Nunca `z.string()`** — ver
R-006 para o motivo pelo qual o teste do caso inválido tende a empurrar nessa direção.

## Retorno — sucesso

Uma linha (FR-024, FR-025):

```
<provedor>: <nível> — <descrição publicada pelo provedor>
```

Exemplos:

```
github: operacional — All Systems Operational
cloudflare: degradação parcial — Some systems are experiencing issues
github: interrupção crítica — Widespread outage
```

O nível vem da tabela de tradução em [`../data-model.md`](../data-model.md). O corpo bruto
recebido **nunca** é devolvido (FR-026).

## Retorno — falha

Uma linha, sempre começando por `<provedor>: não foi possível confirmar o status` — prefixo
que nenhum retorno de sucesso pode produzir (FR-019):

| Natureza | Linha |
|---|---|
| `timeout` | `github: não foi possível confirmar o status (o provedor não respondeu em 5s, 2 tentativas)` |
| `unavailable` | `github: não foi possível confirmar o status (o provedor não está respondendo, 2 tentativas)` |
| `invalid-response` | `github: não foi possível confirmar o status (resposta em formato inesperado, 1 tentativa)` |

Toda linha identifica o provedor (FR-018) e a natureza da falha (FR-017), e nenhuma expõe
rastro de pilha ou estrutura interna (FR-020).

## Descrição exposta ao modelo

> Consulta a página pública de status de um provedor externo e diz se ele está operando
> normalmente. Use quando houver suspeita de que o problema vem de fora — "é o nosso ou é do
> provedor?", "o GitHub está fora?", uma dependência externa que parou de responder, um
> deploy ou um login que falha sem alerta interno correspondente. Não use para o que o nosso
> monitoramento está acusando (`list_alerts`) nem para o que foi registrado pelo plantão
> (`list_incidents`): esta ferramenta olha para fora, e o que ela devolve é o que o provedor
> publica sobre si, não o estado dos nossos serviços. Devolve uma linha com o nível do
> estado e a descrição publicada pelo provedor; quando o provedor não responde ou responde
> fora do formato esperado, devolve uma linha dizendo que o status não pôde ser confirmado —
> que não deve ser lida como "está tudo bem".

### Auditoria pelas 6 regras (Princípio IV)

| Regra | Onde está atendida |
|---|---|
| 1. O que faz | "Consulta a página pública de status … e diz se ele está operando normalmente." |
| 2. Quando usar | "suspeita de que o problema vem de fora", com três gatilhos na linguagem do plantão (FR-029) |
| 3. Quando NÃO usar | fronteira explícita contra `list_alerts` e `list_incidents` — interno × externo (FR-030) |
| 4. O que devolve | a linha de status **e** o caso de falha, com o alerta de não lê-lo como "tudo bem" (FR-031, FR-019) |
| 5. Todo campo descrito | `provider` tem `.describe()` com valores aceitos e padrão (FR-032) |
| 6. Conjuntos fechados são enums | `provider` é `z.enum`, nunca `z.string()` |

## Comportamento

### Resiliência

| Situação | Tentativas | Resultado |
|---|---|---|
| 200 + corpo válido | 1 | sucesso |
| falha de rede → 200 válido | 2 | sucesso; a falha não aparece no retorno (FR-004 de US2) |
| 5xx → 200 válido | 2 | sucesso |
| timeout → timeout | 2 | falha `timeout` |
| 5xx → 5xx | 2 | falha `unavailable` |
| 4xx | **1** | falha `unavailable`, sem retentativa (FR-011) |
| corpo não-JSON ou fora do esquema | **1** | falha `invalid-response`, sem retentativa (FR-012) |
| provedor fora do enum | **0** | rejeitado no esquema, antes do corpo (FR-004, R-006) |

- Limite de 5 s **por tentativa**, via `AbortSignal.timeout(5000)` criado dentro de cada
  tentativa (R-003). Pior caso total ~10 s (FR-013, SC-003).
- O limite cobre também a leitura do corpo (R-004).
- Sem espera entre tentativas.

### Invariantes

- INV-A: nunca mais de 2 tentativas (SC-005).
- INV-B: nenhuma exceção escapa do corpo da ferramenta (FR-015).
- INV-C: cada tentativa recebe um sinal próprio, não abortado (R-003) — verificável pelo dublê.
- INV-D: nenhum dado do OpsPilot é enviado ao provedor (FR-008, R-013).
- INV-E: nada é persistido nem cacheado (R-014).

## Injeção do `fetch`

```ts
export function createOpsTools(
  store: OpsRepository,
  deps: { fetchImpl?: typeof fetch } = {},
): /* … */
```

- Default `globalThis.fetch`: a composição real não passa nada (FR-034), e os três call
  sites existentes (`react.ts:36`, `plan-and-execute.ts:64`, `tools.test.ts`) continuam
  compilando sem alteração.
- Os testes passam o dublê direto a `createOpsTools` (FR-033). A cadeia
  `BASE_FACTORIES → createStrategy → resolveStrategy` **não** muda — ver R-007.

---

## Fronteira recíproca — alteração em `list_alerts`

O Princípio IV, regra 3, é recíproco: a ferramenta vizinha também precisa declarar a
fronteira. A descrição de `list_alerts` hoje delimita-se apenas contra `list_incidents`.
Com uma sexta ferramenta que também responde "o que está acontecendo", ela passa a precisar
dizer que trata de sinal **interno** (FR-030).

**Alteração mínima em `src/agents/tools.ts`**, na descrição de `list_alerts`, após a frase
que a separa de `list_incidents`:

> … para esses, use `list_incidents`. Também não use para saber se um provedor externo está
> fora do ar: alerta é o nosso monitoramento sobre os nossos serviços; para o estado de um
> provedor, use `check_provider_status`.

Nenhuma outra descrição muda: `open_incident`, `resolve_incident` e `consultar_runbook` não
são confundíveis com uma consulta de status externo.
