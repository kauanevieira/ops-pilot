# Quickstart: Medição de Contexto

**Feature**: `010-context-measurement`

## Portão offline (sempre)

```bash
npm run typecheck
npm test
```

Nenhum teste chama modelo. O consumo real é testado disparando os callbacks do contador com
`LLMResult` montados à mão; a decomposição é testada com estratégia falsa no `/chat`. Casos
esperados: [contracts/token-measurement.md](./contracts/token-measurement.md) (E1–E5, U1–U4,
K1–K5, R1–R3, B1–B5) e [contracts/chat-endpoint.md](./contracts/chat-endpoint.md) (M1–M8).

## Verificação manual (precisa de `OPENROUTER_API_KEY`)

```bash
npm run dev
```

1. **Consumo real e decomposição num pedido (US1, US2)**:

   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"quais alertas críticos estão abertos?"}' \
     | jq '.metrics | {llmCalls, promptTokens, contextBreakdown}'
   ```

   → `promptTokens` é um inteiro bem maior que `contextBreakdown.total`. Os esquemas das
   ferramentas e as chamadas repetidas do ReAct entram no real e não na estimativa.
   `contextBreakdown` tem `history: 0` e `memories: 0`.

2. **Reflexão soma o crítico (FR-007)**: repita com `"reflect": true`. `llmCalls` e
   `promptTokens` sobem juntos em relação ao passo 1.

3. **Curva da conversa longa (US3)**:

   ```bash
   ./scripts/conversa-longa.sh
   ```

   → 16 linhas. `est.hist` cresce do turno 1 ao 7 e depois oscila só pelo tamanho das
   mensagens; `promptTokens` acompanha a mesma forma. Nenhuma linha com `n/d` é esperada
   com o OpenRouter.

4. **Falha visível do roteiro**: com o servidor parado,
   `./scripts/conversa-longa.sh; echo "saída=$?"` → `turno 1 falhou: …` e `saída=` diferente
   de 0.

5. **Nada mudou fora do `/chat` (FR-015)**: `npm run arena -- "quais alertas estão abertos?"`
   imprime a mesma linha de métricas de antes (`llmCalls | latencyMs | stoppedReason`).
