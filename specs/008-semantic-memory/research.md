# Research: Memória Semântica

**Feature**: `008-semantic-memory` | **Fase**: 0 | **Data**: 2026-09-21

Decisões técnicas tomadas antes do desenho. ✅ = executado contra o runtime real (Node
22.22.2, `@huggingface/transformers@4.3.0` instalado num diretório de rascunho, fora do
repositório), não presumido da documentação.

---

## R-001 — `@huggingface/transformers` como gerador de vetores local

**Decisão**: adicionar `@huggingface/transformers@^4.3.0` como dependência de runtime,
usando `pipeline("feature-extraction", MODEL_ID, { dtype: "q8" })` e chamando o extrator
com `{ pooling: "mean", normalize: true }`.

✅ **Verificado**: devolve um `Tensor` com `dims [n, 384]` e `data: Float32Array`; a norma
de cada linha é 1,0000, então produto escalar = cosseno (FR-007). Embedding de 6 textos
depois do modelo carregado: 64 ms.

**Custo, medido**:

| Item | Valor |
|---|---|
| `node_modules` adicionado | **744 MB** — `onnxruntime-node` 548 MB (binários para darwin, linux e win32), `onnxruntime-web` 141 MB, `sharp`/`@img` 28 MB |
| Modelo baixado no 1º uso | 113 MB (q8), uma vez, em `data/models/` (R-006) |
| Carga do modelo | ~8,5 s no primeiro download; ~0,26 s a partir do cache |

**Justificativa exigida pela Governança** — alternativas mais simples, descartadas:

- **Similaridade lexical (TF-IDF, BM25, n-gramas)**, zero dependência — reprova o requisito
  central: "recuperar fato sem palavra em comum" (FR-034, SC-001) é por definição o que
  busca lexical não faz.
- **API de embeddings remota** — exige rede e credencial em toda operação; viola FR-006 e o
  espírito do Princípio II (rodar offline, sem infraestrutura). O OpenRouter usado pelo
  projeto não é fonte de embeddings.
- **`onnxruntime-node` direto + tokenizador próprio** — corta ~200 MB, mas reimplementa
  tokenização WordPiece/SentencePiece, pooling e normalização: código novo, frágil e sem
  teste de referência, para economizar disco.

O custo em disco é real e fica registrado no README. É o preço de rodar o modelo localmente;
não há alternativa com o mesmo resultado e menos dependências.

---

## R-002 — Modelo multilíngue, não `all-MiniLM-L6-v2`

**Decisão**: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, quantizado (`q8`). Decidido com
o usuário depois da medição abaixo.

✅ **Medição** (produto escalar, vetores normalizados, mesmos pares nos três casos):

| Par | tipo | L6-v2 fp32 | L6-v2 q8 | **multilíngue q8** |
|---|---|---|---|---|
| "Sou responsável pelo serviço de checkout" · "quais sistemas estão sob minha guarda?" | relacionado | 0,343 | 0,364 | **0,387** |
| "Sou responsável pelo serviço de checkout" · "qual a previsão do tempo amanhã?" | sem relação | 0,311 | 0,304 | **0,026** |
| "Prefiro respostas curtas e diretas" · "me responde de forma resumida" | relacionado | 0,658 | 0,647 | **0,533** |
| "Prefiro respostas curtas e diretas" · "quantos alertas críticos existem?" | sem relação | 0,389 | 0,397 | **0,316** |
| "Meu time de plantão é o de pagamentos" · "quem cobre cobranças e faturamento?" | relacionado | 0,366 | 0,375 | **0,635** |
| "Meu time de plantão é o de pagamentos" · "como reinicio o banco de dados?" | sem relação | 0,337 | 0,348 | **0,026** |
| "Sou responsável pelo checkout" · "Eu cuido do serviço de checkout" | paráfrase | 0,694 | 0,703 | **0,928** |
| "O checkout caiu por causa do Redis" · "… Redis ontem" | quase idêntico | 0,977 | 0,964 | **0,939** |

