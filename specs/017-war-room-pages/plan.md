# Implementation Plan: War Room no GitHub Pages

**Branch**: `017-war-room-pages` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

## Summary

Um workflow `.github/workflows/pages.yml` publica a war room (`web/`) no GitHub Pages do
repositório a cada push em `main` que afete a war room, e também por disparo manual. Ele tem dois
jobs. `build` (só leitura) instala as dependências, roda os portões da war room, gera o build e o
empacota com `actions/upload-pages-artifact`. `deploy` (`pages: write`, `id-token: write`) publica
com `actions/deploy-pages` no ambiente `github-pages`.

O caminho base deixa de ser fixo. `vite.config.ts` lê `OPSPILOT_WEB_BASE` por meio de uma função
pura `resolveBase`, com padrão `/opspilot/` (dev e preview locais não mudam). O workflow passa o
`base_path` que o `actions/configure-pages` informa (`/ops-pilot`), então um domínio próprio no
futuro funciona sem editar o workflow. A URL padrão da API vem da variável de repositório
`OPSPILOT_API_URL`, repassada como `VITE_OPSPILOT_API_URL`. O README ganha uma subseção de
publicação, e o contrato `web-ui.md` de 016 recebe uma emenda.

## Technical Context

**Language/Version**: TypeScript (mesma versão da raiz), Node 22 (`.nvmrc`), YAML do GitHub Actions.

**Primary Dependencies**: nenhuma dependência npm nova. Actions oficiais, fixadas na major atual
(R-002): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`,
`actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.

**Storage**: N/A.

**Testing**: `vitest` de `web/`, que passa a incluir `web/build/**/*.test.ts` para `resolveBase`.
O workflow é verificado pelo roteiro do [quickstart.md](./quickstart.md), com o build local sob
`/ops-pilot/` e a primeira execução real.

**Target Platform**: GitHub-hosted runner `ubuntu-latest` → GitHub Pages (`https://kauanevieira.github.io/ops-pilot/`).

**Project Type**: web-service existente + frontend estático. Esta feature só mexe em CI e build.

**Performance Goals**: do push à publicação em até 5 min (SC-001). Instalação com cache npm e
`--ignore-scripts` na raiz (R-003).

**Constraints**: portões sem segredos, sem API e sem rede além do registro npm (FR-008,
Princípio V). Permissões mínimas por job (FR-003). Uma publicação por vez, sem cancelar a que
está em andamento (FR-004).

**Scale/Scope**: 1 workflow, 1 módulo puro (`resolveBase`) com teste, ~3 linhas em
`vite.config.ts`, a seção do README e uma emenda de contrato.

## Decisões

1. **Dois jobs, permissões por job** (R-001): no topo, `permissions: {}`. `build` recebe
   `contents: read` e `pages: read`, porque o `configure-pages` lê a configuração do Pages.
   `deploy` recebe `pages: write` e `id-token: write`, os dois exigidos pelo `deploy-pages`. Nenhum
   job tem as duas coisas ao mesmo tempo: o código de terceiros que roda no `npm ci` nunca vê um
   token que publica.
2. **Caminho base por ambiente, resolvido por função pura** (R-004): `web/build/base.ts` exporta
   `resolveBase(raw: string | undefined): string`. Vazio ou ausente vira `/opspilot/`. Barras
   inicial e final faltando são acrescentadas, e `/` continua `/`. Valor com esquema (`://`),
   espaço, `..`, `?` ou `#` faz o build falhar com mensagem que cita `OPSPILOT_WEB_BASE` (FR-009b).
   `vite.config.ts` usa `base: resolveBase(process.env.OPSPILOT_WEB_BASE)`.
3. **Base vinda do `configure-pages`** (R-005): `OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/`.
   Hoje isso dá `/ops-pilot/`; com um domínio próprio daria `/`. O nome do repositório não fica
   escrito no workflow. Se o Pages não estiver habilitado, o `configure-pages` falha cedo com
   mensagem do GitHub (edge case da spec).
