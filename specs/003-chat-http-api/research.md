# Phase 0 — Research: API HTTP de Chat

**Feature**: `003-chat-http-api` | **Date**: 2026-09-18

Decisões técnicas que sustentam o plano. Cada uma foi verificada contra o código já
existente (`src/agents`, `src/store`, `src/trace`, `src/arena.ts`, `src/bench.ts`) e contra
as versões realmente instaladas em `node_modules`, não apenas contra documentação.

---

## R-001 — `createApp()` separado de `listen()`

**Decision**: `src/http/server.ts` exporta `createApp(deps): express.Application` — monta
rotas, middlewares e error handler, e **não** abre porta. Quem escuta é `src/index.ts`
(o entrypoint de `npm run dev`), que hoje está vazio (0 bytes).

**Rationale**: FR-026 exige exatamente essa separação, e ela é o que torna o teste de
integração (FR-023) possível sem porta fixa: o teste chama `createApp(...)` e faz
`app.listen(0)` numa porta efêmera atribuída pelo SO. Também é o que mantém a camada
Controller livre de decisão de ambiente — `PORT` é assunto do bootstrap.

**Alternatives considered**:
- *`server.ts` que escuta no import*: importar o módulo no teste subiria um servidor real
  na porta de produção como efeito colateral de `import`. Inviável.
- *Exportar um `startServer()` que devolve o `http.Server`*: junta as duas
  responsabilidades e ainda obriga o teste a lidar com shutdown do listener de produção.

---

## R-002 — O registry muda de `registry.ts` para `index.ts`, sem quebrar a arena

**Decision**: `src/agents/registry.ts` é **movido** para `src/agents/index.ts` (pedido
explícito do usuário) e ganha uma segunda porta de entrada. O módulo passa a exportar:

| Export | Consumidor | Papel |
|---|---|---|
| `baseStrategyNames()` | HTTP | nomes base válidos — fonte única da validação e da mensagem de 422 (FR-011) |
| `resolveStrategy({ name, reflect }, store)` | HTTP | resolve nome base + aplica `withReflection` quando `reflect` (FR-010) |
| `availableStrategyNames()` | arena | base + `reflect:*` derivados — **inalterado** |
| `createStrategy(name, store)` | arena | aceita `reflect:<nome>` — **inalterado** |
| `defaultStrategyNames()` | arena | só as cruas — **inalterado** |

`createStrategy` passa a ser implementado **em termos de** `resolveStrategy`, decompondo o
prefixo `reflect:` do nome. `src/arena.ts` só troca o caminho do import.
`registry.test.ts` vira `index.test.ts` com os mesmos casos, mais os novos.

**Rationale**: FR-009 pede um ponto único de resolução; FR-012 exige que arena e bench
mantenham comportamento observável. Manter as duas assinaturas sobre uma única
implementação satisfaz os dois: a arena continua selecionando `reflect:react` por nome
(como o usuário faz hoje na linha de comando), e a API expressa a mesma coisa por
`{ strategy: "react", reflect: true }`. `bench.ts` não consome o registry — importa as
fábricas diretamente, porque precisa de `disableReplanner`, que é opção de construção e
não de `run` — então não é tocado por esta feature.

**Nota de resolução sobre FR-011**: existem duas listas, e isso é deliberado.
`baseStrategyNames()` (2 nomes) é a **única** consultada pelo caminho HTTP — validação e
mensagem de erro saem dela, que é o que FR-011 exige. `availableStrategyNames()` (4 nomes)
existe só para a compatibilidade da arena e nunca aparece numa resposta HTTP. É o que
sustenta o edge case da spec: `strategy: "reflect:react"` no corpo é **nome desconhecido**
(422), porque a reflexão na API é o campo `reflect`.

**Alternatives considered**:
- *Deletar os nomes `reflect:*` e dar à arena uma flag `--reflect`*: mais limpo, mas muda o
  comportamento observável da arena — viola FR-012 e quebraria `registry.test.ts`.
- *Deixar `registry.ts` no lugar e fazer `index.ts` só reexportar*: contraria o pedido
  explícito ("Registry em `src/agents/index.ts`") e deixa dois arquivos para uma coisa só.

**Armadilha de import verificada**: com `moduleResolution: NodeNext` e
`allowImportingTsExtensions: true`, os imports deste projeto carregam extensão explícita
(`./agents/registry.ts`). Não existe resolução implícita de diretório — os consumidores
precisam escrever `./agents/index.ts` por extenso. `./agents` **não** resolve.

