# Implementation Plan: War Room Web

**Branch**: `016-war-room-web` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

## Summary

Uma SPA em `web/` (Vite + React + TS) servida sob `/opspilot/`. É uma tela de conversa que chama
`POST /chat` e reaproveita o `conversationId` entre turnos. Cada resposta tem um "ver
raciocínio", que abre uma gaveta com o rastro tipado. Uma resposta 202 vira um cartão Aprovar/Negar,
e uma engrenagem guarda a URL da API no navegador. Do lado da API entram um middleware CORS com
lista de origens (`OPSPILOT_CORS_ORIGINS`) e os esquemas zod das respostas (rastro, métricas,
corpo do `/chat`, erro, ação pendente), movidos para `src/domain/`. A war room importa esses
esquemas em vez de reescrevê-los (Princípio I). O fluxo de aprovação é implementado na war room
contra um contrato publicado aqui ([approval-flow.md](./contracts/approval-flow.md)). O servidor
desse fluxo é uma feature separada.

## Technical Context

**Language/Version**: TypeScript (mesma versão da raiz). API em Node 22. A war room roda em navegador evergreen.

**Primary Dependencies**:
- API: nenhuma dependência nova (CORS escrito à mão, R-001).
- `web/`: `react`, `react-dom` (runtime); `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`,
  `@testing-library/react`, `@testing-library/user-event`, `@types/react`, `@types/react-dom` (dev).
  `zod` vem da raiz, junto com os esquemas de `src/domain/` (R-003).

**Storage**: API sem mudança. A war room guarda só a URL da API, em `localStorage` (`opspilot.apiUrl`), dentro de try/catch.

**Testing**: API com `node:test`, como sempre. Em `web/`: `vitest` + `jsdom` + Testing Library, com
`fetch` injetado e nenhuma rede (Princípio V).

**Target Platform**: hospedagem estática sob `/opspilot/` + API Node em outra origem.

**Project Type**: web-service existente + frontend novo no mesmo repositório.

**Performance Goals**: a primeira resposta aparece assim que a API termina, sem custo próprio
perceptível. Um rastro de 200 eventos rola sem travar.

**Constraints**: o pedido pode levar 180 s (prazo do cliente: 190 s). Portões da war room offline.
Nenhum estado de conversa persistido no navegador.

**Scale/Scope**: uma tela, uma pessoa, uma conversa por vez. Cerca de 15 componentes.

## Decisões

1. **CORS sem a dependência `cors`** (R-001): uma função pura `corsDecision(origin, method,
   allowlist)` mais um middleware fino em `src/http/cors.ts`, registrado antes de todas as rotas. O
   preflight responde 204 e termina ali, sem passar pelo `requestTracking`, que só existe na rota
   `POST /chat` (FR-025).
2. **Origens por ambiente, lidas uma vez em `src/index.ts`** (`OPSPILOT_CORS_ORIGINS`, lista
   separada por vírgula, validada por zod; inválida = servidor não sobe). `createApp` recebe
   `corsOrigins` (default `["http://localhost:5173"]`).
3. **Esquemas de resposta viram fonte única em `src/domain/`** (R-003): `traceEventSchema`,
   `runMetricsSchema`, `strategyResultSchema`, `chatResponseSchema`, `apiErrorBodySchema`,
   `pendingActionSchema`, `chatAcceptedSchema`, `approvalDecisionSchema`, `approvalDeniedSchema`. `src/trace/types.ts`
   passa a derivar `TraceEvent`/`RunMetrics`/`ContextBreakdown`/`StrategyResult` por `z.infer` e
   mantém os mesmos nomes exportados. Nenhum import existente muda.
4. **A war room importa `src/domain/` por alias** (`@domain` → `../src/domain`), com
   `server.fs.allow: [".."]`. `schemas.ts` só importa `zod`, então é seguro no navegador. Um teste
   da API garante isso (R-003).
5. **Rastro tolerante** (FR-008): a lista chega como `unknown[]` e cada evento passa por
   `traceEventSchema.safeParse`. O que falha vira `{ kind: "unknown", raw }`. A resposta como um
   todo é validada com `trace: z.array(z.unknown())`, para que um evento novo não derrube a resposta.
6. **Estado em reducer puro** (`web/src/state/conversation.ts`): `(state, action) => state`, sem
   I/O. Ids das mensagens e relógio vêm do componente-raiz (Princípio I, aplicado à war room).
7. **Cliente HTTP injetável** (`createApiClient({ baseUrl, fetch })`): classifica cada resposta
   num `ChatOutcome` discriminado (`answered | pending | api-error | unreachable | malformed`). É o
   ponto único que conhece status HTTP.
8. **Sem roteador** (R-005): uma tela só, com rastro em gaveta e configurações em diálogo. Os
   endereços internos são `/opspilot/` e `/opspilot/index.html`. O build copia `index.html` para
   `404.html`, para hospedagens estáticas que servem 404 em deep link.
9. **Direção visual própria** (R-006), já que não há instruções de design: tokens CSS em
   `:root`, tema escuro por padrão com claro por `prefers-color-scheme`, CSS puro (sem biblioteca
   de UI), monoespaçada no rastro e uma cor por tipo de evento.