4. **Gatilhos** (FR-002): `push` em `main` com `paths` = `web/**`, `src/domain/**`,
   `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/pages.yml`, mais
   `workflow_dispatch`. Mudança só na API não dispara.
5. **Concorrência** (FR-004): `concurrency: { group: pages, cancel-in-progress: false }`. O GitHub
   mantém no máximo uma execução pendente por grupo e a substitui pela mais nova, então a última
   publicação é sempre a do commit mais recente.
6. **Instalação** (R-003): `setup-node` com `node-version-file: .nvmrc`, `cache: npm` e
   `cache-dependency-path` cobrindo os dois lockfiles. `npm ci --ignore-scripts` na raiz, porque a
   war room só precisa de `zod` de lá e isso evita o `postinstall` do `onnxruntime-node`. Em
   `web/`, `npm --prefix web ci` sem flags.
7. **Portões antes do build** (FR-007): `npm --prefix web run typecheck`, depois
   `npm --prefix web test`, depois `npm --prefix web run build`. Qualquer falha encerra o job
   `build`. Assim `deploy` (que tem `needs: build`) não roda e o Pages continua com a versão
   anterior.
8. **URL padrão da API** (FR-010): `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}` no passo
   de build. Variável ausente vira string vazia, e `buildDefault()` (016) cai em
   `http://localhost:3000`. Nenhum código da war room muda.
9. **Endereço no resumo** (FR-005): `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`.
   O GitHub mostra a URL no resumo da execução e na página de ambientes.
10. **Sem mudança na API**: o CORS de 016 já aceita lista. A origem do Pages
    (`https://kauanevieira.github.io`, sem caminho) só é documentada no README e no
    `.env.example`, como exemplo comentado.

## Constitution Check

| Princípio | Veredito |
|---|---|
| I. Domínio puro | ✅ `resolveBase` é pura. Lê ambiente só em `vite.config.ts` (borda) e recebe o valor por parâmetro |
| II. SQLite | N/A (sem persistência) |
| III. Contrato antes | ✅ `contracts/pages-workflow.md` e `contracts/build-base.md`. Emenda em `016/contracts/web-ui.md`. README e `.env.example` na mesma mudança |
| IV. Ferramentas | N/A (nenhuma ferramenta exposta ao modelo) |
| V. Offline | ✅ O teste de `resolveBase` roda no `vitest` de `web/`, sem rede. O workflow não usa segredos e só acessa a rede para o registro npm e a API do GitHub. Os portões locais da raiz e de `web/` não mudam em requisitos |

**Conformidade (complexidade)**: nenhuma dependência de runtime, camada ou serviço novo. O GitHub
Pages é a hospedagem pedida explicitamente.

**Pós-design**: reavaliado depois da Phase 1, sem violações. Complexity Tracking fica vazio.

## Project Structure

### Documentation (this feature)

```text
specs/017-war-room-pages/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── pages-workflow.md
│   └── build-base.md
└── checklists/requirements.md
```

### Source Code

```text
.github/workflows/pages.yml   # NOVO: build (portões + build + upload-pages-artifact) → deploy (deploy-pages)
web/build/base.ts             # NOVO: resolveBase (pura)
web/build/base.test.ts        # NOVO: padrão, normalização, "/", valores recusados
web/vite.config.ts            # base: resolveBase(process.env.OPSPILOT_WEB_BASE); test.include + "build/**/*.test.ts"
web/tsconfig.json             # include + "build"
README.md                     # subseção "Publicação no GitHub Pages"; comandos rápidos; árvore (.github/workflows/, web/build/)
.env.example                  # exemplo comentado com a origem do Pages em OPSPILOT_CORS_ORIGINS
specs/016-war-room-web/contracts/web-ui.md   # emenda: caminho base configurável (017)
```

**Structure Decision**: nada muda em `src/`. `web/build/` guarda o código que só roda no build
(fora de `web/src/`, que vai para o navegador). O workflow fica em `.github/workflows/`, o primeiro
do repositório. Não entra CI da API nesta feature (fora do escopo pedido).

## Complexity Tracking

Sem violações.
