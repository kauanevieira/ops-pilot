# Quickstart: Conversa Persistente

**Feature**: `007-persistent-conversation` | Roteiro de validação antes de integrar.

## 1. Portões offline (obrigatórios)

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, sem rede e sem credenciais. Novos alvos:

| Arquivo | Cobre |
|---|---|
| `src/store/sqlite-conversation-store.test.ts` | contrato CV1–CV10 sobre `":memory:"`, `CHECK` de papel, sincronia CHECK ↔ enum, reabertura |
| `src/store/in-memory-conversation-store.test.ts` | a mesma bateria de contrato sobre o fake |
| `src/agents/conversation-history.test.ts` | `formatHistoryInput`, decorador com estratégia falsa, `historyMessages`, composição com `withReflection` |
| `src/http/server.test.ts` (ampliado) | FR-027: cria/devolve id, continuação, teto 12, 400, 404, falha não grava |

Nenhum teste existente deve precisar mudar além de `server.test.ts` ganhar casos novos.

## 2. Arena, bench e MCP inalterados (SC-007)

```bash
npm run arena -- "quais alertas estão abertos?"
```

Esperado: mesma saída de antes — `formatMetrics` não mostra `historyMessages`, e a entrada
chega à estratégia sem prefixo de histórico.

## 3. Conversa ponta a ponta (online, requer credencial do modelo)

```bash
rm -f ./data/opspilot.db   # opcional: começar do zero
npm run dev
```

Em outro terminal:

```bash
# 1º turno — sem conversationId
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"qual serviço tem alerta crítico disparando?"}' | tee /tmp/t1.json \
  | jq '{conversationId, historyMessages: .metrics.historyMessages, answer}'
```

Esperado: `conversationId` presente, `historyMessages: 0`.

```bash
# 2º turno — continuação que depende do 1º
ID=$(jq -r .conversationId /tmp/t1.json)
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d "{\"message\":\"e qual é o runbook dele?\",\"conversationId\":\"$ID\"}" \
  | jq '{conversationId, historyMessages: .metrics.historyMessages, answer}'
```

Esperado: mesmo `conversationId`, `historyMessages: 2`, e a resposta trata do runbook do
serviço identificado no 1º turno (SC-001).

## 4. Persistência entre reinícios (SC-005)

Pare o `npm run dev` (Ctrl+C), suba de novo, e repita o 2º turno com o mesmo `$ID`.
Esperado: `historyMessages: 4`.

## 5. Erros

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi","conversationId":"   "}' | jq .error.code      # "invalid_body"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi","conversationId":"conv-nao-existe"}'            # 404
```

## 6. Inspeção direta do banco

```bash
node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("./data/opspilot.db");
console.table(db.prepare("SELECT conversation_id, id, role, substr(content,1,40) c FROM messages ORDER BY conversation_id, id").all());'
```

Esperado: pares `user`/`assistant` alternados por conversa; nenhuma conversa sem mensagens
depois de pedidos que falharam (SC-004).
