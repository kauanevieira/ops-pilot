# Contract: `POST /chat` (emenda)

**Feature**: `009-learning-reflector` | Satisfaz FR-001 a FR-004, FR-016, FR-020, FR-022, FR-023

Emenda [`003-chat-http-api/contracts/chat-endpoint.md`](../../003-chat-http-api/contracts/chat-endpoint.md),
já emendado pela 007 e pela 008. **Nenhuma mudança no corpo da requisição nem da resposta.**

## O que muda

1. **Ferramentas de memória** (com `userId`): o agente recebe só `forget_preference`
   (antes: `remember_fact` e `forget_fact`). Ver [memory-tools.md](./memory-tools.md).
2. **Aprendizado depois da resposta** (com `userId`, só no 200): depois de gravar a rodada na
   conversa (007) e enviar a resposta, o handler dispara o refletor sobre a `message` crua,
   sem esperar. Ver [learning-reflector.md](./learning-reflector.md).

Ordem do handler, com o acréscimo em negrito:

```text
parse (400) → estratégia (422) → conversa (404)
  → [com userId: recall fail-open + withMemory(forget_preference)] → execução com prazo (504/500)
  → append da rodada → 200
  → **[com userId: learn(userId, message).then(onLearning)] — sem await**
```

## Garantias

- **C1**: sem `userId`, o refletor não é criado nem chamado; nenhuma chamada extra ao modelo
  (FR-003, SC-007).
- **C2**: 400, 404, 422, 504 e 500 não disparam o refletor (FR-003) — inclusive 500 vindo de
  falha no `append`.
- **C3**: o corpo do 200 é idêntico ao da 008; nenhum campo novo em `metrics` (spec,
  Assumptions), `llmCalls` não inclui a chamada do refletor (R-010).
- **C4**: o 200 é enviado antes de o distiller resolver; um distiller que nunca resolve não
  impede a resposta (FR-002).
- **C5**: o refletor recebe a `message` do corpo (após o `trim` do esquema), nunca o texto
  enriquecido com histórico ou fatos (FR-004).
- **C6**: `onLearning` é chamado exatamente uma vez por pedido elegível, com o desfecho.

## Dependências injetáveis (`ChatAppDeps`)

| Campo | Default | Nos testes |
|---|---|---|
| `distiller?: Distiller` | `createModelDistiller()` | falso determinístico (FR-022) |
| `learningTimeoutMs?: number` | `LEARNING_TIMEOUT_MS` (30 000) | curto, para o caso de tempo esgotado |
| `onLearning?: (o: LearningOutcome) => void` | `logLearningOutcome` | sonda que resolve uma promessa (FR-023) |

O helper `withServer` de `server.test.ts` passa por padrão um distiller "sem aprendizado" e um
`onLearning` vazio, para que os testes da 007/008 com `userId` nunca alcancem
`createModelDistiller()`.

## Aviso na 003

O bloco de emendas no topo do contrato da 003 ganha:

> **Emendado também por `009-learning-reflector`**: com `userId`, o agente passa a dispor só de
> `forget_preference` (substitui `remember_fact`/`forget_fact`), e fatos duráveis da mensagem
> são aprendidos automaticamente depois da resposta. Corpo e resposta não mudam. Ver
> [`specs/009-learning-reflector/contracts/chat-endpoint.md`](../../009-learning-reflector/contracts/chat-endpoint.md).

E o aviso da 008 sobre `remember_fact`/`forget_fact` recebe "(substituídas na 009)".