## Constitution Check

| Princípio | Veredito |
|---|---|
| I. Domínio puro | ✅ `corsDecision`, `joinApiUrl`, `parseApiUrl`, `classifyResponse`, `parseTrace` e o reducer da conversa são puros. Esquemas de resposta passam a ser zod em `src/domain/`, e os tipos do rastro são derivados por inferência, o que elimina o tipo paralelo escrito à mão em `trace/types.ts` |
| II. SQLite | ✅ Sem mudança. Preflight não grava registro |
| III. Contrato antes | ✅ `cors.md`, `approval-flow.md`, `wire-schemas.md`, `web-ui.md`. README e `.env.example` na mesma mudança |
| IV. Ferramentas | N/A (nenhuma ferramenta nova exposta ao modelo) |
| V. Offline | ✅ `npm test`/`typecheck` da raiz inalterados em requisitos. `web/` testa com `fetch` dublê, sem API e sem rede |

**Pós-design**: reavaliado depois da Phase 1. As novas dependências de `web/` estão justificadas
em Complexity Tracking, e o resto continua passando.

## Project Structure

### Documentation (this feature)

```text
specs/016-war-room-web/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cors.md
│   ├── approval-flow.md
│   ├── wire-schemas.md
│   └── web-ui.md
└── checklists/requirements.md
```

### Source Code

```text
src/domain/wire.ts            # NOVO: traceEventSchema, runMetricsSchema, strategyResultSchema,
                              #       chatResponseSchema, apiErrorBodySchema, pendingActionSchema,
                              #       chatAcceptedSchema, approvalDecisionSchema, approvalDeniedSchema
src/domain/wire.test.ts       # NOVO: fixtures do 003–014 passam; só importa zod (browser-safe)
src/trace/types.ts            # tipos passam a ser z.infer de wire.ts (mesmos nomes exportados)
src/http/cors.ts              # NOVO: corsDecision (pura) + createCors (middleware)
src/http/cors.test.ts         # NOVO
src/http/server.ts            # dep corsOrigins; app.use(createCors(...)) antes das rotas
src/http/server.test.ts       # + preflight, origem permitida/negada, sem origem inalterado
src/index.ts                  # lê OPSPILOT_CORS_ORIGINS
.env.example, README.md       # OPSPILOT_CORS_ORIGINS; seção "War room"

web/
├── package.json              # dev, build, preview, test, typecheck
├── vite.config.ts            # base "/opspilot/", alias @domain, fs.allow, vitest jsdom
├── tsconfig.json
├── index.html
├── .env.example              # VITE_OPSPILOT_API_URL
└── src/
    ├── main.tsx
    ├── App.tsx               # composição: ids/relógio, reducer, cliente, layout
    ├── api/
    │   ├── url.ts            # parseApiUrl, joinApiUrl (puras)
    │   ├── client.ts         # createApiClient → sendChat, decide; classifyResponse
    │   └── *.test.ts
    ├── state/
    │   ├── conversation.ts   # reducer puro + seletores (canSend)
    │   └── conversation.test.ts
    ├── settings/
    │   ├── api-url-store.ts  # load/save/reset com try/catch
    │   ├── SettingsDialog.tsx
    │   └── *.test.ts(x)
    ├── trace/
    │   ├── parse-trace.ts    # unknown[] → KnownEvent | UnknownEvent
    │   ├── TraceDrawer.tsx   # cabeçalho (stoppedReason + métricas) + lista
    │   ├── events/           # um componente por tipo + UnknownEventView
    │   └── *.test.ts(x)
    ├── chat/
    │   ├── MessageList.tsx, Composer.tsx, ErrorBubble.tsx, ApprovalCard.tsx
    │   └── *.test.tsx
    └── styles/
        ├── tokens.css        # cores/tipografia como variáveis, escuro + claro
        └── app.css
```

**Structure Decision**: a API continua em `src/`, e a war room ganha `web/` como pacote próprio
(seu próprio `package.json`, sem workspaces npm). `npm test` e `npm run typecheck` da raiz não
enxergam `web/`. A war room tem os mesmos portões em `npm --prefix web test` e
`npm --prefix web run typecheck`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Novo pacote `web/` com dependências próprias (React, Vite) | Pedido explícito (Vite+React+TS) e única forma de entregar uma UI no navegador | HTML estático servido pelo Express: não atende ao pedido, acopla publicação da UI à API e não serve sob `/opspilot/` num host estático |
| `vitest` + `jsdom` + Testing Library em vez de `node:test` | FR-007/FR-008 (tipo desconhecido não quebra a tela) e o cartão de decisão única só são verificáveis renderizando componentes. Vitest reaproveita a config do Vite (alias `@domain`, JSX) | `node:test` + `tsx`: não transforma JSX com a config do Vite nem tem DOM. Testar só funções puras deixaria FR-007/FR-008/FR-013 sem verificação |
| Refatorar `src/trace/types.ts` para `z.infer` | Princípio I exige esquema único. A war room precisa validar o rastro na chegada (FR-011) | Copiar os esquemas para `web/`: tipo paralelo escrito à mão, que diverge na primeira mudança de rastro |
