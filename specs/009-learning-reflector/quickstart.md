# Quickstart: Refletor de Aprendizado

**Feature**: `009-learning-reflector`

## Portão offline (sempre)

```bash
npm run typecheck
npm test
```

Nenhum teste chama modelo de linguagem: o distiller é sempre falso nos testes, e o helper do
servidor injeta um "sem aprendizado" por padrão. O teste com modelo de vetores real da 008
continua pulado quando o modelo não está em cache.

## Verificação manual (precisa de `OPENROUTER_API_KEY` e do modelo de vetores)

```bash
npm run memory:model   # uma vez, se ainda não baixou
npm run dev
```

1. **Aprende de passagem (US1)**:

   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"sou do time de pagamentos, quais alertas estão abertos?","userId":"ana"}'
   ```

   A resposta chega normalmente. Logo depois, o log do servidor mostra uma linha
   `learned` com `userId: "ana"` e um `memoryId` (sem o texto do fato).

2. **Recupera em outra conversa**: sem `conversationId`,

   ```bash
   curl -s localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"quem cobre faturamento?","userId":"ana"}' | jq .metrics.recalledMemories
   ```

   → `1` ou mais.

3. **Pedido pontual não vira memória (US2)**: `"abre um incidente no checkout"` com
   `userId` → nenhuma linha `learned` no log.

4. **Segredo não vira memória (US2)**: `"a senha do grafana é Pr0d!2024"` com `userId` →
   nenhuma linha `learned`; o refletor para antes de chamar o modelo.

5. **Esquecer (US3)**: `"esquece que sou de pagamentos"` com `userId: "ana"` → o rastro mostra
   `forget_preference`; repetir o passo 2 → `recalledMemories` cai.

6. **Sem `userId`**: nenhum log do refletor e `metrics.llmCalls` igual ao de antes.

Conferir direto no banco, se preferir:

```bash
sqlite3 data/opspilot.db "select user_id, fact, created_at from memories order by created_at desc limit 5;"
```
