# Research: Conversa Persistente

**Feature**: `007-persistent-conversation` | **Fase**: 0 | **Data**: 2026-09-21

Decisões técnicas tomadas antes do desenho. Cada uma fecha uma incógnita do Technical
Context do [plan.md](./plan.md). Verificações marcadas com ✅ foram executadas contra o
runtime real deste repositório (Node 22.22.2), não presumidas da documentação.

---

## R-001 — `ConversationStore` síncrono, contrato próprio

**Decisão**: interface nova `ConversationStore` em `src/store/conversation-store.ts`, com
três métodos **síncronos** — `create()`, `append(conversationId, messages)`,
`lastMessages(conversationId, limit)` — separada de `OpsRepository` (FR-004, FR-008).

**Rationale**: `DatabaseSync` é síncrono (004, R-001) e `OpsRepository` também; manter a
mesma forma evita `await` numa interface e não na outra, e deixa o fake trivial. Separar
os contratos em vez de estender `OpsRepository` impede que arena, bench, MCP e as
ferramentas passem a depender de algo que não usam — e que um dublê de `OpsRepository`
nos testes antigos precise implementar conversas.

**Alternativas consideradas**:
- Estender `OpsRepository` com os métodos de conversa — acopla as ferramentas do agente a
  um armazenamento que elas nunca devem tocar, e obriga todos os dublês existentes a
  mudar.
- Interface assíncrona "para o futuro" — não há implementação assíncrona à vista; a
  constituição manda a alternativa mais simples vencer sem justificativa registrada.

---

## R-002 — Conversa inexistente: erro de domínio, não método `exists`

**Decisão**: `append` e `lastMessages` lançam `ConversationNotFoundError` (nova classe em
`src/domain/errors.ts`) quando a conversa não existe. Não há quarto método para checar
existência.

**Rationale**: o pedido fixa três operações (FR-004). `lastMessages` precisa de qualquer
forma distinguir "conversa vazia" de "conversa inexistente" — `[]` para as duas seria
ambíguo — então é ele que carrega a checagem que o handler usa para responder 404
(FR-013). `append` verifica antes de tocar SQL, como `openIncident` já faz com
`ServiceNotFoundError`; a chave estrangeira é a segunda linha de defesa.

✅ **Verificado**: com `PRAGMA foreign_keys = ON`, inserir mensagem com `conversation_id`
inexistente falha com `FOREIGN KEY constraint failed`.

---

## R-003 — Tabela `conversations` além de `messages`

**Decisão**: duas tabelas — `conversations (id, created_at)` e `messages (id INTEGER
PRIMARY KEY, conversation_id REFERENCES conversations, role CHECK, content, created_at)`.

**Rationale**: sem uma linha própria, uma conversa só "existe" quando tem mensagem — e
FR-005 (append em conversa inexistente falha) e FR-013 (404) não teriam como ser
verificados. É a suposição já registrada na spec.

**Alternativa considerada**: só `messages`, com conversa implícita — descartada pelo motivo
acima.

---

## R-004 — Ordem total por `INTEGER PRIMARY KEY`

**Decisão**: a ordem das mensagens é `messages.id` (rowid), não `created_at`. Consulta das
N últimas:

```sql
SELECT * FROM (
  SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
) ORDER BY id
```

**Rationale**: FR-006 exige ordem estável inclusive entre mensagens do mesmo instante — e
as duas mensagens de um turno são gravadas no mesmo milissegundo. `created_at` empataria;
o rowid é monotônico enquanto nada for apagado, e esta feature não apaga nada. Não é
preciso `AUTOINCREMENT` (que só garante não-reuso após exclusão). A subconsulta pega as
N mais recentes e as devolve em ordem cronológica numa única ida ao banco, com `LIMIT`
como parâmetro ligado — sem SQL montado.

✅ **Verificado**: 15 mensagens com o mesmo `created_at`, `LIMIT 12` devolve `m3..m14` em
ordem crescente; `LIMIT` aceita parâmetro ligado.

Índice `idx_messages_conversation ON messages(conversation_id, id)` cobre a consulta.

---

## R-005 — Turno atômico: `append` recebe uma lista, dentro de transação

**Decisão**: `append(conversationId, messages: NewMessage[])` grava todas as mensagens
numa transação `BEGIN`/`COMMIT` com `ROLLBACK` em falha — mesmo padrão de
`seedDatabase`. O handler chama `append` **uma vez** por turno, com `[user, assistant]`
(FR-014).

**Rationale**: é o que dá a atomicidade do turno sem uma quarta operação de "transação".
Como `DatabaseSync` é síncrono e o Node é single-thread, nenhuma outra escrita — de outro
pedido ou do `SqliteOpsStore` na mesma conexão — intercala dentro do bloco. Isso também
resolve o edge case de pedidos concorrentes na mesma conversa: cada turno entra inteiro,
na ordem de conclusão.

