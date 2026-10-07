# Quickstart: validar a publicação da war room

Contratos: [pages-workflow.md](./contracts/pages-workflow.md),
[build-base.md](./contracts/build-base.md).

## 1. Portões locais (offline)

```bash
npm run typecheck && npm test                 # raiz: inalterados
npm --prefix web run typecheck
npm --prefix web test                         # inclui web/build/base.test.ts
```

Esperado: tudo verde.

## 2. Build sem variável = comportamento de 016

```bash
npm --prefix web run build
grep -o 'src="/opspilot/[^"]*"' web/dist/index.html
cmp web/dist/index.html web/dist/404.html && echo "404 ok"
```

Esperado: recursos sob `/opspilot/` e `404 ok`.

## 3. Build como o Pages faz

```bash
OPSPILOT_WEB_BASE=/ops-pilot npm --prefix web run build      # sem barra final, como o configure-pages
grep -o 'src="/ops-pilot/[^"]*"' web/dist/index.html
OPSPILOT_WEB_BASE=/ops-pilot npm --prefix web run preview
```

Abra `http://localhost:4173/ops-pilot/` e `http://localhost:4173/ops-pilot/qualquer-coisa`.
Esperado: a war room carrega nos dois, sem recurso 404 no DevTools.

## 4. Base inválida falha o build

```bash
OPSPILOT_WEB_BASE='https://x/y' npm --prefix web run build; echo "exit=$?"
```

Esperado: mensagem citando `OPSPILOT_WEB_BASE`, `exit` diferente de 0 e nenhum `dist/` novo.

## 5. Primeira publicação (GitHub)

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. (Opcional) Settings → Secrets and variables → Actions → Variables: `OPSPILOT_API_URL`.
3. Actions → "Deploy war room to Pages" → **Run workflow** em `main`.

Esperado: `build` e `deploy` verdes, e a URL `https://kauanevieira.github.io/ops-pilot/` no resumo.

## 6. War room publicada falando com uma API local

```bash
OPSPILOT_CORS_ORIGINS=http://localhost:5173,https://kauanevieira.github.io npm run dev
```

Abra a URL publicada e envie uma mensagem. Esperado: resposta e "ver raciocínio" funcionando, sem
erro de CORS.

## 7. Portão falhando não publica

Num branch de teste integrado em `main` (ou com `workflow_dispatch` num ref com um teste quebrado
em `web/`): o job `build` falha no passo de testes, `deploy` aparece como *skipped* e a URL
continua servindo a versão anterior.

## 8. Mudança só na API não dispara

Um push em `main` que só altera `src/http/**` não cria execução de "Deploy war room to Pages".
