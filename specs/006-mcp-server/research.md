# Research: Servidor MCP do OpsPilot

**Feature**: `006-mcp-server` | **Fase**: 0 | **Data**: 2026-09-21

As decisões marcadas **verificado** foram confirmadas executando código contra as versões
instaladas (Node 22.22.2, `zod@4.6.5`, `@langchain/core@1.2.11`) e `@modelcontextprotocol/sdk@1.30.0`
instalado num diretório de sonda fora do repositório. As sondas não foram trazidas para o
projeto.

---

## R-001 — `@modelcontextprotocol/sdk@1.30.0` é compatível com o zod do projeto (verificado)

**Decisão**: adicionar `@modelcontextprotocol/sdk@^1.30.0` como dependência de runtime e
registrar ferramentas com `McpServer.registerTool`, passando o `z.object` existente como
`inputSchema`.

**Verificação**:
- `peerDependencies.zod` é `^3.25 || ^4.0`; o projeto usa `4.6.5`. Não há segunda cópia do
  zod para o SDK.
- Para esquemas zod v4 o SDK converte com `toJSONSchema` do próprio zod (alvo draft-07,
  `io: "input"`). Um protótipo registrando os esquemas atuais anunciou `enum`, `default`,
  `minLength`, `required` e todas as descrições de campo. O JSON Schema anunciado é
  **deep-equal** a `z.toJSONSchema(schema, { target: "draft-7", io: "input" })` calculado
  com o zod do projeto, nas 4 ferramentas. Esse é o oráculo do teste da FR-025.
- `registerTool` substitui o `tool()` (obsoleto nesta versão) e valida os argumentos com o
  mesmo esquema antes de chamar o handler.

**Justificativa de nova dependência (Governança)**: a alternativa mais simples seria
implementar à mão o JSON-RPC 2.0 com o ciclo de vida do MCP (`initialize`, negociação de
capacidades, `tools/list`, `tools/call`, enquadramento por linha no stdio). Foi descartada:
seriam algumas centenas de linhas reimplementando um protocolo versionado, sem ganho
nenhum para o domínio, e desatualizadas a cada revisão da especificação. O SDK é a
implementação de referência e foi prescrito pelo pedido.

**Custo aceito**: o pacote declara dependências transitivas de transportes HTTP (`express`,
`hono`, `cors`...). O caminho stdio importa só `server/mcp.js` e `server/stdio.js`, que não
carregam essas dependências em runtime. O custo fica no `node_modules`, não no processo.

---

## R-002 — A fonte única é uma definição neutra, com dois adaptadores (verificado em protótipo)

**Decisão**: extrair de `src/agents/tools.ts` as definições das ferramentas para
`src/agents/tool-definitions.ts`: nome, descrição, esquema zod e uma função de execução que
devolve `ToolOutcome = { text: string; isError: boolean }`. Dois adaptadores consomem essas
definições:
- `createOpsTools` (LangChain), em `tools.ts`, devolve `outcome.text`. A saída fica
  byte a byte igual à de hoje, e a assinatura pública não muda.
- `createOpsMcpServer` (MCP), em `src/mcp/ops-mcp-server.ts`, devolve
  `{ content: [{ type: "text", text }], isError }`.

**Alternativa verificada e rejeitada**: registrar direto as ferramentas LangChain já
construídas (`tool.name`, `tool.description`, `tool.schema`, `tool.invoke`). O protótipo
funcionou para listagem e execução, mas **erro de domínio chega ao cliente sem `isError`**:
a ferramenta LangChain devolve `{"error": "..."}` como texto de sucesso, por desenho, porque
para o agente interno erro é observação. Recuperar o sinal exigiria fazer parse do texto
procurando uma chave `error`, o que é frágil e acoplaria o servidor MCP ao runtime do
LangChain. Com a definição neutra, o sinal de erro vira dado explícito, e cada canal decide
como apresentá-lo.

**Consequência**: `tools.ts` perde os literais de descrição (movidos, não copiados).
`src/agents/tools.test.ts` precisa passar **sem alteração**; é a prova de regressão da
extração. `react.ts` e `plan-and-execute.ts` continuam chamando `createOpsTools(store)`.

---

## R-003 — O conjunto exposto é uma lista explícita, não um filtro (decisão)

