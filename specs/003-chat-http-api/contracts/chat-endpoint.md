# Contract: `POST /chat`

**Feature**: `003-chat-http-api` | Satisfies FR-001 a FR-008, FR-013 a FR-021

> **Emendado por `007-persistent-conversation`**: o corpo ganhou `conversationId`
> opcional, a resposta ganhou `conversationId` e `metrics.historyMessages`, e uma nova
> resposta 404 `conversation_not_found` foi adicionada. Ver
> [`specs/007-persistent-conversation/contracts/chat-endpoint.md`](../../007-persistent-conversation/contracts/chat-endpoint.md)
> para os acréscimos; tudo o que está registrado abaixo continua valendo.
>
> **Emendado também por `008-semantic-memory`**: o corpo ganhou `userId` opcional, a
> resposta ganhou `metrics.recalledMemories` quando `userId` é informado, e o agente
> passa a dispor das ferramentas `remember_fact`/`forget_fact` nesse caso (substituídas
> na 009). Ver
> [`specs/008-semantic-memory/contracts/chat-endpoint.md`](../../008-semantic-memory/contracts/chat-endpoint.md).
>
> **Emendado também por `009-learning-reflector`**: com `userId`, o agente passa a
> dispor só de `forget_preference` (substitui `remember_fact`/`forget_fact`), e fatos
> duráveis da mensagem são aprendidos automaticamente depois da resposta. Corpo e
> resposta não mudam. Ver
> [`specs/009-learning-reflector/contracts/chat-endpoint.md`](../../009-learning-reflector/contracts/chat-endpoint.md).

O único endpoint da feature. Recebe um pedido em linguagem natural, executa uma estratégia
de raciocínio e devolve o resultado da execução.

## Requisição

```http
POST /chat
Content-Type: application/json
```

```jsonc
{
  "message": "quais alertas estão abertos?",  // obrigatório, não vazio
  "strategy": "react",                        // opcional, default "react"
  "reflect": false                            // opcional, default false
}
```

Forma e regras em [data-model.md](../data-model.md#chatrequest--o-corpo-aceito-pelo-endpoint).
Campos desconhecidos são descartados sem erro.

## Resposta 200

```jsonc
{
  "answer": "Há 3 alertas abertos: ...",
  "trace": [
    { "type": "thought", "content": "..." },
    { "type": "action", "tool": "list_alerts", "args": { "status": "open" } },
    { "type": "observation", "content": "..." },
    { "type": "answer", "content": "..." }
  ],
  "metrics": { "llmCalls": 3, "latencyMs": 8421 },
  "stoppedReason": "completed"
}
```

É o `StrategyResult` sem transformação (R-012). `stoppedReason` é acréscimo desta spec
(FR-006) sobre o `{ answer, trace, metrics }` originalmente descrito — sem ele o cliente não
distingue resposta completa de resposta truncada por limite.

**Encerramento por limite é 200, não erro**: `"max-iterations"`, `"max-steps"` e
`"max-reflections"` devolvem a resposta parcial com status de sucesso.

## Respostas de erro

Todas com o corpo de [`ChatErrorResponse`](../data-model.md#chaterrorresponse--o-corpo-de-qualquer-resposta-de-erro).

### 400 — `invalid_body` (FR-014)

Disparado por: `message` ausente/vazia/não-string, `strategy` vazia ou não-string, `reflect`
não-booleano, corpo ausente, ou corpo que não é JSON válido (R-005).

```jsonc
{
  "error": {
    "code": "invalid_body",
    "message": "Corpo da requisição inválido.",
    "details": [
      { "path": "message", "message": "message é obrigatória e não pode ser vazia.", "code": "too_small" }
    ]
  }
}
```

**Nenhuma execução de agente é iniciada** (SC-003): a validação acontece antes da resolução
da estratégia.

### 422 — `unknown_strategy` (FR-015)

Corpo bem formado, mas `strategy` não está em `baseStrategyNames()`. Inclui
`strategy: "reflect:react"` — na API a reflexão é o campo `reflect`, não um prefixo de nome.

```jsonc
{
  "error": {
    "code": "unknown_strategy",
    "message": "Estratégia desconhecida: \"planner\".",
    "details": { "validStrategies": ["react", "plan-and-execute"] }
  }
}
```

A lista vem de `baseStrategyNames()`, a mesma fonte usada na validação (FR-011) — não é
literal escrita à mão.

### 504 — `timeout` (FR-019)

A execução ultrapassou `timeoutMs` (180 000 em produção).

```jsonc
{ "error": { "code": "timeout", "message": "A execução excedeu o tempo limite de 180000ms." } }
```

Nenhum resultado parcial é devolvido — resposta parcial só existe em 200, com
`stoppedReason` explicando por quê.

### 500 — `internal` (FR-017)

Qualquer exceção inesperada. `details` é sempre omitido; nem mensagem de exceção nem stack
aparecem no corpo. O processo não cai e segue atendendo (SC-006).

## Obrigações do handler

1. **Ordem fixa**: parse do corpo → validação de forma (400) → resolução da estratégia
   (422) → execução com deadline (504/500) → 200. Nenhum passo posterior roda se um
   anterior falhou.
2. **Exatamente uma resposta por requisição** (FR-021), mesmo quando a execução termina
   logo depois do deadline: a escrita é guardada por `res.headersSent`.
3. **Cancelar de verdade ao estourar o deadline** (FR-020): o `AbortSignal` chega à
   estratégia; a corrida contra o relógio garante o status no tempo certo (R-006).
4. **Não deixar rejeição órfã**: o lado perdedor da corrida tem `.catch()`, para que uma
   execução abortada não vire `unhandledRejection`.
5. **Um `LlmCallCounter` por execução** — já garantido pelas estratégias; o handler não
   acumula nada entre requisições (FR-005).
6. **Não tocar o rastro**: sem filtro, sem reordenação, sem truncamento (FR-004).

## Fora do contrato

- Autenticação e autorização.
- Streaming da resposta, execução assíncrona com consulta posterior, histórico de conversa.
- `maxIterations` no corpo — vale `DEFAULT_MAX_ITERATIONS` (12).
- Qualquer outra rota.