✅ **Verificado**: falha de `CHECK` na segunda inserção dentro do bloco, seguida de
`ROLLBACK`, deixa a contagem igual à de antes.

---

## R-006 — Conversa nova só é criada depois do sucesso

**Decisão**: quando o pedido chega sem `conversationId`, o handler **não** chama
`create()` antes de executar. Roda a estratégia com histórico vazio; só no sucesso chama
`create()` e em seguida `append()`. A resposta devolve o id recém-criado.

**Rationale**: FR-015 — pedido que falha não deixa conversa registrada. Criar antes e
apagar em caso de falha exigiria um `delete` fora do contrato e ainda deixaria a conversa
visível durante a execução.

**Limite aceito**: `create()` e `append()` são duas chamadas; uma falha técnica **entre**
elas (disco cheio, banco corrompido) deixaria uma conversa vazia. Isso não é o cenário de
FR-015 (falha da execução do agente) e é inofensivo: conversa vazia equivale a conversa
nova — histórico 0. Juntar as duas numa transação exigiria uma operação fora das três
pedidas; não compensa.

---

## R-007 — Histórico entregue como texto prefixado, por um decorador

**Decisão**: novo decorador `withConversationHistory(strategy, history)` em
`src/agents/conversation-history.ts`. Com `history.length === 0` a entrada passa
**intacta**; caso contrário, o decorador monta:

```text
Histórico recente desta conversa (da mais antiga para a mais recente):
[plantonista] <conteúdo>
[OpsPilot] <conteúdo>
...

Mensagem atual do plantonista:
<mensagem nova>
```

e chama `strategy.run(textoMontado, options)`. Função pura `formatHistoryInput(history,
input)` exportada separadamente para teste.

**Rationale**: `ReasoningStrategy.run(input: string, options)` é o único ponto comum a
todas as estratégias. Entregar mensagens estruturadas exigiria um campo novo em
`RunOptions` que **cada** estratégia teria de consumir — ReAct montando
`messages: [...history, user]`, plan-and-execute repassando ao planejador e ao executor —
o que viola FR-019 ("sem alterar a implementação de cada estratégia"). O prefixo textual
funciona igual em ReAct, plan-and-execute e qualquer estratégia futura, e o caso sem
histórico não muda nada do comportamento de hoje, o que protege arena, bench e os testes
existentes.

**Alternativas consideradas**:
- `RunOptions.history: Message[]` consumido por cada estratégia — resultado melhor para o
  ReAct (mensagens nativas), mas custa uma mudança por estratégia e um caminho que o
  plan-and-execute não tem como aproveitar sem reescrever o planejador.
- Montar o texto no handler HTTP — funcionaria, mas perde o valor de métrica no mesmo
  lugar e mistura formatação de prompt com transporte.

---

## R-008 — O decorador de histórico é a camada **mais externa**

**Decisão**: a composição no handler é
`withConversationHistory(resolveStrategy(selection, store), history)` — por fora de
`withReflection` e de `withIncidentConfirmation`.

**Rationale** (três achados no código atual):

1. ✅ `withReflection` **reconstrói** `metrics` do zero (`{ llmCalls, latencyMs }`) em
   todo retorno. Um `historyMessages` colocado por uma camada interna seria descartado.
   Só a camada externa garante FR-022.
2. Por fora, a reflexão recebe como "entrada original" o texto já com histórico: o
   crítico julga "e o runbook dele?" sabendo quem é "ele", e `enrichInput` embute esse
   texto **uma vez** em cada regeneração (FR-020). Por dentro, a pergunta chegaria ao
   crítico sem contexto e ele reprovaria respostas corretas.
3. O registro de estratégias (`src/agents/index.ts`) continua sem saber que conversas
   existem (FR-019) — o decorador é aplicado pelo consumidor, não registrado.