**Decisão**: o servidor declara `MCP_TOOL_NAMES = ["list_alerts", "list_incidents",
"open_incident", "resolve_incident"] as const` e seleciona essas definições pelo nome.
Nome ausente nas definições é erro de inicialização, não omissão silenciosa.

**Racional**: FR-005 exige que ferramentas novas **não** vazem para o MCP por acidente. Uma
lista de exclusão ("tudo menos runbook e provider") exporia automaticamente qualquer
sétima ferramenta. `check_provider_status` fica de fora também porque depende de rede e de
`fetchImpl`, que o servidor MCP não precisa conhecer. `list_incidents` entra por decisão de
clarificação (spec, FR-004).

---

## R-004 — Mapeamento de erros no MCP (verificado)

| Situação | Quem trata | O que o cliente recebe |
|---|---|---|
| Argumento inválido (enum, obrigatório ausente) | SDK, antes do handler | `isError: true`, texto `MCP error -32602: Input validation error: ...` com os valores aceitos |
| Ferramenta desconhecida ou não exposta | SDK | `isError: true`, texto `Tool <nome> not found` |
| Erro de domínio (`DomainError`) | definição (`ToolOutcome`) | `isError: true`, texto `{"error": "<mensagem>"}`, o mesmo que o agente interno vê |
| Falha técnica (exceção não-domínio) | adaptador MCP registra no stderr e relança; o SDK converte | `isError: true` com a mensagem; o processo continua |

**Verificação**: os três primeiros casos rodaram no protótipo. O SDK captura **toda**
exceção do handler e a converte em resultado com `isError: true`. Nenhum desses casos vira
erro JSON-RPC nem derruba a conexão. Isso satisfaz FR-013/14/15 sem código extra de
proteção; o adaptador só acrescenta a linha de diagnóstico no stderr (FR-014).

---

## R-005 — Disciplina do stdout: três camadas (decisão)

**Decisão**:
1. **Regra de código**: nenhum `console.log`, `console.info`, `console.debug` nem
   `process.stdout` em `src/mcp/`. Diagnóstico sai por um helper
   `diag(msg) => process.stderr.write(...)`.
2. **Guarda de runtime**: a primeira instrução de `main()` redireciona `console.log`,
   `console.info` e `console.debug` para o stderr. Protege contra um módulo importado
   (hoje ou no futuro) que imprima algo. Hoje nenhum módulo do grafo de importação do
   servidor imprime: auditei `src/store/`, `src/domain/`, `src/agents/tools.ts` e
   `provider-status.ts`. A guarda existe porque a regra é crítica e o sintoma é opaco.
3. **Testes**: um teste estático varre `src/mcp/*.ts` (exceto `*.test.ts`) procurando os
   padrões proibidos. Um teste dinâmico captura o stdout bruto de uma sessão completa e
   exige que toda linha seja JSON-RPC 2.0 válido (SC-004).

**Alternativa rejeitada**: confiar só na regra de código. Os imports ESM são avaliados antes
de `main()`, mas o risco relevante é chamada em runtime dentro de uma dependência, e é esse
risco que a guarda cobre. Não há ganho em ir além disso (por exemplo, substituir
`process.stdout.write`), porque o próprio transporte precisa dele.

---

## R-006 — `npm run` polui o stdout; o cliente precisa de `--silent` (verificado)

**Achado crítico**: `npm run <script>` escreve no **stdout** o cabeçalho
`> pacote@versão script` / `> comando` (4 linhas, verificado com `cat -A`). Um cliente MCP
configurado com `npm run mcp` recebe texto que não é protocolo antes do `initialize`, o que
viola a FR-017 **sem nenhum `console.log` no código**. Com `npm run --silent` o stdout fica
com 0 bytes.

**Decisão**:
- Script: `"mcp": "tsx --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/mcp/server.ts"`.
  Ele segue o `dev`: `.env` opcional para `OPSPILOT_DB` (FR-006) e silencia o aviso
  experimental do `node:sqlite`, que já iria para o stderr (higiene, não correção).
- **Toda configuração de cliente documentada usa `npm --prefix <repo> run --silent mcp`.**
  Verificado: com `--prefix`, o npm executa o script com `cwd` na raiz do pacote. Assim o
  default relativo `./data/opspilot.db` resolve para o mesmo arquivo da API HTTP, qualquer
  que seja o diretório de onde o cliente spawna. Alternativa equivalente:
  `node_modules/.bin/tsx` direto, mas aí as flags se duplicam fora do `package.json`.
