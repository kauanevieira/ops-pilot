# ops-pilot

OpsPilot é um copiloto de plantão que gerencia alertas e incidentes de
produção. O núcleo é um agente LangChain/LangGraph rodando sobre o OpenRouter,
com duas estratégias de raciocínio comparáveis lado a lado: **ReAct** e
**Plan-and-Execute** — e uma camada de **reflexão** (`reflect:react`,
`reflect:plan-and-execute`) que decora qualquer uma delas com um ciclo de
crítica e regeneração antes de entregar a resposta.

## Pré-requisitos

- **Node 22 LTS** (ver [.nvmrc](.nvmrc); rode `nvm use` se tiver o nvm instalado)
- Uma chave de API do [OpenRouter](https://openrouter.ai/)

## Setup

```bash
npm install
cp .env.example .env
```

Preencha o `.env`:

```
OPENROUTER_API_KEY=<sua chave>
OPENROUTER_MODEL=<ex.: openai/gpt-4o-mini>
```

`.env` nunca é lido pelo agente de codificação nem commitado — as credenciais
chegam ao processo via a flag nativa `--env-file-if-exists` do Node.

Opcionalmente, defina onde o banco SQLite deve viver:

```
OPSPILOT_DB=./data/opspilot.db
```

Sem essa variável, o padrão já é `./data/opspilot.db`. Os testes usam `:memory:`
automaticamente e nunca tocam esse arquivo.

## Comandos

```bash
# Popula o banco SQLite (OPSPILOT_DB, padrão ./data/opspilot.db) a partir de
# src/store/seed.json (5 serviços, 6 alertas: 3 firing, 3 resolved, 3
# runbooks). Idempotente — não precisa de credenciais, nem apaga incidentes
# já registrados.
npm run seed

# Roda uma estratégia sobre um pedido em linguagem natural
npm run arena -- "quais alertas estão disparando?" --strategies react

# Compara as duas estratégias na mesma invocação
npm run arena -- "quais alertas estão disparando?" --strategies react,plan-and-execute

# Roda a versão com reflexão: crítica + regeneração até aprovar ou esgotar
# o limite (padrão: 2 reflexões, ou seja, até 3 execuções da base)
npm run arena -- "quais alertas estão disparando?" --strategies reflect:react

# Compara crua e refletida lado a lado — sem --strategies só as cruas rodam,
# porque a reflexão multiplica o custo em chamadas de modelo
npm run arena -- "<pedido>" --strategies react,reflect:react,plan-and-execute,reflect:plan-and-execute

# Limita o número de iterações (padrão: 12) — vale por tentativa, inclusive
# dentro do ciclo de reflexão
npm run arena -- "<pedido>" --strategies react --max-iterations 3

# Benchmark: 3 cenários x react e plan-and-execute, acerto verificado no
# estado do store (não no texto da resposta) após cada execução
npm run bench

# Roda um único cenário (c1 = direto, c2 = estruturado, c3 = dinâmico)
npm run bench -- --scenario c2

# plan-and-execute sem o replanner: executa o plano inicial até o fim sem
# revisá-lo a cada passo, sem a chamada extra de modelo por revisão
npm run bench -- --no-replanner

# Portões de qualidade — offline, sem credenciais
npm run typecheck
npm test
```

```bash
# Sobe a API HTTP (src/index.ts) — padrão em http://localhost:3000, PORT
# configurável via .env ou variável de ambiente
npm run dev
```

O agente também sabe consultar a página pública de status de GitHub e Cloudflare
(`check_provider_status`, útil para "é o nosso ou é do provedor?") — sem chave, sem
variável de ambiente nova, nada a configurar para usar.

## API HTTP

`POST /chat` — envia um pedido em linguagem natural e recebe a mesma
execução que a arena produz, por HTTP.

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "quais alertas estão abertos?"}'
```

Corpo completo: `{ answer, trace, metrics, stoppedReason }`. Pra ler só a
resposta final, sem o rastro nem as métricas — o `jq -r` já converte as
quebras de linha em linhas de verdade, então a resposta sai formatada como o
modelo escreveu:

```bash
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "quais incidentes estão abertos?"}' \
  | jq -r '.answer'
