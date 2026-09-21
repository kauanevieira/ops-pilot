# Quickstart: Sumarização de Histórico

**Feature**: 011-history-summarization

Roteiro de validação. Os contratos estão em [contracts/](./contracts/) e o modelo em
[data-model.md](./data-model.md).

## 0. Portões offline (obrigatórios)

```bash
npm run typecheck
npm test
```

Sem `.env`, sem rede. Espera-se tudo verde, incluindo:

- contrato do store com CV11–CV18 nas duas implementações, e CV19 no SQLite;
- `planConversationContext` (P1–P2) em tabela;
- `prepareConversationContext` (C1–C8) com store em memória e sumarizador falso;
- `capSummary`, `formatSummarizerInput`, blocos (H1–H5), `formatTrace` com `summarize`;
- `/chat` de ponta a ponta com sumarizador falso: contagem de chamadas numa conversa longa,
  evento, falha, tempo esgotado e a expectativa reescrita do antigo teste "teto de 12".

## 1. Sumarização real numa conversa longa (manual, com credenciais)

```bash
npm run dev                      # terminal 1, com OPENROUTER_* no .env
./scripts/conversa-longa.sh      # terminal 2
```

Esperado:
- a coluna `resumo` mostra `+8` nos turnos **9** e **13**, e em nenhum outro;
- `est.sum` é 0 até o turno 8 e positivo a partir do 9;
- `est.hist` cai nos turnos 9 e 13; `est.hist + est.sum` não cresce de forma contínua.

## 2. O resumo preserva o que importa

Ainda com o servidor da etapa 1, pegar o `conversationId` do cabeçalho do roteiro e perguntar
sobre algo decidido nos primeiros turnos (abertura do incidente no checkout, turno 4):

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"qual incidente abrimos no começo desta conversa?","conversationId":"<id>"}' \
  | jq '{answer, summarize: (.trace | map(select(.type == "summarize")) | first), historyMessages: .metrics.historyMessages, covered: .metrics.summaryCoveredMessages}'
```

Esperado: a resposta cita o incidente do checkout, mesmo com o turno 4 fora da janela desde o
turno 9. Este pedido provoca a terceira sumarização: há 32 mensagens gravadas, o resumo cobre
16, e 8 estão pendentes. Por isso `summarize` é o evento com `absorbedMessages: 8`, `covered` é
24 e `historyMessages` é 8.

## 3. Persistência

Parar o servidor (Ctrl+C), subir de novo com `npm run dev` e repetir o `curl` da etapa 2.

Esperado: `covered` continua 24, `historyMessages` é 10 (34 gravadas, 24 resumidas) e
`summarize` vem `null`. O resumo foi lido do banco, não refeito.

```bash
sqlite3 data/opspilot.db \
  "SELECT conversation_id, covered_messages, length(content), updated_at FROM conversation_summaries;"
```

Esperado: uma linha por conversa resumida, `length(content) ≤ 800`.

## 4. Nada muda fora do `/chat`

```bash
npm run arena -- "quais alertas críticos estão abertos?" --strategies react
```

Esperado: saída no mesmo formato de antes, sem `[summarize]`.
