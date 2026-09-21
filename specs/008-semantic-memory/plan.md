# Implementation Plan: Memória Semântica

**Branch**: `008-semantic-memory` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-semantic-memory/spec.md`

## Summary

Dar ao OpsPilot memória de longo prazo por usuário. Um `MemoryStore` (`remember` / `recall` /
`forget`) sobre uma tabela `memories` no mesmo SQLite, com o vetor de cada fato em BLOB, gerado
localmente por `@huggingface/transformers` num singleton preguiçoso. O `/chat` ganha `userId`:
com ele, os até 3 fatos mais próximos da mensagem entram no texto entregue à estratégia e o
agente recebe as ferramentas `remember_fact` e `forget_fact`, presas àquele usuário. Sem ele,
nada muda.

Três achados da Fase 0 mudaram o desenho:

1. **O modelo pedido não entende português** (R-002, medido). Com `all-MiniLM-L6-v2`, todos os
   pares sem relação passaram do corte de 0,3 e uma paráfrase ficou em 0,70 contra o limiar de
   duplicata de 0,92 — os dois limiares da spec não fariam nada. Decidido com o usuário:
   `paraphrase-multilingual-MiniLM-L12-v2` (mesma biblioteca, mesmo pooling, mesma dimensão),
   que separa os grupos (sem relação 0,03–0,32; relacionados 0,39–0,64; paráfrase 0,93).
2. **As ferramentas nascem dentro de cada estratégia** (R-011). Para acrescentar ferramentas por
   pedido sem o registro conhecer memória, `RunOptions` ganha `extraTools` — uma linha em cada
   estratégia, canal genérico.
3. **O cache padrão da biblioteca fica em `node_modules`** (R-006) e sumiria a cada `npm ci`.
   Vai para `data/models/`, já ignorado pelo git.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM, `strict: true`. Node 22.22.2.

**Primary Dependencies**: **nova** — `@huggingface/transformers@^4.3.0` (justificativa abaixo e
em R-001). Existentes: `node:sqlite`, `zod@4`, `express@5`, `@langchain/*`.

**Storage**: SQLite `OPSPILOT_DB`, mesma conexão dos outros stores. Tabela `memories`
(`id`, `user_id`, `fact`, `embedding` BLOB `CHECK (length = 1536)`, `created_at`), DDL
idempotente no construtor do store. Modelo em `data/models/` (113 MB, baixado no 1º uso).

**Testing**: `node:test`. Store sobre `":memory:"` com gerador falso por tabela, que fixa
proximidades exatas para testar as bordas dos limiares (R-004). Teste com modelo real em
`allowRemote: false`, **pulado** quando o modelo não está em cache (R-005, verificado: falha em
1 ms sem tocar a rede). Endpoint com gerador falso injetado.

**Target Platform**: Linux/macOS/Windows (os binários do ONNX Runtime cobrem os três).

**Project Type**: Single project.

**Performance Goals**: sem meta formal. Medido: embedding ~10 ms por texto com modelo
carregado; carga ~0,26 s do cache, ~8,5 s no primeiro download. Recall por varredura de
dezenas de fatos por usuário: desprezível perto da chamada de modelo.

**Constraints**:
- `npm test` sem rede: nenhum teste pode disparar download (Princípio V).
- Registro de estratégias e `ResolveStrategy` não mudam (FR-022).
- Pedido sem `userId` byte a byte igual a antes, inclusive sem o campo `recalledMemories`
  (FR-024).
- `userId` nunca vem do modelo (FR-028).
- Zero SQL montado; `CHECK` de dimensão (Princípio II).

**Scale/Scope**: 5 módulos novos em `src/memory/` (`embeddings.ts`, `memory-store.ts`,
`memory-tools.ts`, `with-memory.ts`, `download-model.ts` para o script) + 4 arquivos de teste;
alterados: `schemas.ts`, `trace/types.ts`, `agents/types.ts`, `react.ts`,
`plan-and-execute.ts`, `http/chat.ts`, `http/server.ts`, `server.test.ts`, `index.ts`,
`package.json`, README, contrato da 003.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | `userIdSchema`, `memoryFactSchema`, `rememberResultSchema`, `recalledMemorySchema` em `src/domain/schemas.ts`, inferidos. `formatMemoriesInput` pura. Id (`mem-<uuid>`), relógio e o gerador de vetores ficam no store e no módulo de embeddings — bordas. | ✅ Passa |
| **II. Persistência Local em SQLite** | Mesmo arquivo; `":memory:"` nos testes; DDL literal e idempotente; `CHECK (length(embedding) = 1536)` como a restrição de "conjunto fechado" da tabela; statements preparados; seed intocado; `data/models/` já ignorado. O modelo é artefato local, não servidor de banco — o princípio não é afetado, mas o espírito "rodar offline" fica condicionado a um download inicial, registrado no README e com `npm run memory:model`. | ✅ Passa |
| **III. Contrato Antes de Código** | Spec, plano, pesquisa, modelo de dados, três contratos. A emenda ao `POST /chat` é registrada, e o aviso da 003 é atualizado. | ✅ Passa |
| **IV. Ferramentas pelas 6 Regras** | `remember_fact` e `forget_fact` auditadas item a item em [contracts/memory-tools.md](./contracts/memory-tools.md). Sem conjunto fechado nos esquemas. | ✅ Passa |
| **V. Portões Offline e Determinísticos** | Store e endpoint testados com gerador falso determinístico. O teste com modelo real nunca acessa rede (`allowRemote: false`) e é **pulado**, não aprovado, sem cache — decisão do usuário. Nenhum teste chama modelo de linguagem. | ✅ Passa |
| **Restrições Técnicas — erros** | "Falhas técnicas propagam e encerram a execução": `remember_fact`/`forget_fact` seguem. A **recuperação** falha de forma aberta porque acontece antes e fora da execução e só acrescenta contexto; precedente do crítico da 002 (R-013). | ✅ Passa, com justificativa registrada |

**Governança — nova dependência de runtime**: `@huggingface/transformers`. Justificada em R-001:
busca lexical não atende ao requisito central (recuperar sem palavra em comum); API remota viola
FR-006 e exige rede em cada operação; `onnxruntime-node` direto reimplementaria tokenização e
pooling. **Custo aceito e registrado**: +744 MB em `node_modules` e 113 MB de modelo no primeiro
uso.

**Resultado do portão**: nenhuma violação.

**Re-avaliação pós-Fase 1**: sem violações. Dois pontos de desenho reforçam:

- **Ferramentas de memória fora de `defineOpsTools`** (R-014): FR-031 (não expor no MCP) vira
  garantia do compilador, não disciplina.
- **`CHECK` de dimensão** (R-007): trocar de modelo por engano quebra na escrita, não em silêncio
  em cada recall.

## Project Structure

### Documentation (this feature)

```text
specs/008-semantic-memory/
├── plan.md
├── spec.md
├── research.md              # Fase 0 — 16 decisões, 4 com medição
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── memory-store.md      # Embedder (E1–E5), MemoryStore (M1–M14), DDL
│   ├── memory-tools.md      # remember_fact, forget_fact + auditoria das 6 regras
│   └── chat-endpoint.md     # emenda ao POST /chat
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks
```

### Source Code

```text
src/
├── domain/schemas.ts              # + userIdSchema, memoryFactSchema, rememberResultSchema, recalledMemorySchema
├── trace/types.ts                 # RunMetrics + recalledMemories?
├── agents/
│   ├── types.ts                   # RunOptions + extraTools?
│   ├── react.ts                   # tools: [...ops, ...extraTools]
│   └── plan-and-execute.ts        # idem
├── memory/                        # NOVO
│   ├── embeddings.ts              # Embedder, createLocalEmbedder, createEmbedderFromLoader, singleton
│   ├── embeddings.test.ts         # singleton/retry com carga falsa; modelo real (skip sem cache)
│   ├── memory-store.ts            # MemoryStore, SqliteMemoryStore, MEMORY_SCHEMA_SQL, limiares
│   ├── memory-store.test.ts       # M1–M14 com gerador falso
│   ├── memory-tools.ts            # defineMemoryTools, createMemoryTools
│   ├── memory-tools.test.ts
│   ├── with-memory.ts             # formatMemoriesInput, withMemory
│   ├── with-memory.test.ts
│   ├── table-embedder.ts          # gerador falso por tabela (usado só por testes)
│   └── download-model.ts          # entrada de `npm run memory:model`
├── http/
│   ├── chat.ts                    # userId, recall fail-open dentro do prazo, composição
│   ├── server.ts                  # ChatAppDeps.memoryStore
│   └── server.test.ts             # + casos FR-035
└── index.ts                       # SqliteMemoryStore(db, createLocalEmbedder())
```

**Structure Decision**: `src/memory/` como pedido. O store fica lá, e não em `src/store/`,
porque depende do gerador de vetores, que é específico da memória. `table-embedder.ts` fica em
`src/` (não num arquivo de teste) porque é usado por três arquivos de teste; não é importado
por código de produção.

### Ordem de implementação sugerida

1. Tipos, `RunOptions.extraTools`, `RunMetrics.recalledMemories`; linha das estratégias.
2. `embeddings.ts` + testes (singleton com carga falsa); `table-embedder.ts`.
3. `memory-store.ts` + testes M1–M14 (US1/US2 no nível do store).
4. `memory-tools.ts` e `with-memory.ts` + testes.
5. HTTP: `userId`, recall fail-open, composição, `ChatAppDeps` + testes (US1 → US3).
6. `index.ts`, `npm run memory:model`, README (incluindo o custo em disco), aviso na 003,
   teste com modelo real.

US1 entregável ao fim do passo 5; US2 (esquecer) já está coberta pelo store no passo 3 e pela
ferramenta no passo 4.

## Complexity Tracking

| Item | Por que é necessário | Alternativa mais simples descartada |
|---|---|---|
| Dependência `@huggingface/transformers` (+744 MB) | Único jeito de gerar vetores de sentido localmente sem reimplementar tokenização e pooling | Busca lexical (não acha sem palavra em comum); API remota (rede em toda operação) |
| `RunOptions.extraTools` | Ferramentas por pedido com `userId` fixado, sem o registro conhecer memória | Parâmetro novo em `ResolveStrategy` (quebra contrato público da 003) |
