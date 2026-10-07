# Research: War Room Web

**Feature**: `016-war-room-web` | **Date**: 2026-10-07

## R-001 — CORS: middleware próprio ou o pacote `cors`

- **Decision**: middleware próprio em `src/http/cors.ts`, com o núcleo numa função pura
  `corsDecision({ origin, method, requestHeaders }, allowlist)`, que devolve os cabeçalhos e se a
  resposta termina ali (preflight).
- **Rationale**: a política é pequena e fechada: lista exata de origens, `GET`/`POST`/`OPTIONS`,
  `Content-Type` e `X-Request-Id` exposto. São umas 30 linhas testáveis sem HTTP. A constituição
  manda justificar dependência nova, e aqui a alternativa simples resolve.
- **Alternatives considered**: o pacote `cors` funciona, mas é uma dependência de runtime para algo
  que cabe numa função pura, e a política dele por padrão (`*`) é mais aberta que FR-023. Usar `*`
  sem lista viola FR-023/FR-024.

## R-002 — Política de CORS em detalhe

- **Decision**:
  - Origem comparada por igualdade exata com a lista, depois de normalizar (esquema + host +
    porta, sem barra final). Sem curingas.
  - Origem permitida: `Access-Control-Allow-Origin: <origem>`, `Vary: Origin`,
    `Access-Control-Expose-Headers: X-Request-Id`.
  - Preflight (`OPTIONS` com `Access-Control-Request-Method`) de origem permitida: 204 +
    `Allow-Methods: GET, POST`, `Allow-Headers: Content-Type`, `Max-Age: 600`.
  - Preflight de origem não permitida: 204 **sem** cabeçalhos CORS. O navegador bloqueia, e o
    servidor não vaza a lista.
  - Chamada comum de origem não permitida: segue normalmente, sem cabeçalhos CORS (o navegador
    bloqueia a leitura). Sem origem: idêntico a hoje.
  - Sem credenciais (`Allow-Credentials` ausente): a API não usa cookie.
- **Rationale**: é o mínimo que libera `fetch` com corpo JSON e leitura de `X-Request-Id` (FR-023).
  Responder 403 a origem negada não protege nada além do que o navegador já faz, e mudaria a
  resposta de chamadas que hoje funcionam.

## R-003 — Esquemas compartilhados entre API e war room

- **Decision**: criar `src/domain/wire.ts` com os esquemas zod de tudo o que a API devolve e a war
  room lê. `src/trace/types.ts` passa a exportar `type TraceEvent = z.infer<typeof
  traceEventSchema>` (e o mesmo para `RunMetrics`, `ContextBreakdown`, `StrategyResult`). Os
  comentários de cada membro migram para o esquema. A war room importa por alias `@domain`.
- **Rationale**: o Princípio I proíbe tipo paralelo escrito à mão, e `TraceEvent` hoje é
  exatamente isso. O `_TraceTypesInSync` continua valendo, agora entre dois esquemas. `wire.ts` e
  `schemas.ts` só importam `zod`. Um teste lê os imports do diretório e falha se aparecer
  `node:` ou caminho fora de `src/domain/`, o que mantém o domínio seguro para o navegador.
- **Alternatives considered**:
  - Assertion de igualdade entre o tipo escrito à mão e o `z.infer`: garante o mesmo resultado,
    mas mantém duas definições, contra o texto do Princípio I.
  - Pacote `packages/domain` com workspaces npm: muda a instalação do projeto inteiro
    (`npm install && npm run dev` deixa de bastar) para resolver o que um alias resolve.
  - Gerar JSON Schema e tipos para o web: mais uma etapa de build sem ganho.
- **Resolução de `zod`**: arquivos de `../src/domain` resolvem `zod` subindo até
  `node_modules` da raiz, tanto no Vite quanto no `tsc`. Por isso `web/` não declara `zod`, e
  instalar a raiz passa a ser pré-requisito da war room (quickstart). Assim existe uma única
  cópia de zod no bundle.

## R-004 — Validação na chegada sem derrubar a tela

- **Decision**: o cliente valida em dois níveis. (1) O envelope (`chatResponseSchema` com
  `trace: z.array(z.unknown())`, `chatAcceptedSchema`, `apiErrorBodySchema`): se falhar, o
  resultado é `malformed` e vira erro legível (FR-011). (2) Cada evento, por `parseTrace`: o que
  falhar vira `UnknownEvent` (FR-008). Métricas usam `runMetricsSchema` em modo não estrito
  (`z.object`, que descarta campos desconhecidos), para que uma métrica nova não quebre nada.
