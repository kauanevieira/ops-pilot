# Contract: workflow de publicação (`.github/workflows/pages.yml`)

## Gatilhos (FR-002)

| Evento | Filtro |
|---|---|
| `push` | `branches: [main]`; `paths`: `web/**`, `src/domain/**`, `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/pages.yml` |
| `workflow_dispatch` | sem entradas; publica o `main` (ou o ref escolhido na UI) |

## Permissões (FR-003)

| Escopo | Permissões |
|---|---|
| topo | `{}` (nenhuma) |
| job `build` | `contents: read`, `pages: read` |
| job `deploy` | `pages: write`, `id-token: write` |

## Concorrência (FR-004)

`group: pages`, `cancel-in-progress: false`.

## Job `build` (`ubuntu-latest`)

Ordem fixa. Qualquer falha encerra o job, e `deploy` não roda (FR-007).

1. `actions/checkout@v7`
2. `actions/setup-node@v7`: `node-version-file: .nvmrc`, `cache: npm`, `cache-dependency-path` = os dois lockfiles
3. `npm ci --ignore-scripts` (raiz)
4. `npm --prefix web ci`
5. `npm --prefix web run typecheck`
6. `npm --prefix web test`
7. `actions/configure-pages@v6` (`id: pages`)
8. `npm --prefix web run build` com ambiente:
   - `OPSPILOT_WEB_BASE: ${{ steps.pages.outputs.base_path }}/`
   - `VITE_OPSPILOT_API_URL: ${{ vars.OPSPILOT_API_URL }}`
9. `actions/upload-pages-artifact@v5`: `path: web/dist`

## Job `deploy` (`ubuntu-latest`)

- `needs: build`
- `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }` (FR-005)
- passo único: `actions/deploy-pages@v5` (`id: deployment`)

## Entradas do repositório

| Nome | Tipo | Obrigatória | Efeito |
|---|---|---|---|
| Settings → Pages → Source = "GitHub Actions" | configuração | sim (uma vez) | sem isso, o passo 7 falha |
| `OPSPILOT_API_URL` | variável de Actions (não segredo) | não | URL padrão da API embutida na publicação. Ausente: `http://localhost:3000` |

Nenhum segredo é lido (FR-008).

## Saídas

- Site em `https://kauanevieira.github.io/ops-pilot/` (e qualquer endereço interno sob ele, via `404.html`).
- URL no resumo da execução e em Environments → `github-pages`.
