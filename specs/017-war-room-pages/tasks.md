---

description: "Task list for 017 — War Room no GitHub Pages"
---

# Tasks: War Room no GitHub Pages

**Input**: Design documents from `/specs/017-war-room-pages/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (pages-workflow.md, build-base.md), quickstart.md

**Tests**: só `resolveBase` tem teste automatizado (contrato [build-base.md](./contracts/build-base.md), Princípio V). O workflow é validado pelo roteiro do [quickstart.md](./quickstart.md).

**Organization**: tarefas agrupadas por história da spec. US1, US2 e US3 editam o mesmo arquivo (`.github/workflows/pages.yml`), então são sequenciais entre si. US4 (docs) pode correr em paralelo a elas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: história da spec (US1–US4)

---

## Phase 1: Setup

**Purpose**: ponto de partida verde

- [x] T001 Criar o branch `017-war-room-pages` a partir de `main` e confirmar os portões atuais verdes: `npm run typecheck && npm test` (raiz) e `npm --prefix web run typecheck && npm --prefix web test`
- [x] T002 Criar o diretório `.github/workflows/` (o primeiro workflow do repositório) e o diretório `web/build/`

---

## Phase 2: Foundational (caminho base configurável)

**Purpose**: o build precisa aceitar `/ops-pilot/` antes que qualquer publicação funcione (FR-009, FR-009a, FR-009b; Q1 → A)

**⚠️ CRITICAL**: a US1 depende desta fase

- [x] T003 [P] Escrever `web/build/base.test.ts` (vitest) cobrindo toda a tabela de [build-base.md](./contracts/build-base.md): `undefined`/`""`/só espaços → `/opspilot/`; `/ops-pilot/` → `/ops-pilot/`; `/ops-pilot` → `/ops-pilot/`; `ops-pilot` → `/ops-pilot/`; `/` → `/`; `/a/b` → `/a/b/`; `//` → `/` e barras repetidas colapsadas; espaços nas pontas removidos; e erro com a mensagem exata `OPSPILOT_WEB_BASE inválido: "<valor>". Use um caminho como /ops-pilot/.` para valores contendo `://`, espaço interno, `..`, `?`, `#` ou `\`. O teste deve falhar antes de T004
- [x] T004 Implementar `resolveBase(raw: string | undefined): string` em `web/build/base.ts` (função pura, sem ler `process.env`, comentário referenciando FR-009/FR-009b e o contrato), até T003 passar
- [x] T005 Em `web/vite.config.ts`, trocar `base: "/opspilot/"` por `base: resolveBase(process.env.OPSPILOT_WEB_BASE)` (único ponto que lê a variável) e acrescentar `"build/**/*.test.ts"` a `test.include`
- [x] T006 Em `web/tsconfig.json`, acrescentar `"build"` a `include`, para que `npm --prefix web run typecheck` cubra `web/build/`
- [x] T007 Validar os passos 2, 3 e 4 do [quickstart.md](./quickstart.md): sem variável, os recursos ficam sob `/opspilot/` e `404.html` é igual a `index.html`; com `OPSPILOT_WEB_BASE=/ops-pilot`, os recursos ficam sob `/ops-pilot/` e a preview carrega em `http://localhost:4173/ops-pilot/` e num endereço interno; com `OPSPILOT_WEB_BASE='https://x/y'`, o build falha com a mensagem do contrato e não escreve `dist/`

**Checkpoint**: `npm --prefix web test` e `typecheck` verdes. O build local reproduz o que o Pages vai servir

---

## Phase 3: User Story 1 - A war room publicada a cada mudança em `main` (Priority: P1) 🎯 MVP

**Goal**: push em `main` que toca a war room → build → publicação no Pages, com a URL no resumo

**Independent Test**: integrar em `main` uma mudança visível em `web/` e, ao fim da execução, ver a mudança em `https://kauanevieira.github.io/ops-pilot/` (também por acesso direto a um endereço interno)

