# OpsPilot

Copiloto de plantão que gerencia alertas e incidentes de produção. O núcleo é
um agente LangChain/LangGraph rodando sobre OpenRouter.

## Stack

- Node.js 22 LTS
- TypeScript ESM com `strict: true`
- `zod` na fronteira (HTTP/CLI) para validar entrada e saída
- Testes com `node:test` via `tsx`
- Express com SQLite como banco (`node:sqlite`, nativo — sem ORM, sem servidor externo)
- `@huggingface/transformers` para embeddings locais (memória semântica, `src/memory/`) —
  modelo `paraphrase-multilingual-MiniLM-L12-v2`, baixado uma vez para `data/models/`

## Comandos

- `npm run dev` — sobe a API HTTP (`src/index.ts`, `POST /chat`)
- `npm run seed` — aplica a linha de base no banco SQLite (5 serviços, 6 alertas, 3 runbooks), idempotente
- `npm run arena` — compara estratégias de raciocínio sobre o mesmo pedido (`src/arena.ts`)
- `npm run bench` — executa `src/bench.ts`
- `npm run memory:model` — baixa o modelo de embeddings para `data/models/` (requer rede; rode antes de `npm test` para não pular o teste de recall semântico real)
- `npm test` — roda os testes (`node --import tsx --test`)
- `npm run typecheck` — checagem de tipos (`tsc --noEmit`)

Requer **Node 22 LTS** (`engines.node` em `package.json`; ver `.nvmrc`) — versões
anteriores quebram o `tsc` e a expansão de glob do script `test`.

## Convenções

- Camadas padrão: MVC (Model, Service, Controller).
- Toda entrada externa é validada com zod.
- Erros de domínio são classes traduzidas na borda.
- Lógica nova nasce com teste.
- `npm run typecheck` e `npm test` sempre verdes.
- Nunca commitar secrets e nunca ler `.env`.
- Sempre utilize funções puras.

## Fluxo

Seguir o fluxo do Spec Kit (GitHub Copilot). Specs devem ser versionadas.
