# Data Model: Servidor MCP do OpsPilot

**Feature**: `006-mcp-server` | **Fase**: 1 | **Data**: 2026-09-21

Esta feature **não altera o domínio nem a persistência**. `src/domain/schemas.ts`,
`src/store/*` e o DDL SQLite ficam intocados. As entidades `Alert`, `Incident`, `Service` e
`Runbook` são lidas e escritas pelo mesmo `OpsRepository` de sempre (contrato em
[`004-sqlite-persistence/contracts/ops-store.md`](../004-sqlite-persistence/contracts/ops-store.md)).

O que a feature introduz são dois tipos de **borda**, sem persistência.

---

## OpsToolDefinition

A definição neutra de uma ferramenta: a fonte única consumida pelos dois adaptadores
(research R-002). Vive em `src/agents/tool-definitions.ts`.

| Campo | Tipo | Regra |
|---|---|---|
| `name` | `string` literal | Identificador estável da ferramenta (`list_alerts`, ...). Único no conjunto. |
| `description` | `string` | Satisfaz as 6 regras (Princípio IV). Só existe aqui, sem cópia em nenhum adaptador. |
| `schema` | `z.ZodObject` | Esquema de entrada; todo campo com `.describe()`, conjuntos fechados como `z.enum`. Tipos de argumento derivados por `z.infer`, sem tipo paralelo escrito à mão. |
| `run` | `(args: z.infer<schema>) => Promise<ToolOutcome>` | Executa contra o `OpsRepository` recebido na construção. Converte `DomainError` em `ToolOutcome` de erro; falha técnica **propaga** (Constituição, "Erros de domínio"). |

Construídas por `defineOpsTools(store, deps)`, que devolve as 6 definições indexadas pelo
nome. `deps.fetchImpl` continua existindo só para `check_provider_status`.

## ToolOutcome

| Campo | Tipo | Regra |
|---|---|---|
| `text` | `string` | Exatamente o texto que a ferramenta interna devolve hoje: JSON serializado para as ferramentas de store, uma linha para `check_provider_status`. |
| `isError` | `boolean` | `true` somente para erro de domínio (`DomainError`). Nunca `true` para lista vazia. `check_provider_status`, que não é exposta no MCP, devolve sempre `false`: para ela a falha já é observação em texto (005, FR-016), e o sinal não tem consumidor. |

**Invariante**: para qualquer estado e argumentos, `createOpsTools(...).invoke(args)` devolve
`outcome.text`, e o adaptador MCP devolve `content[0].text === outcome.text`. O texto é o
mesmo nos dois canais (FR-016); só o sinal de erro é exclusivo do MCP.

## Mapeamento definição → MCP

| OpsToolDefinition | Anúncio MCP (`tools/list`) | Resultado MCP (`tools/call`) |
|---|---|---|
| `name` | `name` | — |
| `description` | `description` | — |
| `schema` | `inputSchema` (JSON Schema draft-07 gerado pelo SDK, R-001) | — |
| `run` → `ToolOutcome` | — | `{ content: [{ type: "text", text }], isError }` |

## Conjunto exposto

`MCP_TOOL_NAMES = list_alerts | list_incidents | open_incident | resolve_incident`
(research R-003). `consultar_runbook` e `check_provider_status` existem nas definições e
**não** são registradas no servidor MCP.
