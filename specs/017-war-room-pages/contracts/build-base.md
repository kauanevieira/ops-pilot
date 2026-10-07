# Contract: caminho base do build da war room

`web/build/base.ts` exporta:

```ts
resolveBase(raw: string | undefined): string // lança Error em valor inválido
```

`web/vite.config.ts` usa `base: resolveBase(process.env.OPSPILOT_WEB_BASE)` em dev, preview, build
e test. Nenhum outro lugar lê `OPSPILOT_WEB_BASE`.

## Tabela de comportamento

| Entrada | Saída |
|---|---|
| `undefined`, `""`, só espaços | `/opspilot/` (padrão, 016 FR-020) |
| `/ops-pilot/` | `/ops-pilot/` |
| `/ops-pilot` (formato do `configure-pages`) | `/ops-pilot/` |
| `ops-pilot` | `/ops-pilot/` |
| `/` | `/` (domínio próprio) |
| `/a/b` | `/a/b/` |
| `//` ou barras repetidas | colapsadas (`/`, `/a/b/`) |
| contém `://`, espaço interno, `..`, `?`, `#` ou `\` | **erro**: `OPSPILOT_WEB_BASE inválido: "<valor>". Use um caminho como /ops-pilot/.` |

Espaços nas pontas são removidos antes de aplicar as regras.

## Garantias

- Sem variável, o comportamento de 016 é idêntico: dev em `http://localhost:5173/opspilot/`,
  preview em `http://localhost:4173/opspilot/`, build com recursos sob `/opspilot/`.
- O `404.html` continua sendo cópia de `index.html` sob qualquer base (FR-009a).
- Erro de base interrompe `vite build` antes de escrever `dist/`, então nenhum artefato quebrado
  é empacotado (FR-009b).

## Emenda em 016

`specs/016-war-room-web/contracts/web-ui.md`, linha "Caminho base": passa a ser "`/opspilot/` por
padrão. Configurável no build por `OPSPILOT_WEB_BASE` (017). No GitHub Pages: `/ops-pilot/`".