- **Rationale**: a API evolui por emendas aditivas (007–015). A war room precisa aceitar campo e
  evento novos sem precisar de deploy conjunto.

## R-005 — Roteamento e caminho base

- **Decision**: sem roteador. `vite.config.ts` com `base: "/opspilot/"`, e o servidor de dev
  também sob `/opspilot/`. Um plugin de build mínimo copia `dist/index.html` para `dist/404.html`.
- **Rationale**: a spec tem uma única tela. Gaveta e diálogo não precisam de URL. Sem rotas
  internas, "acesso direto a endereço interno" (FR-020) se reduz a `/opspilot/` e
  `/opspilot/index.html`, e o `404.html` cobre hosts estáticos que não fazem fallback.
- **Alternatives considered**: React Router com `basename`: dependência sem rota para servir.

## R-006 — Direção visual (sem instruções de design no repositório)

- **Decision**: "sala de guerra".
  - Tema escuro por padrão (`--bg` quase preto azulado, `--surface` um degrau acima), tema claro
    por `prefers-color-scheme: light`. Todas as cores são variáveis em `:root`.
  - Layout: coluna de conversa centralizada (máx. ~820 px), compositor fixo no rodapé, gaveta de
    rastro à direita no desktop e em tela cheia no celular (≤ 640 px). Engrenagem e "nova conversa"
    no cabeçalho, junto com a URL da API em uso, abreviada.
  - Rastro em fonte monoespaçada, cada tipo com cor e rótulo próprios: `route` (violeta),
    `thought` (cinza), `action` (azul), `observation` (verde; vermelho com `isError`), `plan`
    (âmbar), `critique` (laranja), `answer` (branco/realce), `summarize` (ciano), `fallback`
    (vermelho), desconhecido (tracejado neutro). O rótulo vem sempre em texto, nunca só cor
    (acessibilidade).
  - Cartão de aprovação com borda âmbar e ícone de alerta. Aprovar é o botão primário, Negar o
    secundário. Depois da decisão, o cartão vira um selo "aprovado" ou "negado".
  - CSS puro (um arquivo de tokens e um de app). Sem biblioteca de componentes, sem Tailwind.
- **Rationale**: denso e legível sob pressão. Tema escuro é o padrão de ferramentas de plantão.
  Com CSS puro, a direção é trocada por um arquivo de tokens quando houver instruções formais.
- **Alternatives considered**: uma biblioteca de UI (MUI, shadcn): dependência pesada para uma
  tela só. Ficar sem direção visual: FR-022 ficaria inverificável.

## R-007 — Prazo do cliente e indicador de andamento

- **Decision**: `AbortController` a 190 s (acima dos 180 s da API, FR-004). Abortar por esse prazo
  vira `unreachable` com mensagem de tempo. O indicador mostra o tempo decorrido em segundos.
- **Rationale**: a API sempre responde até 180 s, mesmo que seja com 504. O prazo do cliente só
  existe para não ficar pendurado se a rede cair sem fechar a conexão.

## R-008 — Distinguir "API inalcançável" de "bloqueado por origem"

- **Decision**: os dois viram `unreachable`, com a mesma mensagem: "não foi possível falar com a
  API em <url>". A mensagem sugere conferir a URL na engrenagem e a lista `OPSPILOT_CORS_ORIGINS`
  da API.
- **Rationale**: o navegador não expõe ao JavaScript se um `fetch` falhou por rede ou por CORS.
  Ambos aparecem como `TypeError`, e tentar adivinhar daria diagnóstico errado.

## R-009 — URL padrão da API

- **Decision**: `import.meta.env.VITE_OPSPILOT_API_URL`, definido no build, com
  `http://localhost:3000` quando ausente. Ordem de uso: valor salvo no `localStorage`, se válido →
  padrão do build. `parseApiUrl` aceita só `http:`/`https:` absolutas, remove a barra final e
  preserva o caminho (`https://host/api`). `joinApiUrl(base, "/chat")` concatena sem barra dupla.

## R-010 — Testes da war room

- **Decision**: Vitest em `jsdom`. As funções puras (url, reducer, `classifyResponse`,
  `parseTrace`) têm testes de unidade. Componentes (`TraceDrawer`, cada evento, `ApprovalCard`,
  `SettingsDialog`, `App` com `fetch` dublê) são testados com Testing Library. Fixtures de rastro
  vêm de objetos tipados por `z.infer`, então mudar o rastro na API quebra o typecheck do teste.
- **Rationale**: ver Complexity Tracking no plano.