**Rationale**: com o modelo pedido, **todos** os pares sem relação em português passam do
corte de 0,3 — FR-014 não filtraria nada e o agente receberia 3 fatos em quase todo pedido.
E a paráfrase fica em 0,70, longe dos 0,92: a US1 cenário 6 ("dito com outras palavras, não
duplica") falharia. O multilíngue separa bem os dois grupos e deduplica a paráfrase. Mesma
biblioteca, mesmo pooling, mesma dimensão (384) — só o identificador muda.

**Limite conhecido**: "respostas curtas" × "quantos alertas críticos" = 0,316, logo acima do
corte. O limiar de 0,3 não é perfeito, só muito melhor. Fica registrado; ajustar o valor
exigiria mudar a spec, e 0,3 foi pedido.

**Alternativas**: `all-MiniLM-L6-v2` (pedido — descartado pela medição); modelo configurável
por env var (descartado pelo usuário: trocar de modelo invalida todos os vetores gravados).

---

## R-003 — Singleton preguiçoso que guarda a Promise e esquece falhas

**Decisão** (`src/memory/embeddings.ts`):

```ts
let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= loadExtractor().catch((error) => {
    extractorPromise = undefined;   // próxima chamada tenta de novo
    throw error;
  });
  return extractorPromise;
}
```

**Rationale**: guardar a **Promise**, não o resultado, faz N chamadas concorrentes durante a
carga esperarem a mesma carga (FR-008) em vez de dispararem N downloads. Limpar em caso de
falha evita que um processo que subiu sem rede fique sem memória até ser reiniciado — a
próxima tentativa recarrega (FR-025 é fail-open *por pedido*, não para sempre).

A biblioteca é importada com `await import(...)` dentro de `loadExtractor`, nunca no topo do
módulo: `npm test` carrega todos os arquivos de teste, e nenhum teste que usa o gerador falso
deve pagar o carregamento do módulo nativo do ONNX.

---

## R-004 — `Embedder` como interface; gerador falso por tabela

**Decisão**:

```ts
export interface Embedder {
  embed(text: string): Promise<Float32Array>;   // vetor normalizado, 384 posições
}
```

`createLocalEmbedder()` devolve a implementação real. Os testes usam
`createTableEmbedder(table)`: um mapa texto → vetor escrito no próprio teste, com vetores
unitários construídos para ter produtos escalares exatos (ex.: 0,95, 0,5, 0,29), e que lança
para texto desconhecido.

**Rationale**: controlar a proximidade exatamente é o que permite testar as bordas dos
limiares (0,92 estrito, 0,3 inclusivo, empate) de forma determinística (Princípio V). Um
falso por hash de palavras testaria o hash, não os limiares.

---

## R-005 — Checagem de modelo em cache: `allowRemoteModels = false`

**Decisão**: `loadExtractor({ allowRemote })`. Produção usa `allowRemote: true` (baixa no 1º
uso). O teste semântico chama `createLocalEmbedder({ allowRemote: false })` e, se a carga
lançar, faz `t.skip("modelo não está em cache — rode npm run memory:model")`.

✅ **Verificado**: com o modelo no cache e `allowRemoteModels = false`, carrega em 259 ms;
com cache vazio, falha em **1 ms** com mensagem `…file was not found locally…`, sem tocar a
rede. É a biblioteca quem decide o que é "estar em cache" — sem reimplementar a estrutura de
pastas dela no teste.

Script novo `npm run memory:model`: carrega o extrator com rede liberada e sai, só para
preencher o cache antes de rodar os testes ou subir o servidor offline.

---

## R-006 — Cache do modelo em `data/models/`, não em `node_modules`

**Decisão**: `env.cacheDir` fixado em `<raiz do projeto>/data/models/`, resolvido a partir de
`import.meta.url` (não do `cwd`).

✅ **Verificado**: o padrão da biblioteca é `node_modules/@huggingface/transformers/.cache/` —
apagado por qualquer `npm ci` ou `rm -rf node_modules`, o que forçaria um novo download de
113 MB. `data/` já está no `.gitignore` e já é o lugar dos artefatos locais do projeto.

**Alternativa descartada**: env var `OPSPILOT_MODEL_CACHE` — nada pede configurar isso; é mais
uma entrada a validar.

---

## R-007 — BLOB de 1536 bytes, com `CHECK` de tamanho

**Decisão**: gravar `new Uint8Array(v.buffer, v.byteOffset, v.byteLength)`; ler com
`new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))`.
DDL: `embedding BLOB NOT NULL CHECK (length(embedding) = 1536)`.

✅ **Verificado**: `node:sqlite` devolve `Uint8Array` de 1536 bytes; a ida e volta é idêntica
posição a posição. O `slice` copia para um buffer próprio, porque `Float32Array` exige
`byteOffset` múltiplo de 4 e nada garante isso para um BLOB lido.

**Rationale do `CHECK`**: é o único campo de "conjunto fechado" da tabela (a dimensão). Um
vetor de outro modelo gravado por engano quebraria todas as comparações em silêncio — o banco
rejeita na escrita (Princípio II, defesa em profundidade). A leitura também valida o tamanho.

---

## R-008 — Recuperação por varredura em JS

**Decisão**: `SELECT id, fact, embedding, created_at, rowid FROM memories WHERE user_id = ?`,
produto escalar em JS, filtro `>= 0.3`, ordenação por proximidade decrescente e desempate por
`rowid` decrescente (mais recente primeiro — FR-016), corte em 3.

**Rationale**: SQLite não tem busca vetorial nativa; extensões (`sqlite-vec`) seriam outra
dependência nativa para uma escala de dezenas de fatos por usuário. 384 multiplicações por
fato é desprezível perto de uma chamada de modelo. O desempate usa `rowid` (existe em toda
tabela sem `WITHOUT ROWID`), porque `created_at` empata dentro do mesmo milissegundo — mesmo
raciocínio de 007, R-004.

---

## R-009 — Dedup atômico: gera o vetor antes, compara e grava sem `await` no meio

**Decisão**: `remember` faz `const v = await embedder.embed(fact)` e **depois**, sem nenhum
`await`, lê os vetores do usuário, calcula a maior proximidade e insere ou devolve o
existente.

**Rationale**: `node:sqlite` é síncrono e o Node é single-thread; um trecho sem `await` não é
intercalado por nenhum outro pedido. Duas chamadas concorrentes com o mesmo fato: a primeira
grava, a segunda — ao chegar no trecho síncrono — já enxerga a primeira e deduplica. Sem
transação explícita, sem lock.

---

## R-010 — `MemoryStore`: `remember`/`recall` assíncronos, `forget` síncrono

```ts
export interface MemoryStore {
  remember(userId: string, fact: string): Promise<RememberResult>;
  recall(userId: string, query: string): Promise<RecalledMemory[]>;
  forget(userId: string, memoryId: string): boolean;
}
```

**Rationale**: só quem precisa do gerador de vetores é assíncrono. `forget` é um `DELETE …
WHERE id = ? AND user_id = ?` e devolve `changes === 1` — a própria cláusula `user_id`
implementa FR-003/FR-018 (de outro usuário ⇒ 0 linhas ⇒ `false`, sem vazar se o id existe).
Diferente de `ConversationStore` (síncrono) por necessidade, não por estilo.

Uma única implementação, `SqliteMemoryStore(db, embedder)`, em `src/memory/memory-store.ts`.
Sem fake de store: os testes usam `":memory:"` + gerador falso, que já é determinístico e
rápido.

---

## R-011 — Ferramentas por pedido via `RunOptions.extraTools`

**Achado** ✅: as ferramentas são construídas **dentro** de cada estratégia
(`createOpsTools(store)` em `react.ts:36` e `plan-and-execute.ts:64`). Não há como uma
camada externa acrescentar ferramentas sem um canal.

**Decisão**: `RunOptions` ganha `extraTools?: ClientTool[]` (`@langchain/core/tools` — ✅ é exatamente o tipo de elemento que `createReactAgent` aceita em `tools`), e as duas
estratégias passam a usar `[...createOpsTools(store), ...(options?.extraTools ?? [])]`.
É uma linha em cada uma.

**Rationale**: o canal é genérico ("ferramentas adicionais desta execução") — as estratégias
continuam sem saber que memória existe, e o registro (`agents/index.ts`) não muda (FR-022).
`withReflection` e `withIncidentConfirmation` já repassam `runOptions` íntegro, então a
regeneração da reflexão também recebe as ferramentas. Arena, bench e MCP não passam
`extraTools` ⇒ comportamento idêntico (FR-032).

**Alternativas descartadas**:
- Acrescentar um parâmetro a `ResolveStrategy` — é contrato público da camada HTTP (003) e
  obrigaria o registro a conhecer as ferramentas por pedido.
- Criar as ferramentas de memória dentro de `createOpsTools` — `createOpsTools` recebe só o
  `OpsRepository`, e o `userId` é por pedido.

---

## R-012 — Um decorador faz as duas coisas: fatos no texto, ferramentas nas opções

**Decisão**: `withMemory(strategy, { memories, tools })` em `src/memory/with-memory.ts`:

- prefixa os fatos à entrada com `formatMemoriesInput(memories, input)` (pura; lista vazia ⇒
  entrada intacta — FR-023);
- chama `strategy.run(texto, { ...options, extraTools: [...(options?.extraTools ?? []), ...tools] })`;
- acrescenta `metrics.recalledMemories = memories.length`.

Formato do texto:

```text
Fatos lembrados sobre este usuário (do mais relevante para o menos relevante):
- [mem-3f2a…] Sou responsável pelo serviço de checkout
- [mem-91bc…] Prefiro respostas curtas e diretas

<entrada original>
```

O id entre colchetes é o que permite ao agente chamar `forget_fact` (spec, edge case).

**Composição no handler** — as duas camadas por fora de tudo, porque ambas precisam que suas
métricas sobrevivam a `withReflection` (007, R-008):

```ts
withConversationHistory(withMemory(resolveStrategy(sel, store), mem), history)
```

Texto resultante: fatos → histórico → mensagem atual. A ordem entre os dois decoradores não
afeta métricas (cada um espalha `result.metrics`).

---

## R-013 — Recuperação dentro do prazo, fail-open, só na mensagem

**Decisão**: com `userId`, o handler faz `memoryStore.recall(userId, message)` **dentro** da
Promise que disputa com o timeout, antes de `strategy.run`. Se `recall` lançar:
`console.error(...)`, `memories = []`, segue a execução. Sem `userId`: nenhuma chamada,
nenhum decorador de memória.

**Rationale**:
- **Dentro do prazo**: a primeira carga do modelo pode levar segundos; os 180 s valem para o
  processamento inteiro, não só para a estratégia.
- **Consulta é a mensagem crua**, não o texto com histórico: "e o runbook dele?" enriquecido
  com 12 mensagens teria o sentido diluído.
- **Fail-open** conciliado com a constituição ("falhas técnicas propagam e encerram a
  execução"): a regra fala de falhas **dentro** da execução da estratégia, onde uma ferramenta
  quebrada deixaria o agente agindo às cegas. A recuperação acontece **antes** da execução e
  só acrescenta contexto; perdê-la degrada a resposta, não a corrompe. Mesmo precedente do
  crítico da 002 (FR-017, fail-open). `remember_fact`/`forget_fact`, que rodam dentro da
  execução, seguem a regra geral: falha técnica propaga ⇒ 500.

---

## R-014 — Ferramentas de memória fora de `tool-definitions.ts`

**Decisão**: `defineMemoryTools(memoryStore, userId)` em `src/memory/memory-tools.ts`,
devolvendo definições no mesmo formato `OpsToolDefinition` (nome, descrição, esquema,
`run → ToolOutcome`), mais o adaptador LangChain `createMemoryTools(...)` no mesmo arquivo.

**Rationale**: FR-031 garantido por estrutura, não por disciplina — `MCP_TOOL_NAMES` é tipado
como `OpsToolName[]`, derivado de `defineOpsTools`; uma ferramenta que não está lá não pode ser
nomeada no MCP sem erro de compilação. E `defineOpsTools(store)` não tem como receber o
`userId` do pedido. Descrições completas pelas 6 regras em
[contracts/memory-tools.md](./contracts/memory-tools.md).

---

## R-015 — Tipos de domínio e validação de `userId`

- `src/domain/schemas.ts`: `memoryFactSchema = z.string().trim().min(1).max(500)`,
  `userIdSchema = z.string().trim().min(1)`, `rememberResultSchema`,
  `recalledMemorySchema` (Princípio I — uma definição, tipos inferidos).
- `chatRequestSchema.userId = userIdSchema.optional()` ⇒ vazio/espaços é 400 (FR-020).
- Id da memória: `mem-${randomUUID()}` gerado no store (borda), como `inc-` e `conv-`.
- Sem erro de domínio novo: "não encontrado" em `forget` é `false`, não exceção (FR-018), e
  "já existia" em `remember` é um campo do resultado.

---

## R-016 — `recalledMemories` opcional em `RunMetrics`

Mesma decisão e mesmo motivo de `historyMessages` (007, R-009): opcional, preenchido só por
`withMemory`. Pedido sem `userId` não passa pelo decorador ⇒ o campo **não aparece** — é o
que torna a resposta idêntica à de antes (FR-024, SC-006).
