# Contract: `POST /chat` (emenda)

**Feature**: `012-unified-graph` | Satisfaz FR-001, FR-005, FR-014 a FR-025

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007 a 011. **O corpo da requisição e os corpos de erro não mudam.**

## O que muda para quem chama

1. **Sem `strategy` e sem `reflect: true`**: a estratégia deixa de ser sempre `react` e passa a
   ser escolhida pelo roteador entre `react`, `plan-and-execute` e `reflect` (reflexão sobre
   ReAct).
2. **Com `strategy` ou `reflect: true`**: nada muda na execução. A escolha é imposta e o
   roteador não é consultado.
3. **200**: o rastro ganha um evento `route`, e todo evento ganha `nodeName`.

## Requisição

| Campo | Tipo | Obrigatório | Efeito |
|---|---|---|---|
| `strategy` | `"react"` \| `"plan-and-execute"` | não | Presente: override. Ausente: roteado, salvo `reflect: true` |
| `reflect` | `boolean` | não | `true`: override (reflexão sobre `strategy`, padrão `react`). `false` ou ausente: não força nada |

Os demais campos (`message`, `conversationId`, `userId`) não mudam.

## Resposta 200

```jsonc
{
  "answer": "…",
  "trace": [
    { "type": "summarize", "content": "…", "absorbedMessages": 8, "nodeName": "context" },   // só quando resumiu (011)
    { "type": "route", "route": "plan-and-execute", "strategy": "plan-and-execute",          // NOVO, sempre
      "reason": "Investigar, achar o responsável e abrir incidente são etapas dependentes.",
      "source": "router", "nodeName": "router" },
    { "type": "plan", "steps": ["…"], "revision": 0, "nodeName": "plan-and-execute" },       // nodeName NOVO em todo evento
    …
    { "type": "answer", "content": "…", "nodeName": "plan-and-execute" }
  ],
  "stoppedReason": "completed",
  "conversationId": "…",
  "metrics": { "llmCalls": 6, … }                                                             // NÃO inclui o roteador
}
```

Override (`{ "strategy": "plan-and-execute", "reflect": true }`):

```jsonc
{ "type": "route", "route": "reflect", "strategy": "reflect:plan-and-execute",
  "reason": "Estratégia imposta pelo pedido.", "source": "override", "nodeName": "router" }
```

Recuo:

```jsonc
{ "type": "route", "route": "react", "strategy": "react",
  "reason": "Roteador indisponível; seguindo com react.", "source": "fallback", "nodeName": "router" }
```

## Garantias

- **CH1**: todo 200 traz exatamente um `route`, logo depois do `summarize` (se houver) e antes de
  qualquer evento da estratégia (FR-017, FR-019, SC-001).
- **CH2**: todo evento de todo 200 traz `nodeName` (FR-020, SC-001).
- **CH3**: com `strategy` ou `reflect: true`, o roteador não é consultado (FR-015, SC-002), e
  `resolveStrategy` recebe a seleção exatamente como hoje.
- **CH4**: sem override, `resolveStrategy` recebe a seleção da rota decidida: `react` →
  `{react, false}`, `plan-and-execute` → `{plan-and-execute, false}`, `reflect` → `{react,
  true}`.
- **CH5**: falha do roteador nunca muda o status. É 200 com `source: "fallback"` e ReAct
  (FR-012, SC-003).
- **CH6**: 400 (`strategy` vazia) e 422 (`strategy` desconhecida, com `validStrategies`)
  continuam idênticos e acontecem antes de qualquer nó, logo sem consultar o roteador (FR-016).
- **CH7**: o roteamento conta dentro do prazo do pedido. Estouro vira 504, e o turno não é
  gravado. Uma falha técnica da estratégia continua 500 (FR-006).
- **CH8**: `llmCalls`, `promptTokens` e `latencyMs` não incluem o roteador (FR-022). Os demais
  campos de `metrics`, incluindo `contextBreakdown`, não mudam (FR-023).
- **CH9**: gravação do turno, 404 de conversa inexistente e refletor de aprendizado (009) não
  mudam.

## `ChatAppDeps`

| Campo | Tipo | Default |
|---|---|---|
| `router` | `Router` | `createModelRouter()` (construído sem ler env) |
| `routerTimeoutMs` | `number` | `ROUTER_TIMEOUT_MS` (15 s) |

`src/index.ts` passa `createModelRouter()`.

## Ordem do handler

```text
parse (400) → [override: resolveStrategy (422)] → conversa (404)
  → graph.run({ message, conversationId, userId, override }, signal), com prazo (504/500)
      context → router → react | plan-and-execute | reflect → response
  → grava o turno → 200 → [userId: aprendizado]
```
