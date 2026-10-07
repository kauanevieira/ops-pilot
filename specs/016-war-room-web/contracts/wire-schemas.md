# Contract: Esquemas de rede em `src/domain/wire.ts`

**Feature**: `016-war-room-web` | Satisfaz FR-011 e o Princípio I

Fonte única dos formatos que a API devolve e a war room lê. **Nenhum formato de resposta muda
com esta feature.** Os esquemas descrevem o que 003 a 015 já publicam, mais o 202 proposto em
[approval-flow.md](./approval-flow.md).

## Esquemas

| Esquema | Descreve | Notas |
|---|---|---|
| `traceEventSchema` | `TraceEvent`: união discriminada por `type` dos 9 tipos + `nodeName?` | `type` de cada membro casa com `traceEventTypeSchema`; `args: z.record(z.string(), z.unknown())` |
| `contextBreakdownSchema` | `ContextBreakdown` | 5 contadores inteiros ≥ 0 |
| `runMetricsSchema` | `RunMetrics` | `llmCalls`, `latencyMs` obrigatórios; o resto opcional; `z.object` (descarta desconhecidos) |
| `strategyResultSchema` | `StrategyResult` | `trace: z.array(traceEventSchema)` |
| `chatResponseSchema` | 200 do `/chat` | `strategyResultSchema` + `conversationId` + `requestId`, mas com `trace: z.array(z.unknown())` (validação tolerante, R-004) |
| `apiErrorBodySchema` | corpo de erro | `{ error: { code: string, message: string, details?: unknown }, requestId?: string }`. `code` é `string` na leitura, para tolerar códigos futuros. Quem escreve continua tipado por `ApiErrorCode` |
| `pendingActionSchema` | `approval` do 202 | `id`, `tool`, `args`, `description`, `expiresAt?` (ISO) |
| `chatAcceptedSchema` | 202 | `status: "pending_approval"`, `requestId`, `conversationId`, `approval`, `trace?: unknown[]` |
| `approvalDecisionSchema` | corpo de `POST /approvals/:id` | `{ decision: z.enum(["approve", "deny"]) }` |
| `approvalDeniedSchema` | 200 de negação | `{ status: "denied", approvalId, conversationId, requestId }` |

## Garantias

- **WS1**: `src/trace/types.ts` exporta `TraceEvent`, `RunMetrics`, `ContextBreakdown`,
  `StrategyResult` e `StoppedReason` como `z.infer` desses esquemas. Os nomes exportados e todos
  os imports existentes continuam iguais, e `npm run typecheck` passa sem tocar em outros
  arquivos.
- **WS2**: `_TraceTypesInSync` passa a comparar `traceEventSchema` com `traceEventTypeSchema`, e
  continua falhando em compilação se um tipo for acrescentado de um lado só.
- **WS3**: todo `StrategyResult` produzido pelos testes existentes (fixtures de 003 a 015) passa em
  `strategyResultSchema.parse` (teste em `src/domain/wire.test.ts`).
- **WS4**: os arquivos de `src/domain/` (fora os `*.test.ts`) só importam `zod` ou arquivos de
  `src/domain/`. Um teste lê os imports e falha caso contrário. É o que deixa a war room importar o
  domínio no navegador.
- **WS5**: a API não passa a validar as próprias respostas em tempo de execução. Os esquemas são
  fonte de tipo para ela e validação de entrada para a war room.