- O teste de integração **não** passa pelo npm: spawna `node --import tsx src/mcp/server.ts`,
  que é o que o script executa, e evita depender do npm no PATH do teste.

---

## R-007 — Composição: fábrica testável + entrada fina (decisão)

**Decisão**: dois arquivos.
- `src/mcp/ops-mcp-server.ts`: `createOpsMcpServer(store: OpsRepository): McpServer`.
  Composição pura: nome `opspilot`, versão lida do `package.json`, registro das 4
  definições. Sem I/O, sem transporte, sem ambiente.
- `src/mcp/server.ts` (a entrada pedida): guarda de stdout, `openDatabase()`,
  `new SqliteOpsStore(db)`, `seedDatabase(db, baselineState())` (mesma sequência de
  `src/index.ts`, FR-010), `server.connect(new StdioServerTransport())`, diagnóstico de
  prontidão no stderr, e encerramento.

**Racional**: a fábrica permite testes in-process com `InMemoryTransport.createLinkedPair()`
do SDK sobre um `SqliteOpsStore(":memory:")` que o **teste** segura. Assim ele inspeciona o
estado resultante diretamente (Princípio V: estado, não texto). O teste que spawna o
processo real fica reservado ao que só ele prova: stdio, nome, lista, stdout limpo, falha
de configuração. Detectar "executado diretamente" num único arquivo (`import.meta.main`)
foi descartado por ser outra superfície de compatibilidade de versão do Node sem ganho.

---

## R-008 — Encerramento limpo (verificado em leitura do SDK)

**Achado**: `StdioServerTransport` escuta só `data` e `error` do stdin. Ele **não** reage a
`end`. Quando o cliente fecha o stdin, o processo termina porque o loop de eventos esvazia,
mas sem `db.close()` explícito.

**Decisão**: `server.ts` registra `process.stdin.once("end", shutdown)` e
`SIGINT`/`SIGTERM` para o mesmo `shutdown`, que é idempotente: `server.close()`,
`store.close()` e uma linha de diagnóstico. O `StdioClientTransport` do SDK, ao fechar,
encerra o stdin e depois envia SIGTERM. Os dois caminhos convergem.

---

## R-009 — Falha de configuração encerra com código ≠ 0 e stdout vazio (decisão)

**Decisão**: `main()` roda dentro de `try/catch`. Qualquer erro antes do `connect` (por
exemplo, `OPSPILOT_DB=""` → `openDatabase` lança `OPSPILOT_DB inválida: ...`) vira
`diag(mensagem)` e `process.exit(1)`. É o mesmo padrão de `resolvePort` em `src/index.ts`,
com o stderr no lugar do `console.error`, que teria o mesmo efeito. Usar o helper deixa o
arquivo sem nenhuma chamada a `console`, o que simplifica o teste estático.

---

## R-010 — Concorrência com a API HTTP no mesmo arquivo (risco registrado)

**Achado**: `openDatabase` não define `busy_timeout`. Com a API HTTP e o servidor MCP
escrevendo no mesmo arquivo no mesmo instante, a segunda escrita falha com `SQLITE_BUSY`
na hora, em vez de esperar.

**Decisão**: **não** alterar `db.ts` nesta feature. O volume é de uma pessoa de plantão, e
uma colisão vira falha técnica legível (R-004), não corrupção. `PRAGMA busy_timeout` é uma
linha, mas muda o comportamento da 004 para todos os consumidores, e merece decisão
própria. Fica registrado como follow-up no plano.

---

## R-011 — Cobertura de teste e tempo (verificado)

Subir o processo real, fazer `initialize` e `tools/list` levou **~460 ms** no protótipo.
Três testes de processo (lista, stdout bruto, falha de configuração) somam ~2 s. Os demais
rodam in-process em milissegundos. O glob do `npm test` (`src/**/*.test.ts` expandido pelo
`sh`) alcança `src/mcp/*.test.ts` sem mudança no script. O `StdioClientTransport` recebe
`env` explícito (`PATH` e `OPSPILOT_DB=":memory:"`). Sem isso, ele herdaria só as variáveis
"seguras" do SDK, e um `OPSPILOT_DB` do ambiente de quem roda os testes poderia vazar para
o processo filho.