---

## R-003 — Validação em dois estágios: forma (400) antes de nome (422)

**Decision**: O schema zod valida **apenas a forma** do corpo. A existência do nome da
estratégia é verificada **depois**, contra `baseStrategyNames()`, num passo separado.

```ts
const chatRequestSchema = z.object({
  message:  z.string().trim().min(1),
  strategy: z.string().trim().min(1).optional(),
  reflect:  z.boolean().optional().default(false),
});
```

**Rationale**: É o que separa 400 de 422, que a spec (FR-014, FR-015) e o usuário pedem
como códigos distintos. Se o nome fosse um `z.enum(baseStrategyNames())` dentro do schema,
uma estratégia inexistente falharia na validação e viraria 400 — indistinguível de um corpo
malformado. `z.object` (e não `z.strictObject`) descarta campos desconhecidos em silêncio,
que é o edge case pedido na spec. `.trim().min(1)` faz `strategy: "  "` cair em 400 (erro
de forma) e não em 422 — também um edge case explícito da spec.

**Alternatives considered**:
- *`superRefine` com o lookup dentro do schema*: junta os dois erros num só canal e força
  peneirar `issue.code` para decidir o status. Mais frágil e menos legível.

---

## R-004 — Corpo de erro único para todos os casos

**Decision**: Toda resposta de erro tem a mesma forma (FR-016):

```ts
{ error: { code: ChatErrorCode, message: string, details?: unknown } }
```

com `code ∈ "invalid_body" | "unknown_strategy" | "timeout" | "internal"`. `details` é a
lista de issues do zod (`{ path, message, code }`) em `invalid_body`, e
`{ validStrategies: string[] }` em `unknown_strategy`. `timeout` e `internal` não levam
`details`.

**Rationale**: FR-016 pede consistência e FR-017 proíbe vazar detalhe interno. O `code`
legível por máquina é o que satisfaz SC-004 (distinguir as falhas sem ler log do servidor)
sem obrigar o cliente a parsear texto. A montagem do corpo é uma **função pura**
(`toErrorBody`), o que a torna testável isoladamente e atende à convenção de funções puras
do projeto.

**Nota sobre zod 4**: `error.issues` é a superfície estável (`{ code, path, message }`);
`path` é `(string | number | symbol)[]` e é serializado com `.join(".")`. Não usamos
`z.treeifyError`/`flattenError` porque a lista plana é mais direta de consumir por um
cliente HTTP.

---

## R-005 — JSON malformado também é `invalid_body`

**Decision**: O `express.json()` rejeita corpo não-JSON lançando um `SyntaxError` com
`status: 400` e a propriedade `body`. O error handler reconhece esse formato e responde com
o mesmo `code: "invalid_body"`, com `details` explicando que o corpo não é JSON válido.

