# Contract: Arena CLI

**Feature**: `001-reasoning-core` | Satisfies FR-030 a FR-033

Comando de comparação de estratégias. É ferramenta de desenvolvimento, não interface de
plantão.

## Invocação

```bash
npm run arena -- "<pedido>" [--strategies <lista>] [--max-iterations <n>]
```

## Argumentos

| Argumento | Tipo | Default | Regras |
|-----------|------|---------|--------|
| posicional | `string` | — | O pedido em linguagem natural. Obrigatório. |
| `--strategies` | lista separada por vírgula | todas as registradas | Cada nome MUST existir no registro |
| `--max-iterations` | inteiro | definido no registro | MUST ser ≥ 1 |

Os argumentos são validados com zod antes de qualquer execução (convenção de projeto:
zod na fronteira CLI).

## Comportamento

1. Valida argumentos. Falha ⇒ erro e código de saída diferente de zero, **sem** executar
   nenhuma estratégia (FR-033).
2. Carrega a linha de base do estado.
3. Para cada estratégia selecionada, executa o **mesmo** pedido sobre um estado
   recém-semeado, de modo que as estratégias não interfiram umas nas outras.
4. Imprime, por estratégia, o rastro completo e as métricas, identificados pelo nome.

## Saída

Formato legível por humano, uma seção por estratégia:

```text
━━━ react ━━━
  [thought]     ...
  [action]      list_alerts {"status":"firing"}
  [observation] 3 alertas...
  [answer]      ...

  llmCalls: 3 | latencyMs: 2140 | stoppedReason: completed
```

Nenhum requisito de saída legível por máquina nesta versão (registrado em Assumptions da
spec).

## Erros

| Condição | Comportamento |
|----------|---------------|
| Nome de estratégia desconhecido | Erro listando os nomes válidos; nada executa (FR-033) |
| Pedido ausente | Erro com mensagem de uso |
| `OPENROUTER_API_KEY` ou `OPENROUTER_MODEL` ausente | Erro nomeando a variável (FR-010) |
| Estratégia para por limite | **Não** é erro: imprime rastro parcial e `stoppedReason` |