**Consequência documentada**: o comentário de `buildCritiqueContext` ("`input` é sempre o
pedido ORIGINAL") segue verdadeiro no sentido dele — é o pedido antes do feedback de
revisão —, mas agora pode incluir histórico. Atualizar o comentário.

---

## R-009 — `historyMessages` opcional em `RunMetrics`

**Decisão**: `RunMetrics` ganha `historyMessages?: number`. Só `withConversationHistory`
o preenche: `{ ...result.metrics, historyMessages: history.length }`, inclusive com 0.

**Rationale**: campo obrigatório forçaria ReAct, plan-and-execute, reflexão e todos os
dublês de teste a escrever `historyMessages: 0`, só para a API usá-lo. Opcional mantém
arena, bench e MCP inalterados (FR-023: "se reportarem, 0" — eles simplesmente não
reportam). Na API, todo pedido passa pelo decorador, então a resposta **sempre** traz o
campo (SC-002). `formatMetrics` não muda.

**Alternativa considerada**: o handler acrescentar o campo à resposta — deixaria a métrica
fora do `StrategyResult`, e um futuro consumidor do decorador (CLI de chat, por exemplo)
teria de recalcular.

---

## R-010 — Teto de 12 como constante nomeada

**Decisão**: `export const HISTORY_WINDOW = 12` em `src/agents/conversation-history.ts`,
passado pelo handler como `limit` de `lastMessages` (FR-018). Não configurável por env var.

**Rationale**: a spec fixa 12; nada pede ajuste por ambiente, e cada variável nova é uma
entrada a validar com zod. O store recebe o limite por parâmetro, então os testes do store
exercitam limites arbitrários sem depender da constante.

---

## R-011 — Validação de `conversationId` e ordem das checagens

**Decisão**: `chatRequestSchema` ganha
`conversationId: z.string().trim().min(1, "conversationId não pode ser vazio.").optional()`.
Sem regex de UUID — o identificador é opaco. Ordem no handler: corpo (400) → estratégia
(422) → conversa (404) → execução (504/500) → gravação do turno → 200.

**Rationale**: é a ordem da spec (edge case). Exigir formato UUID transformaria "id que
não existe" em "corpo inválido" dependendo de como foi digitado — duas respostas para o
mesmo erro de quem integra. Com string não vazia, forma é 400 e existência é 404, sempre.

`ChatErrorCode` ganha `"conversation_not_found"`, com `details: { conversationId }`.

---

## R-012 — Gravação do turno só com a execução vencendo a corrida

**Decisão**: o turno é gravado no ramo `outcome.kind === "result"` do `Promise.race`
existente, imediatamente antes de `res.status(200).json(...)`.

**Rationale**: `Promise.race` resolve uma única vez — se o timer venceu, o ramo de
resultado nunca executa, mesmo que a estratégia termine depois; logo nada é gravado
(FR-015) sem precisar de flag extra. Se o cliente desistiu mas a execução venceu o prazo,
`res.headersSent` continua falso (nenhum cabeçalho foi enviado), o ramo de resultado roda
e o turno é gravado (edge case da spec).

A mensagem gravada como `user` é `parsed.data.message` (FR-020), nunca o texto montado
pelo decorador. A gravada como `assistant` é `result.answer`, inclusive quando
`stoppedReason` é `max-iterations`/`max-reflections` (edge case: é sucesso).

Falha técnica ao gravar (exceção do store) segue o caminho `next(error)` → 500, como
qualquer falha inesperada.

---

## R-013 — Relógio e ids na borda

**Decisão**: `SqliteConversationStore` gera o id (`conv-${randomUUID()}`) e lê o relógio
(`new Date().toISOString()`) nos métodos `create`/`append`, exatamente como
`SqliteOpsStore.openIncident`. O fake faz o mesmo, com contador determinístico
(`conv-1`, `conv-2`, …) para asserções estáveis.

**Rationale**: Princípio I — relógio e ids ficam nas bordas; o store é borda. O
decorador de histórico e `formatHistoryInput` são puros.

---

## R-014 — DDL de conversa separado do DDL operacional

**Decisão**: constante `CONVERSATION_SCHEMA_SQL` em `src/store/sqlite-schema.ts`,
aplicada no construtor de `SqliteConversationStore`. `SCHEMA_SQL` e `seedDatabase` não
mudam.

**Rationale**: cada store aplica o DDL de que depende, então qualquer um pode ser aberto
sozinho sobre `":memory:"` nos testes (FR-008). Mesmo arquivo de schema porque é o lugar
onde quem procura "qual é a estrutura do banco" já olha. O teste de sincronia
CHECK ↔ enum (004, R-007) ganha o caso `messages.role` ↔ `messageRoleSchema`.

`src/index.ts` passa a instanciar os dois stores sobre a **mesma** conexão; a arena, o
bench e o MCP não instanciam `SqliteConversationStore`.

---

## R-015 — Onde vive o fake

**Decisão**: `InMemoryConversationStore` em `src/store/in-memory-conversation-store.ts`,
usado como default de `createApp` quando `conversationStore` não é injetado — igual ao
`InMemoryOpsRepository` default que já existe.

**Rationale**: a constituição mantém a implementação in-memory como dublê suportado. Ser o
default de `createApp` deixa todos os testes atuais de `server.test.ts` funcionando sem
mudança, e o fake precisa lançar os mesmos erros de domínio do SQLite. Um teste de
contrato compartilhado roda a mesma bateria contra as duas implementações, o que impede
que o fake divirja do real.