**Rationale**: Edge case explícito da spec ("corpo ausente, vazio ou que não é JSON válido
→ tratado como corpo inválido, com o mesmo formato de erro"). Sem esse tratamento, o
handler de erro padrão do Express devolveria HTML de stack trace — violando FR-016 e
FR-017 de uma vez.

---

## R-006 — Timeout: cancelamento real **e** relógio independente

**Decision**: Duas coisas ao mesmo tempo, não uma:

1. **Cancelamento real** — `RunOptions` ganha um campo opcional `signal?: AbortSignal`,
   propagado para a config do LangGraph em `react.ts` e `plan-and-execute.ts`, e repassado
   por `withReflection` (que já encaminha `runOptions` íntegro) com uma checagem de
   `signal.aborted` entre tentativas.
2. **Relógio independente** — o handler corre `strategy.run(...)` contra um deadline; o que
   chegar primeiro decide a resposta.

**Rationale**: Só o `Promise.race` responderia 504 no tempo certo (FR-018, FR-019), mas a
execução continuaria rodando de forma órfã — e, com o estado compartilhado de FR-012a, uma
execução órfã **continua escrevendo no estado que os próximos pedidos vão ler**. Isso é
exatamente o que FR-020 proíbe. Só o `AbortSignal`, por outro lado, depende de cada
estratégia respeitar o sinal; o relógio independente garante que o cliente receba resposta
em 180s mesmo que alguma parte do caminho ignore o cancelamento.

**Verificado**: `RunnableConfig` de `@langchain/core` expõe `signal?: AbortSignal`
("the call will be aborted when the signal is aborted") — o cancelamento chega ao modelo, a
propagação não é teórica. `AbortSignal.timeout()` existe no Node 22.

**Aditivo por construção**: `signal` é opcional em `RunOptions`; arena e bench continuam
chamando `run()` sem ele, comportamento inalterado (FR-012).

**FR-021 (exatamente uma resposta)**: o handler guarda a resposta atrás de
`res.headersSent`, de modo que a execução que termina logo depois do deadline não tenta
escrever numa resposta já enviada. Rejeições órfãs do `run()` abortado são absorvidas com
um `.catch()` no lado perdedor da corrida, para não virarem `unhandledRejection` e derrubar
o processo — o que violaria FR-017 e SC-006.

**Alternatives considered**:
- *Middleware genérico de timeout na aplicação inteira*: trata qualquer rota igual e não
  tem como cancelar o trabalho específico da estratégia.
- *`server.setTimeout()`*: corta a conexão TCP sem corpo de resposta; o cliente não
  distingue timeout de queda (fere FR-019 e SC-004).

---

## R-007 — Injeção de dependências no `createApp`, e o fake vive no teste

**Decision**: `createApp` recebe um objeto de dependências com padrões de produção:

```ts
interface ChatAppDeps {
  store?: OpsRepository;                    // default: InMemoryOpsRepository(baselineState())
  resolveStrategy?: ResolveStrategy;        // default: o do registry
  timeoutMs?: number;                       // default: 180_000
}
```

A estratégia falsa e determinística (FR-023) é definida **no arquivo de teste**, não em
`src/`: um objeto `{ name, run }` que devolve um `StrategyResult` fixo, sem I/O.

**Rationale**: É o mesmo padrão de injeção que a 002 usou para o crítico (R-004 de lá) e
pelo mesmo motivo — o teste fica offline e determinístico por **construção**, não por mock
de módulo. `timeoutMs` injetável é o que satisfaz FR-025: o teste de 504 usa dezenas de
milissegundos e o `npm test` continua rápido (SC-007), sem que o padrão de produção deixe
de ser os 180s de FR-018. Manter o fake no teste evita que código de mentira seja
publicado no bundle da aplicação.

**Alternatives considered**:
- *Registrar uma estratégia `fake` no registry real*: vazaria para `baseStrategyNames()` e,
  portanto, para a mensagem de 422 em produção.
- *Variável de ambiente para encurtar o timeout em teste*: acopla o teste ao ambiente e
  torna a suíte sensível à ordem de execução.

---

## R-008 — Estado compartilhado já é seguro; não precisa de lock

**Decision**: Uma única instância de `InMemoryOpsRepository`, criada no bootstrap a partir
de `baselineState()` e compartilhada por todas as requisições (FR-012a). **Nenhum
mecanismo de exclusão mútua é adicionado** (FR-012b).

**Rationale**: Verificado no código, não presumido. `InMemoryOpsRepository.openIncident` e
`.resolveIncident` fazem `this.#state = pureTransition(this.#state, ...)` — leitura e
escrita no **mesmo tique síncrono**, sem nenhum `await` entre as duas. O laço de eventos do
Node não pode intercalar outra requisição no meio dessa sequência, então não existe
atualização perdida. O que intercala é o intervalo *entre* chamadas de ferramenta de
requisições diferentes — e isso é justamente o comportamento desejado por FR-012a: a
segunda requisição enxerga o efeito da primeira. Um lock aqui não protegeria nada e apenas
serializaria requisições concorrentes.

Consequência já registrada como edge case na spec: duas requisições que resolvem o mesmo
incidente fazem a segunda receber `IncidentAlreadyResolvedError` — que `tools.ts` já
traduz em observação de erro no rastro, não em falha HTTP.

FR-012c sai de graça: o estado vive só em `#state`; `seed.json` nunca é reescrito, então
reiniciar o processo volta ao baseline.

---

## R-009 — Erros de domínio não chegam à borda HTTP

**Decision**: Nenhum mapeamento de `DomainError` para status HTTP. O handler de erro
genérico (500) cobre o caso impossível.

**Rationale**: A convenção do projeto ("erros de domínio são classes traduzidas na borda")
já está cumprida **antes** desta camada: `src/agents/tools.ts` captura `DomainError` em
cada ferramenta e a converte em observação de erro no rastro. Do ponto de vista do
`ReasoningStrategy`, um incidente inexistente não é exceção — é uma observação que o agente
lê e contorna. Adicionar um segundo ponto de tradução em `src/http` criaria duas verdades
sobre o mesmo erro.

---

## R-010 — Teste de integração com `fetch` nativo, sem dependência nova

**Decision**: O teste sobe `createApp(...).listen(0)`, lê a porta efêmera de
`server.address()`, e usa o `fetch` global do Node 22 contra `http://127.0.0.1:<porta>`.
`after()` fecha o listener. **Nenhuma dependência nova** — `supertest` não entra.

**Rationale**: Node 22 tem `fetch` estável e `node:test` já é o runner do projeto. Porta 0
atende FR-026 e elimina colisão de porta em execução paralela. Manter zero dependências
novas mantém a superfície da feature igual à da 002 (que também não acrescentou nada ao
`package.json`).

**Alternatives considered**:
- *`supertest`*: dependência de dev a mais para algo que `fetch` resolve; e ela esconde o
  ciclo real de listen/close, que é justamente o que FR-026 quer exercitar.
- *Chamar o handler com `req`/`res` falsos*: não é teste de integração — não passa pelo
  `express.json()`, que é onde nasce metade dos casos de 400 (R-005).

---

## R-011 — `PORT` é entrada externa e é validada com zod

**Decision**: `src/index.ts` valida `process.env.PORT` com
`z.coerce.number().int().min(1).max(65535).default(3000)` antes de chamar `listen`. O
script `dev` ganha `--env-file-if-exists=.env`, alinhando-se a `arena` e `bench`.

**Rationale**: "Toda entrada externa é validada com zod" não distingue corpo HTTP de
variável de ambiente. Sem isso, `PORT=abc` viraria `NaN` e o `listen` escolheria uma porta
aleatória em silêncio. O `--env-file-if-exists` é necessário porque o servidor precisa de
`OPENROUTER_API_KEY`/`OPENROUTER_MODEL` para executar estratégias reais — é a mesma forma já
usada pelos outros scripts, e nenhum código passa a ler `.env` diretamente.

---

## R-012 — Rastro e métricas são serializáveis como estão

**Decision**: `res.json(result)` direto, sem camada de serialização.

**Rationale**: Verificado em `src/trace/types.ts`: `TraceEvent` é uma união de objetos de
strings, `string[]`, `number` e `Record<string, unknown>` (os `args` de ferramenta, que
vêm do modelo já como JSON). `RunMetrics` são dois números e `stoppedReason` é uma string
literal. **Nenhum `Date`, `Map`, `Set` ou `undefined` no caminho** — as datas do domínio
ficam no store e só chegam ao rastro já formatadas dentro do texto das observações. Logo,
FR-004 (preservar conteúdo e ordem sem filtrar) é cumprido pela ausência de transformação,
que é a forma mais forte de cumpri-lo.

**Consequência de escopo**: o corpo de sucesso é `{ answer, trace, metrics, stoppedReason }`
— um **superconjunto** do `{ answer, trace, metrics }` que o usuário descreveu. O campo
extra vem de FR-006 da spec: sem ele, o cliente não distingue uma resposta completa de uma
que parou por limite de iterações ou de reflexões, e essa informação não existe em nenhum
outro lugar da resposta.

---

## R-013 — A constituição continua não ratificada

**Decision**: Avaliar o plano contra `.github/copilot-instructions.md`, como a 002 fez, e
manter aberta a recomendação de rodar `/speckit-constitution`.

**Rationale**: `.specify/memory/constitution.md` segue com o conteúdo de template
(`[PRINCIPLE_1_NAME]`, `[GOVERNANCE_RULES]`) — a recomendação dos planos da 001 e da 002
não foi executada. Não há portões constitucionais formais a avaliar, e inventar princípios
aqui seria pior do que declarar a lacuna.

**Divergência conhecida da stack declarada**: `copilot-instructions.md` diz "Express com
MySQL como banco (Sequelize + mysql2)". Esta feature traz o Express, mas **não** o MySQL — o
estado continua em memória por decisão explícita da spec (FR-012a, FR-012c). As dependências
`sequelize` e `mysql2` seguem instaladas e não usadas, como já estavam antes desta feature.
Persistência é escopo de uma feature futura; está registrado no Complexity Tracking do
plano para não virar dívida silenciosa.
