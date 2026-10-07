# Data Model: War Room Web

**Feature**: `016-war-room-web` | **Date**: 2026-10-07

Nada novo é persistido na API. Os esquemas de dados que trafegam pela rede vivem em
`src/domain/wire.ts` ([contracts/wire-schemas.md](./contracts/wire-schemas.md)). Este documento
descreve o estado da war room e as transições dele.

## ApiUrlSetting (navegador)

| Campo | Tipo | Regra |
|---|---|---|
| `url` | string | `http:`/`https:` absoluta, sem barra final (R-009) |
| `source` | `"saved" \| "default"` | `saved` só se o valor do `localStorage` passar em `parseApiUrl` |
| `persistent` | boolean | `false` se o `localStorage` lançar exceção. A UI avisa (FR-018) |

Chave: `opspilot.apiUrl`. Um valor salvo inválido é ignorado e o padrão vale.

## Conversation (memória, reducer puro)

```ts
interface ConversationState {
  conversationId: string | null;   // do primeiro 200/202; null = conversa nova
  items: ConversationItem[];       // em ordem de exibição
  inFlight: boolean;               // pedido do /chat ou decisão em andamento
}

type ConversationItem =
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "answer"; id: string; result: ChatResponse; at: string }        // tem "ver raciocínio"
  | { kind: "approval"; id: string; pending: ChatAccepted; state: ApprovalState; at: string }
  | { kind: "error"; id: string; error: DisplayError; retryText?: string; at: string };

type ApprovalState =
  | { status: "pending" }
  | { status: "deciding"; decision: "approve" | "deny" }
  | { status: "approved" }                       // a resposta final vira um item "answer" seguinte
  | { status: "denied" }
  | { status: "rejected"; reason: string };       // API recusou a decisão (FR-015)
```

`ChatResponse` e `ChatAccepted` são `z.infer` dos esquemas em `src/domain/wire.ts`. `id` e `at`
vêm do componente-raiz (Princípio I).

### Seletor

- `canSend(state) = !state.inFlight && !items.some(i => i.kind === "approval" && (i.state.status === "pending" || i.state.status === "deciding"))` (FR-003, US3-6).

### Ações e transições

| Ação | Efeito |
|---|---|
| `send(id, text, at)` | + item `user`; `inFlight = true`. Ignorada se `!canSend` |
| `answered(id, result, at)` | + item `answer`; `conversationId = result.conversationId`; `inFlight = false` |
| `pending(id, accepted, at)` | + item `approval{pending}`; `conversationId = accepted.conversationId`; `inFlight = false` |
| `failed(id, error, retryText, at)` | + item `error`; `inFlight = false`. Se `error.code === "conversation_not_found"`, o item oferece "nova conversa" |
| `decide(itemId, decision)` | só se o item está `pending` → `deciding`; `inFlight = true` (FR-013) |
| `decided(itemId, outcome, newItemId?, at?)` | `approved` + item `answer` com o resultado final; `denied`; ou `rejected{reason}`; `inFlight = false` |
| `reset()` | estado inicial (`conversationId = null`, `items = []`) |

Invariantes: um cartão sai de `pending` uma única vez. `deciding` só leva a
`approved | denied | rejected`, e nenhum estado final volta atrás (SC-004).

## DisplayError

| Campo | Origem |
|---|---|
| `kind` | `"api" \| "unreachable" \| "malformed"` |
| `code` | `error.code` da API (`kind = "api"`) |
| `message` | texto em português por código (tabela em [web-ui.md](./contracts/web-ui.md)), mais a mensagem da API quando ela ajuda |
| `requestId` | `requestId` do corpo ou `X-Request-Id`, quando presente |
| `url` | URL tentada (`kind = "unreachable"`) |

## ParsedTraceEvent (war room)

`KnownEvent` = `z.infer<typeof traceEventSchema>`. `UnknownEvent` = `{ kind: "unknown"; type:
string | null; raw: unknown }`. A ordem é sempre a do array recebido.

## ChatOutcome (cliente)

```ts
type ChatOutcome =
  | { kind: "answered"; result: ChatResponse }
  | { kind: "pending"; accepted: ChatAccepted }
  | { kind: "api-error"; status: number; body: ApiErrorBody; requestId?: string }
  | { kind: "unreachable"; url: string; reason: "network" | "timeout" }
  | { kind: "malformed"; status: number; requestId?: string };
```

`classifyResponse(status, headers, json)` é pura: 200 → `chatResponseSchema`, 202 →
`chatAcceptedSchema`, 4xx/5xx → `apiErrorBodySchema`. Status fora disso, ou esquema que falha,
dá `malformed`.

## Origem autorizada (API)

`corsOrigins: string[]`, normalizadas (`new URL(o).origin`). Vem de `OPSPILOT_CORS_ORIGINS`
(vírgulas, espaços ignorados, pelo menos uma origem). Default: `["http://localhost:5173"]`.
