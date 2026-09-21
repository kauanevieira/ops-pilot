# Contract: `scripts/conversa-longa.sh` (emenda)

**Feature**: `011-history-summarization` | Satisfaz FR-030

Emenda [`010-context-measurement/contracts/conversa-longa.md`](../../010-context-measurement/contracts/conversa-longa.md).
S1, S3 e S5 não mudam. As 16 mensagens continuam as mesmas.

## Mudanças

- **S2 (emenda)**: duas colunas novas, `est.sum` (de `metrics.contextBreakdown.summary`) e
  `resumo`, que mostra `+N` quando o rastro traz o evento `summarize` (N =
  `absorbedMessages`) e fica vazia caso contrário:

  ```text
  turno  promptTokens  llmCalls  est.msg  est.hist  est.sum  est.mem  est.total  resumo
      8          3120         2       10       340        0        0        350
      9          2890         3       12       255       48        0        315  +8
     10          3010         2       11       310       48        0        369
    …
     13          2950         2       10       262       61        0        333  +8
  ```

- **S4 (substitui)**: 16 turnos gravam 32 mensagens. Com janela 8 e rodadas de 8, a
  sumarização acontece no início dos turnos 9 e 13 (16 e 24 mensagens gravadas). `est.hist`
  cai nesses turnos e volta a subir até a próxima rodada, e `est.hist + est.sum` fica limitado
  em vez de crescer a cada turno (SC-005).
- **S6 (novo)**: o comentário do roteiro que cita "janela de 12 (6 turnos)" passa a citar a
  janela de 8 e as duas sumarizações esperadas.
