# Contract: Critic

**Feature**: `002-reflection-layer` | Satisfies FR-007 a FR-010, FR-017

O avaliador que julga a resposta de uma tentativa contra as evidências do seu rastro.

## Interface

```ts
type Critic = (context: CritiqueContext, callbacks: BaseCallbackHandler[]) => Promise<Critique>;

const critiqueSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
});

function buildCritiqueContext(input: string, result: StrategyResult): CritiqueContext;  // pura
function createLlmCritic(): Critic;                                                     // efeitosa
```

**Refinamento feito na implementação** (ver [data-model.md](../data-model.md)): `callbacks` é
fornecido pelo *chamador* (o decorator), não pelo crítico — é assim que a chamada do crítico entra
na soma de `llmCalls` sem o crítico precisar expor seu próprio contador.

## Obrigações do implementador padrão (`createLlmCritic`)

| # | Obrigação | Requisito |
|---|-----------|-----------|
| 1 | Usa `createModel()` — a fábrica única, sem configuração de modelo própria | FR-007, R-003 |
| 2 | Usa `withStructuredOutput(critiqueSchema)`; nada de `JSON.parse` manual | FR-009, R-003 |
| 3 | Encaminha o `callbacks` recebido para `.invoke(...)`, para o chamador somar as chamadas | FR-022, R-008 |
| 4 | Não recebe ferramentas: julga só com o que está no contexto | assumption |
| 5 | Lança em falha de rede/timeout/parecer inválido — o `try/catch` é do decorator | FR-017, R-009 |

## Obrigações de `buildCritiqueContext`

| # | Obrigação | Requisito |
|---|-----------|-----------|
| 1 | É pura: mesma entrada, mesma saída, sem I/O — é o alvo dos testes offline | R-004 |
| 2 | `input` é o **pedido original**, nunca o input enriquecido da regeneração | data-model |
| 3 | Extrai `observation` e `action` do rastro preservando a ordem | FR-008 |
| 4 | Rastro sem observações produz `observations: []`, não erro | edge case |

## Critérios de julgamento (prompt do crítico)

O crítico reprova quando qualquer um se aplica (FR-010):

1. A resposta **contradiz** alguma observação registrada.
2. A resposta **afirma fato operacional** (alerta, incidente, serviço, estado) que nenhuma
   observação sustenta — inclusive quando não há observação alguma.
3. A resposta **não atende** ao que foi pedido, ou atende só em parte.

Aprova quando a resposta é sustentada pelas observações e cobre o pedido. Questões de
estilo, tom ou verbosidade **não** são motivo de reprovação.

`feedback` de uma reprovação deve ser acionável: dizer o que está errado e o que falta,
não apenas que está errado — é ele que entra no contexto da regeneração (FR-012).

## Garantias para o chamador

- O retorno sempre valida contra `critiqueSchema`, ou a promessa rejeita.
- O crítico não altera o estado operacional: não tem acesso ao store nem às ferramentas.
