# Phase 1 — Data Model: API HTTP de Chat

**Feature**: `003-chat-http-api` | **Date**: 2026-09-18

As entidades que esta feature acrescenta, os tipos existentes que ela altera, e o que ela
deliberadamente **não** toca.

---

## 1. Entidades novas

### `ChatRequest` — o corpo aceito pelo endpoint

Camada: **Controller** (`src/http/chat.ts`). Validado com zod na fronteira (R-003).

| Campo | Tipo | Obrigatório | Padrão | Regra de validação |
|---|---|---|---|---|
| `message` | `string` | sim | — | `.trim()`, mínimo 1 caractere após trim |
| `strategy` | `string` | não | `"react"` (FR-007) | `.trim()`, mínimo 1 caractere após trim |
| `reflect` | `boolean` | não | `false` (FR-008) | booleano estrito — `"true"` (string) é inválido |

```ts
const chatRequestSchema = z.object({
  message:  z.string().trim().min(1, "message é obrigatória e não pode ser vazia."),
  strategy: z.string().trim().min(1, "strategy não pode ser vazia.").optional(),
  reflect:  z.boolean().optional().default(false),
});

type ChatRequest = z.infer<typeof chatRequestSchema>;
```

**Campos desconhecidos são descartados**, não rejeitados — `z.object`, não
`z.strictObject` (edge case da spec).

**O que o schema deliberadamente não valida**: a *existência* do nome em `strategy`. Isso é
um passo posterior, porque é o que separa 400 de 422 (R-003).

---

### `ChatSuccessResponse` — o corpo de uma resposta 200

```ts
interface ChatSuccessResponse {
  answer: string;
  trace: TraceEvent[];
  metrics: RunMetrics;
  stoppedReason: StoppedReason;
}
```

Isto **é** o `StrategyResult` de `src/trace/types.ts`, sem transformação alguma (R-012).
Não há tipo novo a declarar: o handler devolve o que a estratégia produziu.

- `trace` preserva conteúdo e ordem originais (FR-004).
- `metrics` é `{ llmCalls, latencyMs }` daquela execução; cada `run()` cria seu próprio
  `LlmCallCounter`, então não há acúmulo entre requisições (FR-005).
- `stoppedReason ∈ "completed" | "max-iterations" | "max-steps" | "max-reflections"`
  (FR-006). Encerrar por limite é **sucesso**, não erro — 200 com resposta parcial.

---

### `ChatErrorResponse` — o corpo de qualquer resposta de erro

```ts
type ChatErrorCode = "invalid_body" | "unknown_strategy" | "timeout" | "internal";

interface ChatErrorResponse {
  error: {
    code: ChatErrorCode;
    message: string;
    details?: unknown;
  };
}
```

| `code` | Status | `details` | Origem |
|---|---|---|---|
| `invalid_body` | 400 | `ValidationIssue[]` | falha do `chatRequestSchema`, ou JSON malformado (R-005) |
| `unknown_strategy` | 422 | `{ validStrategies: string[] }` | nome ausente de `baseStrategyNames()` |
| `timeout` | 504 | — | deadline de 180s atingido (R-006) |
| `internal` | 500 | — | qualquer exceção inesperada; nunca carrega stack nem mensagem interna (FR-017) |

```ts
interface ValidationIssue {
  path: string;     // "message", "reflect" — issue.path.join(".")
  message: string;  // mensagem do zod
  code: string;     // issue.code do zod, ex.: "too_small", "invalid_type"
}
```

A montagem é uma **função pura** `toErrorBody(code, message, details?): ChatErrorResponse`
em `src/http/errors.ts`, testável sem HTTP.

---

### `ChatAppDeps` — as dependências injetáveis da aplicação

Camada: **Controller**. É o que torna o teste de integração offline e determinístico
(FR-022, R-007).

