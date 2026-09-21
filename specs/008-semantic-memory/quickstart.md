# Quickstart: Memória Semântica

**Feature**: `008-semantic-memory` | Roteiro de validação antes de integrar.

## 0. Instalação

```bash
npm install          # traz @huggingface/transformers (~744 MB em node_modules, R-001)
```

## 1. Portões offline (obrigatórios)

```bash
npm run typecheck
npm test
```

Esperado: tudo verde, sem rede e sem credenciais. Sem o modelo em cache, o teste semântico
aparece como **skipped** — não como pass:

```text
# skipped 1
```

| Arquivo | Cobre |
|---|---|
| `src/memory/memory-store.test.ts` | M1–M14 com gerador falso sobre `":memory:"` |
| `src/memory/embeddings.test.ts` | singleton/retry com carga falsa; modelo real (pulado sem cache) |
| `src/memory/memory-tools.test.ts` | as duas ferramentas, auditoria de descrição/esquema |
| `src/memory/with-memory.test.ts` | `formatMemoriesInput`, `extraTools`, `recalledMemories`, composição com `withReflection` e `withConversationHistory` |
| `src/http/server.test.ts` (ampliado) | FR-035: com/sem `userId`, 400, recall fail-open |

## 2. Teste semântico com o modelo real

```bash
npm run memory:model   # baixa o modelo (113 MB) para data/models/, uma vez — requer rede
npm test               # agora o teste semântico roda: 0 skipped
```

Esperado: "Meu time de plantão é o de pagamentos" é recuperado por "quem cobre cobranças e
faturamento?" (nenhuma palavra em comum) e não por "como reinicio o banco de dados?".

## 3. Arena, bench e MCP inalterados (FR-032)

```bash
npm run arena -- "quais alertas estão abertos?"
```

Mesma saída de antes. O MCP continua listando só `list_alerts`, `list_incidents`,
`open_incident`, `resolve_incident`.

## 4. Ponta a ponta (online, requer credencial do modelo de linguagem)

```bash
npm run dev
```

```bash
# guarda
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"userId":"kauane","message":"lembra que meu time de plantão é o de pagamentos"}' \
  | jq '{answer, recalled: .metrics.recalledMemories, tools: [.trace[] | select(.type=="action") | .tool]}'
# esperado: tools contém "remember_fact"

# recupera, em outra conversa, sem palavra em comum
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"userId":"kauane","message":"quem cobre cobranças e faturamento?"}' \
  | jq '{answer, recalled: .metrics.recalledMemories}'
# esperado: recalled >= 1, resposta menciona o time da pessoa

# outro usuário não vê
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"userId":"outra-pessoa","message":"quem cobre cobranças e faturamento?"}' \
  | jq .metrics.recalledMemories
# esperado: 0

# sem userId: sem o campo
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"oi"}' | jq '.metrics | has("recalledMemories")'
# esperado: false
```

## 5. Esquecer

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"userId":"kauane","message":"esquece que meu time é o de pagamentos, mudei de time"}' \
  | jq '[.trace[] | select(.type=="action") | .tool]'
# esperado: contém "forget_fact"; o pedido de recuperação do passo 4 passa a dar 0
```

## 6. Inspeção do banco

```bash
node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("./data/opspilot.db");
console.table(db.prepare("SELECT id, user_id, fact, length(embedding) bytes, created_at FROM memories").all());'
```

Esperado: `bytes = 1536` em toda linha; nenhuma linha duplicada para o mesmo fato dito de outro
jeito.
