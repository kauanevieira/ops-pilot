# Quickstart: Camada de Reflexão

**Feature**: `002-reflection-layer` | **Date**: 2026-09-18

Guia de validação: como provar que a feature funciona ponta a ponta depois de implementada.
Não contém código de implementação — ver [contracts/](./contracts/) e
[data-model.md](./data-model.md) para as formas exatas.

---

## Pré-requisitos

1. **Node 22 LTS ou superior**. Verificar com `node --version`. O ambiente atual roda
   **22.22.2** — o bloqueio registrado na 001 está resolvido (R-012).
2. Dependências instaladas: `npm install`. Esta feature **não acrescenta nenhuma
   dependência nova**.
3. A feature 001 implementada e funcionando (`npm run arena` roda `react` e
   `plan-and-execute`).
4. Credenciais do OpenRouter em `.env` (a partir de `.env.example`) — só para as validações
   online:

   ```text
   OPENROUTER_API_KEY=<sua chave>
   OPENROUTER_MODEL=<ex.: openai/gpt-4o-mini>
   ```

---

## Validação 1 — Portões de qualidade (offline)

```bash
npm run typecheck
npm test
```

**Esperado**: ambos verdes. Diferente da 001, aqui **o ciclo inteiro da feature é coberto
offline** — o crítico e a estratégia base são injetados como dublês determinísticos
(R-004). Os testes novos devem cobrir, no mínimo:

| Caso | Prova |
|---|---|
| Crítico aprova de primeira | base roda 1×, 1 evento `critique`, `stoppedReason` da base |
| Crítico reprova depois aprova | base roda 2×, 2 eventos `critique`, resposta = a da 2ª tentativa |
| Crítico reprova sempre | base roda `maxReflections + 1`×, `stoppedReason: "max-reflections"` (FR-014, FR-015, SC-003) |
| `maxReflections: 0` | base roda 1×, nenhum evento `critique`, resultado idêntico ao da base (FR-016) |
| Crítico lança | `run` resolve normalmente, rastro tem `critique` com `indisponível:` (FR-017, FR-020, SC-006) |
| Soma de métricas | `llmCalls` = soma das tentativas + chamadas do crítico (FR-022) |
| Ordem do rastro | crítica imediatamente após o `answer` que avaliou (FR-019) |
| Nome derivado | `withReflection(fake).name === "reflect:<nome-da-fake>"` (FR-003) |
| `buildCritiqueContext` | extrai `observation`/`action` em ordem; rastro sem observação → lista vazia |

---

## Validação 2 — Ciclo de reflexão ponta a ponta (online)

```bash
npm run arena -- "quais alertas estão disparando?" --strategies reflect:react
```

**Esperado**:

- Saída sob o cabeçalho `━━━ reflect:react ━━━`.
- O rastro termina com pelo menos um evento `[critique]`, cujo texto começa com `aprovado:`
  ou `reprovado:`.
- A linha final de métricas mostra `llmCalls` maior que o de `react` puro sobre o mesmo
  pedido, e `stoppedReason` entre `completed` e `max-reflections`.

---

## Validação 3 — Comparação com e sem reflexão (online, SC-004 e SC-007)

```bash
npm run arena -- "liste os alertas disparando e diga quais serviços estão afetados" \
  --strategies react,reflect:react,plan-and-execute,reflect:plan-and-execute
```

**Esperado**:

- Quatro blocos de saída, um por estratégia, cada um com rastro e métricas próprios.
- Cada bloco `reflect:*` tem `llmCalls` estritamente maior que o do seu par cru (SC-004),
  desde que tenha havido ao menos uma revisão.
- Cada estratégia parte de um estado semeado independente — a arena já cria um store novo
  por estratégia, então uma abertura de incidente em `react` não aparece em `reflect:react`.

---

## Validação 4 — Regeneração de fato acontece (online, SC-002)

Pedido escolhido para induzir uma primeira resposta sem evidência:

```bash
npm run arena -- "o serviço de pagamentos está saudável? responda sim ou não" \
  --strategies reflect:react
```

**Esperado**: se a primeira resposta afirmar saúde sem ter consultado alertas, o rastro
mostra `[critique] reprovado: ...` seguido de **novas** ações de ferramenta e de um segundo
`[answer]`. A resposta final impressa pela arena é a da última tentativa.

> Se o crítico aprovar de primeira, o caso não foi induzido — é resultado válido, não
> falha. Repetir com um pedido mais ambíguo.

---

## Validação 5 — Nomes inválidos continuam claros (FR-025)

```bash
npm run arena -- "teste" --strategies reflect:nao-existe
```

**Esperado**: erro com código de saída 1, mensagem `Estratégia(s) desconhecida(s): ...` e a
lista de válidas contendo os **quatro** nomes, incluindo `reflect:react` e
`reflect:plan-and-execute`.

---

## Validação 6 — Risco conhecido: efeito colateral duplicado (R-002)

```bash
npm run arena -- "abra um incidente para o alerta mais crítico que estiver disparando" \
  --strategies reflect:react
```

**Inspecionar**: se houve regeneração, contar os eventos `[action] open_incident` no
rastro. Mais de um para o mesmo alerta significa que o contexto anti-repetição não segurou.

**Esta validação pode falhar sem invalidar a feature** — R-002 assume mitigação por
contexto, não garantia. Se falhar com frequência, a recomendação registrada é tornar
`open_incident` idempotente, o que é uma mudança de domínio fora do escopo desta feature.

---

## Portão de aceitação

| # | Critério | Como |
|---|---|---|
| 1 | `npm run typecheck` e `npm test` verdes | Validação 1 |
| 2 | Ciclo de reflexão visível no rastro | Validação 2 |
| 3 | Quatro estratégias comparáveis na arena | Validação 3 |
| 4 | Reflexão custa mais e entrega resposta revisada | Validações 3 e 4 |
| 5 | Falha do crítico não derruba a execução | Validação 1 (offline) |
| 6 | Mensagem de nome inválido atualizada | Validação 5 |
