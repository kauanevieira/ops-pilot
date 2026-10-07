# Data Model: War Room no GitHub Pages

Sem persistência. As "entidades" são entradas e saídas do build e da publicação.

## Configuração de build

| Campo | Origem | Regra | Padrão |
|---|---|---|---|
| `OPSPILOT_WEB_BASE` | ambiente do processo de build (workflow: `configure-pages` → `base_path` + `/`) | normalizada por `resolveBase` ([build-base.md](./contracts/build-base.md)). Inválida faz o build falhar | `/opspilot/` |
| `VITE_OPSPILOT_API_URL` | ambiente do build (workflow: variável de repositório `OPSPILOT_API_URL`) | validada em runtime por `parseApiUrl` (016). Inválida ou vazia cai no padrão | `http://localhost:3000` |

## Execução do fluxo de publicação

Estados de uma execução (sem estado guardado pelo projeto, só o que o GitHub mostra):

```text
disparada (push filtrado | manual)
  └─ build: install → typecheck → test → configure-pages → build → upload-pages-artifact
       ├─ falha em qualquer passo → execução falha; Pages inalterado (FR-007)
       └─ sucesso → deploy: deploy-pages (ambiente github-pages)
            ├─ falha → Pages inalterado
            └─ sucesso → publicação nova no ar; page_url no resumo (FR-005)
```

Concorrência: grupo `pages`, no máximo 1 em execução + 1 pendente (a mais nova), sem cancelar a
que está em andamento (FR-004).

## Publicação

| Campo | Significado |
|---|---|
| commit | o `GITHUB_SHA` que gerou o artefato |
| artefato | `web/dist/` (inclui `index.html` e `404.html` idênticos, recursos sob o caminho base) |
| `page_url` | `https://kauanevieira.github.io/ops-pilot/` hoje |

## Origem autorizada (API, inalterada)

A origem do Pages é `https://kauanevieira.github.io`: só esquema e host, nunca o caminho. Ela entra
em `OPSPILOT_CORS_ORIGINS` de quem quer usar a war room publicada com a própria API (016, FR-023).