- [x] T008 [US1] Criar `.github/workflows/pages.yml` com `name: Deploy war room to Pages`; `on.push` em `branches: [main]` com `paths`: `web/**`, `src/domain/**`, `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/pages.yml`; `permissions: {}` no topo; `concurrency: { group: pages, cancel-in-progress: false }` (FR-002, FR-003, FR-004; R-006)
- [x] T009 [US1] Em `.github/workflows/pages.yml`, adicionar o job `build` (`runs-on: ubuntu-latest`, `permissions: { contents: read, pages: read }`) com, nesta ordem: `actions/checkout@v7`; `actions/setup-node@v7` (`node-version-file: .nvmrc`, `cache: npm`, `cache-dependency-path` com `package-lock.json` e `web/package-lock.json`); `npm ci --ignore-scripts`; `npm --prefix web ci`; `actions/configure-pages@v6` com `id: pages`; `npm --prefix web run build` com `env` `OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/` e `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}`; `actions/upload-pages-artifact@v5` com `path: web/dist` (FR-001, FR-006, FR-009a, FR-010; R-001–R-005)
- [x] T010 [US1] Em `.github/workflows/pages.yml`, adicionar o job `deploy` (`needs: build`, `runs-on: ubuntu-latest`, `permissions: { pages: write, id-token: write }`, `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`) com o passo único `actions/deploy-pages@v5` e `id: deployment` (FR-001, FR-003, FR-005)
- [x] T011 [US1] Validar o YAML localmente: rodar `actionlint` (binário de `rhysd/actionlint`) se estiver instalado, senão conferir com `python3 -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/pages.yml"))'` e revisar campo a campo contra [pages-workflow.md](./contracts/pages-workflow.md)
- [ ] T012 [US1] (Pós-merge, manual) Seguir o passo 5 do [quickstart.md](./quickstart.md): habilitar Settings → Pages → Source "GitHub Actions" e verificar que o push do merge publica, com `build` e `deploy` verdes e a URL no resumo. Se o `configure-pages` falhar por permissão com `pages: read`, aplicar o plano B de R-001: remover o passo `configure-pages` e `pages: read`, e usar `OPSPILOT_WEB_BASE: /${{ github.event.repository.name }}/`

**Checkpoint**: a war room é publicada automaticamente (MVP)

---

## Phase 4: User Story 2 - Nada quebrado vai ao ar (Priority: P1)

**Goal**: os portões da war room rodam antes do build, e qualquer falha impede a publicação

**Independent Test**: com um teste de `web/` quebrado, o job `build` falha, `deploy` fica *skipped* e a URL continua servindo a versão anterior

- [x] T013 [US2] Em `.github/workflows/pages.yml`, inserir no job `build`, entre `npm --prefix web ci` e `actions/configure-pages`, os passos `npm --prefix web run typecheck` e `npm --prefix web test`, sem `continue-on-error` (FR-007, FR-008). Conferir que `deploy` só depende de `needs: build` (sem `if: always()`)
- [ ] T014 [US2] (Pós-merge, manual) Seguir o passo 7 do [quickstart.md](./quickstart.md) num ref descartável com um teste quebrado em `web/` (via `workflow_dispatch`, depois de T015): confirmar a falha no passo de testes, `deploy` *skipped* e o site inalterado. Apagar o ref depois

**Checkpoint**: US1 + US2 = critério de integração da feature (todas as P1)

---

## Phase 5: User Story 3 - Publicar sob demanda (Priority: P2)

**Goal**: disparo manual pela aba Actions

**Independent Test**: Actions → "Deploy war room to Pages" → Run workflow em `main` publica como um push

- [x] T015 [US3] Em `.github/workflows/pages.yml`, acrescentar `workflow_dispatch:` (sem entradas) a `on` (FR-002)
- [ ] T016 [US3] (Pós-merge, manual) Disparar o workflow manualmente em `main` e confirmar `build` e `deploy` verdes, com a URL no resumo

---

## Phase 6: User Story 4 - Saber como usar e manter a versão publicada (Priority: P2)

**Goal**: README, exemplo de ambiente e contratos refletem a publicação (FR-011, FR-012; Princípio III)

**Independent Test**: seguindo só o README, alguém habilita o Pages, publica e conversa com uma API local que liberou a origem do Pages (passo 6 do quickstart)