```ts
type ResolveStrategy = (
  selection: { name?: string; reflect?: boolean },
  store: OpsRepository,
) => ReasoningStrategy;

interface ChatAppDeps {
  store?: OpsRepository;             // default: new InMemoryOpsRepository(baselineState())
  resolveStrategy?: ResolveStrategy; // default: o de src/agents/index.ts
  timeoutMs?: number;                // default: 180_000 (FR-018)
}
```

`resolveStrategy` lança quando o nome não existe; o handler traduz isso em 422.

---

## 2. Tipos existentes alterados

### `RunOptions` (`src/agents/types.ts`) — ganha `signal`

```ts
export interface RunOptions {
  maxIterations?: number;
  /** NOVO: cancela a execução em andamento (FR-020, R-006). */
  signal?: AbortSignal;
}
```

Alteração **aditiva e opcional**. Arena e bench continuam chamando `run()` sem o campo, com
comportamento idêntico (FR-012). Quem consome:

| Arquivo | O que faz com `signal` |
|---|---|
| `react.ts` | repassa na config do `agent.stream(...)` |
| `plan-and-execute.ts` | repassa na config do `graph.stream(...)` e das duas `.invoke()` diretas (planner e replanner) |
| `reflection.ts` | já encaminha `runOptions` íntegro à base; ganha uma checagem de `signal.aborted` **entre** tentativas, para não iniciar uma regeneração já cancelada |

---

## 3. O registry (`src/agents/index.ts`)

Não é uma entidade de dados, mas é o contrato de resolução que a API consome. Detalhado em
[contracts/strategy-registry.md](./contracts/strategy-registry.md).

Correspondência entre as duas superfícies, sobre a **mesma** implementação (R-002):

| Entrada da API | Equivalente na arena | Estratégia resolvida |
|---|---|---|
| `{ strategy: "react" }` | `react` | `createReactStrategy(store)` |
| `{ strategy: "react", reflect: true }` | `reflect:react` | `withReflection(createReactStrategy(store))` |
| `{ strategy: "plan-and-execute" }` | `plan-and-execute` | `createPlanAndExecuteStrategy(store)` |
| `{ strategy: "plan-and-execute", reflect: true }` | `reflect:plan-and-execute` | `withReflection(createPlanAndExecuteStrategy(store))` |
| `{ strategy: "reflect:react" }` | — | **erro** → 422 (a reflexão na API é o campo `reflect`) |

---

## 4. Estado operacional — sem entidade nova

`WorldState`, `Service`, `Alert` e `Incident` (`src/domain/schemas.ts`, `src/store/types.ts`)
**não mudam**. O que esta feature define é o *ciclo de vida* da instância, não a forma:

- **Uma** instância de `InMemoryOpsRepository`, criada no bootstrap a partir de
  `baselineState()`, compartilhada por todas as requisições (FR-012a).
- Sem lock nem cópia por requisição (FR-012b) — as transições do repositório são síncronas
  de ponta a ponta, então não há atualização perdida (R-008).
- Só na memória do processo; `seed.json` nunca é reescrito, então reiniciar volta ao
  baseline (FR-012c).

---

## 5. Configuração de ambiente

Camada: bootstrap (`src/index.ts`). Entrada externa, logo validada com zod (R-011).

| Variável | Tipo | Padrão | Quem usa |
|---|---|---|---|
| `PORT` | inteiro 1–65535 | `3000` | `src/index.ts` |
| `OPENROUTER_API_KEY` | string não vazia | — (obrigatória) | `src/agents/model.ts`, já existente |
| `OPENROUTER_MODEL` | string não vazia | — (obrigatória) | `src/agents/model.ts`, já existente |

As duas variáveis do OpenRouter continuam sendo exigidas **no momento da chamada**, por
`createModel()` — não na subida do servidor. Uma consequência aceita: o servidor sobe sem
credenciais e só falha ao atender o primeiro pedido, com 500. O teste de integração nunca
chega lá, porque a estratégia falsa não chama modelo.