```

Corpo aceito (validado com zod):

| Campo | Tipo | Obrigatório | Padrão |
|---|---|---|---|
| `message` | `string` | sim | — |
| `strategy` | `"react"` \| `"plan-and-execute"` | não | `"react"` |
| `reflect` | `boolean` | não | `false` |

`reflect: true` aplica a camada de reflexão sobre a estratégia escolhida —
equivalente a `reflect:react`/`reflect:plan-and-execute` na arena, mas como
modificador, não como prefixo de nome.

Resposta de sucesso (200): `{ answer, trace, metrics, stoppedReason }` — o
mesmo `StrategyResult` que a arena imprime, sem transformação.

| Status | `error.code` | Quando |
|---|---|---|
| 400 | `invalid_body` | corpo malformado — `error.details` lista os campos e o motivo |
| 422 | `unknown_strategy` | `strategy` não é um nome válido — `error.details.validStrategies` lista os aceitos |
| 504 | `timeout` | a execução passou de 180s |
| 500 | `internal` | falha inesperada; nunca vaza detalhe interno |

O estado operacional (serviços, alertas, incidentes, runbooks) é **compartilhado
por todas as requisições** do mesmo processo e **persiste em SQLite**
(`OPSPILOT_DB`, padrão `./data/opspilot.db`) — um incidente aberto num pedido
continua lá mesmo depois de reiniciar o servidor. A arena e o benchmark
continuam usando um estado em memória, semeado do zero a cada execução, para
que comparações entre estratégias sempre partam do mesmo ponto.

Detalhes completos (contratos, decisões técnicas, roteiro de validação) em
[specs/003-chat-http-api/](specs/003-chat-http-api/) (API HTTP) e
[specs/004-sqlite-persistence/](specs/004-sqlite-persistence/) (persistência).

## Estrutura

```text
src/
├── domain/    # esquemas zod e erros de domínio (puro)
├── store/     # transições de estado puras + repositórios in-memory e SQLite
│              # (sqlite-ops-store.ts, sqlite-schema.ts, db.ts)
├── trace/     # tipos e formatação do rastro de raciocínio (puro)
├── agents/    # fábrica do modelo, as 6 ferramentas (list_alerts, list_incidents,
│              # consultar_runbook, open_incident, resolve_incident,
│              # check_provider_status), estratégias ReAct e Plan-and-Execute,
│              # crítico, camada de reflexão (withReflection) e o registry (index.ts)
├── http/      # POST /chat: createApp (server.ts), handler e schema (chat.ts),
│              # corpo de erro consistente (errors.ts)
├── scripts/   # comando de seed (grava no banco SQLite)
├── bench/     # cenários e verificação de acerto do benchmark (puro)
├── arena.ts   # CLI de comparação de estratégias (estado em memória)
├── bench.ts   # CLI de benchmark: 3 cenários x 2 estratégias, acerto por estado
└── index.ts   # bootstrap: abre/semeia o banco SQLite, valida PORT e sobe a API HTTP
```

A documentação completa das features — spec, plano, decisões técnicas e
roteiro de validação — está em
[specs/001-reasoning-core/](specs/001-reasoning-core/) (núcleo de raciocínio),
[specs/002-reflection-layer/](specs/002-reflection-layer/) (camada de
reflexão), [specs/003-chat-http-api/](specs/003-chat-http-api/) (API HTTP) e
[specs/004-sqlite-persistence/](specs/004-sqlite-persistence/) (persistência
em SQLite).

## Nota sobre modelos gratuitos do OpenRouter

Aliases como `openrouter/free` têm cota diária agressiva
(`429 free-models-per-day`) e podem responder devagar sob carga. Se a arena
travar ou falhar com esse erro, não é um bug do projeto — troque de modelo no
`.env` ou aguarde a cota resetar.