- [x] T017 [P] [US4] Em `README.md`, na seção "War room (interface web)", acrescentar a subseção "Publicação no GitHub Pages" com: o endereço `https://kauanevieira.github.io/ops-pilot/`; o passo único Settings → Pages → Source "GitHub Actions"; o que dispara o workflow (push em `main` nos caminhos do contrato) e como disparar manualmente; que os portões da war room rodam antes e uma falha não publica; a variável de repositório `OPSPILOT_API_URL` (opcional, padrão `http://localhost:3000`, trocável pela engrenagem); acrescentar `https://kauanevieira.github.io` (sem caminho) a `OPSPILOT_CORS_ORIGINS`; o aviso de que uma API fora de `localhost` precisa estar em HTTPS (R-007); link para [pages-workflow.md](./contracts/pages-workflow.md)
- [x] T018 [US4] Em `README.md`, ajustar o item "Caminho base `/opspilot/`" da mesma seção para dizer que `/opspilot/` é o padrão local e que `OPSPILOT_WEB_BASE` muda o caminho no build (o Pages usa `/ops-pilot/`); no bloco de comandos (~linha 96), acrescentar o build com `OPSPILOT_WEB_BASE=/ops-pilot`; na árvore em "Estrutura", acrescentar `.github/workflows/pages.yml` e `web/build/` e ajustar a linha de `web/` (base `/opspilot/` por padrão); na lista de specs (~linha 604), acrescentar `specs/017-war-room-pages/` (FR-012)
- [x] T019 [P] [US4] Em `.env.example`, junto de `OPSPILOT_CORS_ORIGINS`, acrescentar um exemplo comentado com `http://localhost:5173,https://kauanevieira.github.io` para usar a war room publicada
- [x] T020 [P] [US4] Em `specs/016-war-room-web/contracts/web-ui.md`, emendar a linha "Caminho base" conforme a seção "Emenda em 016" de [build-base.md](./contracts/build-base.md)
- [x] T021 [P] [US4] Em `.github/copilot-instructions.md`, atualizar a linha de `web/` (base `/opspilot/` por padrão, `OPSPILOT_WEB_BASE` no build, `web/build/base.ts`) e acrescentar que `.github/workflows/pages.yml` publica a war room no Pages

---

## Phase 7: Polish & Cross-Cutting

- [x] T022 Rodar o passo 1 do [quickstart.md](./quickstart.md) (portões da raiz e de `web/`) e garantir tudo verde (SC-005)
- [x] T023 Conferir que nenhum `web/dist/` foi versionado (`git status`), e que o README não contradiz o desenvolvimento local (dev em `5173/opspilot/`, preview em `4173/opspilot/`)
- [x] T024 Marcar `- [x]` nas tarefas concluídas e registrar em `tasks.md` as validações pós-merge (T012, T014, T016) que ficaram pendentes (ficam abertas acima: só rodam no GitHub depois do merge em `main`, com o Pages habilitado)

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T007)** → **US1 (T008–T012)** → **US2 (T013–T014)** → **US3 (T015–T016)**. Todas editam `pages.yml`, então são sequenciais. T014 usa o disparo manual de T015.
- **US4 (T017–T021)** não depende do workflow. Pode começar logo depois do Setup, em paralelo a Foundational e US1. T017 e T018 editam o mesmo `README.md` e são sequenciais entre si.
- **Polish (T022–T024)** depois de todas as histórias.
- Tarefas marcadas "pós-merge, manual" (T012, T014, T016) só rodam no GitHub, depois da integração em `main`, e não bloqueiam o merge.

## Parallel Example

```text
# Depois de T002, em paralelo:
T003  web/build/base.test.ts
T017  README.md (subseção de publicação)
T019  .env.example
T020  specs/016-war-room-web/contracts/web-ui.md
T021  .github/copilot-instructions.md
```

## Implementation Strategy

**MVP (P1)**: Setup → Foundational → US1 → US2. É o mínimo integrável pela constituição (todas as
P1): a war room vai ao ar sozinha, e só se os portões passarem. A ordem dentro do PR não deixa
uma janela em que publicar sem portões chegue a `main`, porque US1 e US2 entram juntas.

**Incremento**: US3 (uma linha) e US4 (docs) no mesmo conjunto de mudanças. O Princípio III exige
README e contratos atualizados junto com a mudança de comportamento observável, então US4 não
fica para depois na prática.
