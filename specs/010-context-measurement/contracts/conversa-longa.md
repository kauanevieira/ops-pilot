# Contract: `scripts/conversa-longa.sh`

**Feature**: `010-context-measurement` | Satisfaz FR-018 a FR-022

Roteiro de demonstração. Precisa do servidor no ar com credenciais reais; **não** faz parte
de `npm test`.

## Uso

```bash
npm run dev                            # outro terminal
./scripts/conversa-longa.sh
OPSPILOT_URL=http://localhost:4000 ./scripts/conversa-longa.sh
```

| Variável | Default | Significado |
|---|---|---|
| `OPSPILOT_URL` | `http://localhost:3000` | base do servidor; o roteiro chama `$OPSPILOT_URL/chat` |

Requer `bash`, `curl` (com `--fail-with-body`, 7.76+) e `jq`.

## Comportamento

- **S1**: envia 16 mensagens fixas, em ordem, sem `userId` e sem `strategy` (estratégia
  padrão). O turno 1 vai sem `conversationId`; os turnos 2–16 usam o `conversationId`
  devolvido pelo turno 1.
- **S2**: imprime um cabeçalho e uma linha por turno, assim que o turno responde:

  ```text
  conversa 3f2c…  (http://localhost:3000)
  turno  promptTokens  llmCalls  est.msg  est.hist  est.mem  est.total
      1          1834         2        9         0        0          9
      2          2410         2       11        62        0         73
    …
      9      n/d              3       12       402        0        414
  ```

  `n/d` quando `metrics.promptTokens` não veio (FR-019). Colunas vêm de `metrics` e
  `metrics.contextBreakdown`.
- **S3**: resposta não 2xx ou falha de conexão: imprime `turno N falhou:` seguido do corpo de
  erro (ou da mensagem do `curl`) em stderr e sai com código ≠ 0 (FR-022). Nada é tentado
  depois.
- **S4**: 16 turnos gravam 32 mensagens, bem acima da janela de 12 (6 turnos). `est.hist`
  para de crescer em número de mensagens a partir do turno 7 (FR-020, SC-004).
- **S5**: com `jq` ou `curl` ausentes, falha no início com mensagem dizendo o que falta.

As mensagens são perguntas de plantão sobre o seed (alertas, incidentes, serviços, runbooks),
com acompanhamentos que dependem do histórico ("e o runbook dele?"), para que a conversa
faça sentido e não só encha a janela.
