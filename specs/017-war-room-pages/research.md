# Research: War Room no GitHub Pages

Não há NEEDS CLARIFICATION no Technical Context. A única pergunta da spec (caminho base) foi
respondida em Clarifications (Q1 → A).

## R-001: Permissões e divisão em jobs

- **Decision**: no topo, `permissions: {}`. Job `build`: `contents: read`, `pages: read`. Job
  `deploy`: `pages: write`, `id-token: write`.
- **Rationale**: `deploy-pages` exige `pages: write` (criar a publicação) e `id-token: write`
  (token OIDC que prova a origem do artefato). `checkout` exige `contents: read`.
  `configure-pages` consulta `GET /repos/{owner}/{repo}/pages` e só precisa ler o Pages. Separar
  os jobs garante que dependências npm, que rodam código arbitrário na instalação, nunca recebam
  um token capaz de publicar. É o mínimo do FR-003.
- **Alternatives considered**: permissões no topo para os dois jobs (como no modelo inicial do
  GitHub), que é mais simples, mas dá `pages: write` e `id-token` ao job que roda `npm ci`. Um job
  único tem o mesmo problema. **Risco**: se o `configure-pages` falhar só com `pages: read`, o plano B
  é tirá-lo do workflow e usar o nome do repositório como base (R-005), o que dispensa
  `pages: read`. Ele não pode ir para o job `deploy`, porque o build precisa do caminho antes.

## R-002: Versões das actions

- **Decision**: major tags atuais (consultadas em 2026-10-07): `checkout@v7` (v7.0.1),
  `setup-node@v7` (v7.0.0), `configure-pages@v6` (v6.0.0), `upload-pages-artifact@v5` (v5.0.0),
  `deploy-pages@v5` (v5.0.1).
- **Rationale**: são actions oficiais (`actions/*`), e a major tag recebe correções sem quebra.
  As versões de `upload-pages-artifact` e `deploy-pages` precisam ser compatíveis entre si, e
  as majors atuais são publicadas juntas.
- **Alternatives considered**: fixar por SHA, que protege contra tag reescrita mas exige
  atualização manual e não tem Dependabot configurado aqui. Para actions do próprio GitHub, a
  major tag é o padrão da documentação. Fica fácil migrar depois.

## R-003: Instalação de dependências

- **Decision**: `actions/setup-node` com `node-version-file: .nvmrc`, `cache: npm`,
  `cache-dependency-path: package-lock.json` e `web/package-lock.json`. Raiz:
  `npm ci --ignore-scripts`. `web/`: `npm --prefix web ci`.
- **Rationale**: a war room importa `src/domain/*`, que só usa `zod`, resolvido em
  `node_modules/` da raiz (016, R-003). A raiz também traz `@huggingface/transformers`, que
  instala `onnxruntime-node` com um `postinstall` que baixa binários. Isso é inútil para o build
  estático e é o passo mais lento e frágil. `--ignore-scripts` evita esse download sem mudar o
  lockfile. Em `web/` os scripts ficam ligados, porque o bundler pode precisar dos binários
  nativos.
- **Alternatives considered**: instalar só `zod` na raiz (`npm i zod`), que quebra a
  reprodutibilidade (versão fora do lockfile). Copiar `src/domain/` para `web/` violaria o
  Princípio I. Workspaces npm mudariam a estrutura de 016 sem necessidade.

## R-004: Caminho base configurável

- **Decision**: variável de build `OPSPILOT_WEB_BASE`, lida em `vite.config.ts` e normalizada por
  `resolveBase` (pura, em `web/build/base.ts`). Padrão `/opspilot/`.
- **Rationale**: atende a Q1 → A. Dev, preview e build sem variável continuam em `/opspilot/`
  (016 inalterado), e o Pages passa `/ops-pilot/`. A normalização cobre o formato que o
  `configure-pages` devolve (sem barra final) e erros de digitação. Valores que gerariam
  recursos quebrados fazem o build falhar (FR-009b). O `404.html` continua igual ao
  `index.html`, que já referencia os recursos pelo caminho base, então um acesso direto continua
  funcionando sob qualquer base.
- **Alternatives considered**: `vite build --base=/ops-pilot/` direto no workflow, que funciona
  mas não valida nada e espalha a regra fora do código testado. `import.meta.env.BASE_URL`
  sozinho não resolve, porque é saída, não entrada. Prefixo `VITE_` não serve, porque exporia a
  variável ao código do navegador sem necessidade.

## R-005: De onde vem o caminho no workflow

- **Decision**: `steps.pages.outputs.base_path` do `actions/configure-pages`, com `/` acrescentado.
- **Rationale**: é o caminho que o próprio GitHub calcula para o site (`/ops-pilot` hoje, vazio
  com domínio próprio). Assim o repositório pode ser renomeado ou ganhar domínio sem editar o
  workflow. O passo também falha cedo, com mensagem clara, quando o Pages não está habilitado.
- **Alternatives considered**: `/${{ github.event.repository.name }}/`, que é mais simples e
  dispensa `pages: read`, mas erra com domínio próprio. Fica como plano B (R-001).

## R-006: Concorrência

- **Decision**: `concurrency: { group: pages, cancel-in-progress: false }`.
- **Rationale**: o FR-004 não permite cancelar uma publicação em andamento (cancelar no meio pode
  deixar a publicação em estado inconsistente). O GitHub mantém uma única execução pendente por
  grupo e descarta as pendentes mais antigas, então dois pushes rápidos terminam com a versão
  mais nova no ar (US2, cenário 3).
- **Alternatives considered**: `cancel-in-progress: true`, que publica mais rápido, mas viola o
  FR-004.

## R-007: HTTPS do Pages × API em HTTP

- **Decision**: só documentação. O README avisa que a war room publicada fala com
  `http://localhost:*` (navegadores tratam `localhost` como contexto confiável), mas que uma API
  em outro host precisa estar em HTTPS.
- **Rationale**: é uma restrição do navegador (mixed content) que nenhum código da war room
  contorna. O erro que aparece já cai em "API não pôde ser alcançada" (016, FR-005).
- **Alternatives considered**: detectar o caso na engrenagem e avisar, que muda o comportamento
  da war room e fica fora do pedido. Pode virar uma feature futura.
