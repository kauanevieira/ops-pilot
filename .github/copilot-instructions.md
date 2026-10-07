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
- Memória é aprendida automaticamente: depois de cada resposta bem-sucedida com `userId`,
  um refletor (`src/memory/learning-reflector.ts`) examina só a mensagem crua, distila um
  fato com `withStructuredOutput` (`src/memory/distiller.ts`) e barra segredos com uma
  verificação determinística (`src/memory/secret-guard.ts`) antes de guardar. O agente não
  guarda mais fatos — só `forget_preference` (esquecer) continua como ferramenta.
- `POST /chat` roda cada pedido por um grafo de produção único
  (`src/agents/production-graph.ts`): `context -> router -> {react, plan-and-execute,
  reflect} -> response`. Sem `strategy`/`reflect` no pedido, um roteador
  (`src/agents/router.ts`) escolhe a estratégia com `withStructuredOutput`, guiado por
  uma tabela de custo/uso no prompt; com `strategy` ou `reflect: true`, a escolha é
  imposta e o roteador nem é consultado. Todo pedido traz um evento `route` no rastro, e
  todo evento do rastro traz o nó do grafo que o produziu (`nodeName`).
- Toda chamada ao modelo (estratégias, crítico, roteador, sumarizador, refletor de
  aprendizado) passa por `resilient()` (`src/agents/model.ts`): `withRetry` no principal
  (até 3 tentativas, só em falha passageira) e `withFallbacks` para um reserva opcional
  (`OPENROUTER_MODEL_FALLBACK`). Uma troca vale para o resto do mesmo pedido do `/chat`
  (`runWithResilienceScope`). Rastro ganha o evento `fallback`; métricas ganham
  `modelUsed`. Sem nenhum modelo disponível, o `/chat` responde 503 `model_unavailable`.

- Todo pedido do `POST /chat` ganha um `requestId` (middleware `src/http/request-tracking.ts`,
  antes do `express.json()`), devolvido em `X-Request-Id` e no corpo. Registro e rastro vão para
  as tabelas `requests`/`trace_events` (`src/obs/request-store.ts`) e `GET /requests/:id` os
  devolve. O logger (`src/obs/logger.ts`) escreve uma linha JSON por evento, **só metadados**:
  `LogFields` aceita apenas string/number/boolean/null e exceção vira `errorName`. Camadas
  internas logam com `logInRequest(...)`, que usa o logger do pedido (`AsyncLocalStorage`,
  aberto no handler) e cai no `console.error` de sempre fora do HTTP — arena, bench e MCP não
  mudam. Evento de log novo: acrescentar ao catálogo `LogEvent` e a `contracts/log-format.md`.
  Tipo de evento de rastro novo: atualizar `traceEventTypeSchema` e o `CHECK` de `trace_events`.

- `web/` é a war room (Vite + React + TypeScript, base `/opspilot/` por padrão; `OPSPILOT_WEB_BASE`
  no build muda o caminho, via `web/build/base.ts`), um pacote próprio com
  `package.json` e testes em Vitest (`npm --prefix web test`, `npm --prefix web run typecheck`),
  fora de `npm test`/`npm run typecheck` da raiz. Os formatos que a API devolve e a war room
  lê (rastro, métricas, corpo do `/chat`, erro, ação pendente) são esquemas zod em
  `src/domain/wire.ts`, e `src/trace/types.ts` os deriva por `z.infer`. `src/domain/` só pode
  importar `zod` e arquivos de `src/domain/` (a war room o importa no navegador; um teste
  guarda isso). Evento de rastro novo: atualizar `traceEventSchema` em `wire.ts`,
  `traceEventTypeSchema`, o `CHECK` de `trace_events` **e** o componente do tipo em
  `web/src/trace/events/` (o `switch` é exaustivo). CORS: `src/http/cors.ts`, origens em
  `OPSPILOT_CORS_ORIGINS` (padrão `http://localhost:5173`).
  Publicação: `.github/workflows/pages.yml` roda os portões da war room e publica `web/dist/` no
  GitHub Pages (`/ops-pilot/`) a cada push em `main` que toque `web/` ou `src/domain/`.

## Comandos

- `npm run dev` — sobe a API HTTP (`src/index.ts`, `POST /chat`)
- `npm run seed` — aplica a linha de base no banco SQLite (5 serviços, 6 alertas, 3 runbooks), idempotente
- `npm run arena` — compara estratégias de raciocínio sobre o mesmo pedido (`src/arena.ts`)
- `npm run bench` — executa `src/bench.ts`
- `npm run memory:model` — baixa o modelo de embeddings para `data/models/` (requer rede; rode antes de `npm test` para não pular o teste de recall semântico real)
- `npm test` — roda os testes (`node --import tsx --test`)
- `npm run typecheck` — checagem de tipos (`tsc --noEmit`)
- `npm --prefix web run dev` — war room em `http://localhost:5173/opspilot/` (a API deve estar no ar)
- `npm --prefix web run build` — gera `web/dist/` para servir sob `/opspilot/`
- `npm --prefix web test` / `npm --prefix web run typecheck` — portões da war room (offline, sem a API)

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
