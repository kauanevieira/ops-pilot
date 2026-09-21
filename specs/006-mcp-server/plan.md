# Implementation Plan: Servidor MCP do OpsPilot

**Branch**: `006-mcp-server` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-mcp-server/spec.md`

## Summary

Expor as ferramentas de alerta e de incidente do OpsPilot a qualquer cliente MCP. O
servidor `opspilot` fala stdio e publica `list_alerts`, `list_incidents`, `open_incident`
e `resolve_incident` sobre o mesmo banco SQLite da API HTTP.

A abordagem técnica, definida na Fase 0: **extrair as definições das ferramentas para um
módulo neutro e ter dois adaptadores finos** (R-002). `src/agents/tool-definitions.ts`
passa a ser o único lugar com nome, descrição, esquema zod e execução. `createOpsTools`
(LangChain) e `createOpsMcpServer` (MCP) só traduzem. O servidor fica em dois arquivos: uma
fábrica pura testável in-process e a entrada `src/mcp/server.ts`, que faz I/O, ambiente e
ciclo de vida (R-007).

Três achados da Fase 0 mudam a leitura ingênua do pedido:

1. **`npm run mcp` corrompe o stdout sem nenhum `console.log` no código** (R-006,
   verificado). O npm imprime o cabeçalho do script no stdout. O script em si pode seguir o
   pedido, mas **todo registro de cliente precisa de `npm --prefix <repo> run --silent mcp`**.
   O `--prefix` também garante `cwd` na raiz, de modo que o banco default é o mesmo da API.
2. **Reaproveitar as tools LangChain prontas funciona, mas perde o sinal de erro** (R-002,
   verificado em protótipo). Erro de domínio chegaria ao cliente MCP como sucesso contendo
   `{"error": ...}`. É por isso que a fonte única é a definição, não o objeto LangChain.
3. **O SDK converte toda exceção do handler em resultado `isError`** (R-004, verificado).
   Validação de argumento, ferramenta desconhecida e falha técnica já saem legíveis sem
   derrubar a sessão. O código próprio de erro se resume ao `ToolOutcome` de domínio e à
   linha de diagnóstico no stderr.

## Technical Context

**Language/Version**: TypeScript 7.0.2 em ESM, `strict`, NodeNext; Node 22.22.2 via `tsx`.

**Primary Dependencies**: **nova**: `@modelcontextprotocol/sdk@^1.30.0` (runtime,
justificada em R-001 e em Complexity Tracking). Existentes: `zod@4.6.5`, compatível com o
peer `^3.25 || ^4.0` do SDK (verificado), e `@langchain/core` (só no adaptador LangChain).

**Storage**: SQLite via `node:sqlite`, o mesmo arquivo de `OPSPILOT_DB` usado pela API HTTP.
Sem mudança de DDL, de store ou de seed.

**Testing**: `node:test` via `tsx`, arquivos `*.test.ts` ao lado do código.
- `src/mcp/ops-mcp-server.test.ts` (in-process, `InMemoryTransport.createLinkedPair()` +
  `Client` do SDK + `SqliteOpsStore(":memory:")`): igualdade de descrição e esquema com a
  definição (oráculo `z.toJSONSchema(schema, { target: "draft-7", io: "input" })`, R-001),
  execução com inspeção do estado no store, `isError` em erro de domínio, ferramenta não
  exposta recusada, texto idêntico ao do adaptador LangChain.
- `src/mcp/server.test.ts` (processo real via `StdioClientTransport`, `env` explícito com
  `OPSPILOT_DB=":memory:"`): nome `opspilot` + lista exata (o teste pedido); stdout bruto
  de uma sessão só com JSON-RPC; `OPSPILOT_DB=""` sai com 1, stderr com a causa, stdout
  vazio; varredura estática de `src/mcp/*.ts` sem `console.log|info|debug` nem
  `process.stdout`.
- `src/agents/tools.test.ts`: **inalterado**, prova de regressão da extração.

**Target Platform**: Linux/macOS/WSL, processo filho de um cliente MCP.

**Project Type**: single project. Um novo ponto de entrada (`src/mcp/`) ao lado de
`src/http/` e das CLIs.

**Performance Goals**: subir e listar em < 1 s (medido: ~460 ms). A suíte inteira continua
abaixo de 30 s (SC-009).

**Constraints**:
- stdout é do protocolo: nenhum `console.log/info/debug` nem `process.stdout` em
  `src/mcp/`, e guarda de runtime redirecionando esses três para o stderr (R-005).
- Nenhum literal de descrição ou esquema em `src/mcp/` (FR-008, verificado por teste de
  igualdade, não por grep).
- Lista explícita de ferramentas expostas, nunca lista de exclusão (R-003).
- `createOpsTools(store, deps)` mantém assinatura e saída. `react.ts`,
  `plan-and-execute.ts` e a cadeia de estratégias da 003 não mudam.
- Testes usam só `":memory:"` (Princípio II) e nenhuma rede (Princípio V).

**Scale/Scope**: 3 arquivos de código novos (`tool-definitions.ts`, `ops-mcp-server.ts`,
`server.ts`) e 2 de teste; 3 alterados (`tools.ts`, `package.json`, `README.md`); 1 dependência nova;
nenhuma migração.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | O servidor MCP é borda pura. A fábrica não faz I/O, e relógio, ids e persistência continuam no `SqliteOpsStore`. O único ponto de I/O novo (`server.ts`) é identificável e fino. Argumentos tipados por `z.infer` dos esquemas existentes, sem tipo paralelo. `src/domain/` intocado. | ✅ Passa |
| **II. Persistência Local em SQLite** | Reusa `openDatabase` + `SqliteOpsStore` + `seedDatabase` exatamente como `src/index.ts`: mesmo `OPSPILOT_DB`, mesmo DDL idempotente, mesmo seed idempotente. Testes só com `":memory:"`: o teste de estado usa in-process, e o de processo passa `":memory:"` ao filho. | ✅ Passa |
| **III. Contrato Antes de Código** | Spec, plano, pesquisa, modelo de dados, contrato e quickstart antes do código. O novo canal ganha contrato próprio ([`contracts/mcp-server.md`](./contracts/mcp-server.md)), que **referencia** o contrato de ferramentas da 004/005 em vez de duplicá-lo. README ganha seção MCP na mesma leva. | ✅ Passa |
| **IV. Ferramentas Descritas pelas 6 Regras** | Nenhuma descrição nova. As 4 expostas já são conformes e chegam ao cliente MCP idênticas, com enums e `.describe()` preservados no JSON Schema (verificado). As menções de fronteira a ferramentas não expostas (`consultar_runbook`, `check_provider_status`) ficam como estão: reescrever por canal criaria duas descrições (spec, Edge Cases). | ✅ Passa |
| **V. Portões Offline e Determinísticos** | Nenhum teste usa rede ou credencial. O teste de processo spawna um filho local com `env` fechado. Cada teste sobe seu próprio processo ou seu próprio store, sem ordem entre testes. Ferramentas verificadas pelo estado no store (in-process), não pelo texto. | ✅ Passa |

**Restrições Técnicas**: zod na borda (o SDK valida os argumentos com o esquema zod antes do
handler). Credenciais: `.env` carregado pelo runtime via `--env-file-if-exists`, nunca lido
pelo código. Erros de domínio viram observação (`isError` + texto), e falha técnica propaga
(o SDK a converte em resultado de erro, e o processo continua).

**Resultado do portão**: uma complexidade adicional, a dependência nova, justificada abaixo.
Nenhuma violação de princípio.

**Re-avaliação pós-Fase 1**: o desenho ficou mais aderente que o esboço inicial em dois
pontos.
- A fonte única deixou de ser "reusar os schemas" e passou a cobrir descrição e execução
  (R-002). Com isso, a FR-008 é verificável por igualdade em teste, não por disciplina.
- O achado do `npm run` (R-006) virou contrato explícito (`--silent` no exemplo de
  registro), em vez de ficar como pegadinha do README.

## Project Structure

### Documentation (this feature)

```text
specs/006-mcp-server/
├── plan.md              # Este arquivo
├── research.md          # Fase 0: R-001..R-011
├── data-model.md        # Fase 1: OpsToolDefinition, ToolOutcome, mapeamento MCP
├── quickstart.md        # Fase 1: roteiro de validação
├── contracts/
│   └── mcp-server.md    # Fase 1: contrato observável do servidor
├── checklists/
│   └── requirements.md  # /speckit-specify
└── tasks.md             # Fase 2 (/speckit-tasks — ainda não criado)
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── tool-definitions.ts      # NOVO: fonte única (nome, descrição, schema, run → ToolOutcome)
│   ├── tools.ts                 # ALTERADO: vira adaptador LangChain sobre as definições
│   └── tools.test.ts            # inalterado (regressão)
├── mcp/
│   ├── ops-mcp-server.ts        # NOVO: createOpsMcpServer(store) — composição pura
│   ├── ops-mcp-server.test.ts   # NOVO: in-process (InMemoryTransport)
│   ├── server.ts                # NOVO: entrada stdio — env, db, transporte, stderr, shutdown
│   └── server.test.ts           # NOVO: processo real + stdout bruto + falha de config + varredura
├── store/, domain/, http/       # inalterados
package.json                     # + dependência SDK, + script "mcp"
README.md                        # + seção "Servidor MCP" (registro com --silent)
```

**Structure Decision**: single project, novo diretório `src/mcp/` como terceiro ponto de
entrada, paralelo a `src/http/`. As definições ficam em `src/agents/` porque são do
catálogo de ferramentas, que já vive ali. Mover o catálogo para uma pasta neutra
(`src/tools/`) foi considerado e adiado: mudaria imports de toda a camada de agentes para
um ganho só nominal.

## Ordem de implementação (por história)

1. **US4 primeiro, como fundação** (P4 em valor, mas pré-requisito técnico): extrair
   `tool-definitions.ts` e reescrever `tools.ts` como adaptador. **Portão**: `tools.test.ts`
   e a suíte inteira verdes, sem tocar em teste nenhum.
2. **US1 (P1)**: dependência + `ops-mcp-server.ts` + `server.ts` + script `mcp` + o teste
   de processo que lista as ferramentas. É o MVP integrável.
3. **US2 (P2)**: testes in-process de execução, estado e `isError`.
4. **US3 (P3)**: guarda de runtime, teste de stdout bruto, falha de configuração, shutdown
   e varredura estática.
5. README e contrato conferidos contra o comportamento real (quickstart passos 1 a 3).

## Follow-ups (fora de escopo, registrados)

- `PRAGMA busy_timeout` em `openDatabase` para escrita concorrente API HTTP + MCP (R-010).
  Muda a 004 para todos os consumidores, então pede decisão própria.
- Expor `consultar_runbook` e `check_provider_status` via MCP, se houver demanda. Pela
  R-003, é mudança de uma linha mais o contrato.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Nova dependência de runtime `@modelcontextprotocol/sdk` | Implementar o protocolo MCP (JSON-RPC 2.0, `initialize`/negociação de capacidades, `tools/list`, `tools/call`, enquadramento stdio) de forma conforme e atualizada | Implementação manual: centenas de linhas reimplementando um protocolo versionado, sem valor de domínio e desatualizadas a cada revisão da especificação. O SDK é a referência oficial, foi prescrito pelo pedido e é compatível com o zod já instalado (R-001). |
| Módulo novo `tool-definitions.ts` (camada entre catálogo e LangChain) | Fonte única que carrega o sinal de erro de domínio como dado (`ToolOutcome.isError`) para dois canais | Reusar as tools LangChain prontas: verificado, perde `isError` no MCP ou exige parse do texto `{"error"}`, frágil e acoplado ao LangChain (R-002). |
