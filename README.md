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

# Baixa o modelo de embeddings da memória semântica para data/models/ (requer
# rede, roda uma vez). Sem isso, o teste de recall com o modelo real aparece
# como "skipped" em vez de "pass" — e o primeiro pedido com userId é que paga
# o download.
npm run memory:model

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
| `conversationId` | `string` | não | — (cria conversa nova) |
| `userId` | `string` | não | — (sem memória) |

`reflect: true` aplica a camada de reflexão sobre a estratégia escolhida —
equivalente a `reflect:react`/`reflect:plan-and-execute` na arena, mas como
modificador, não como prefixo de nome.

`conversationId` continua uma conversa: as até 12 mensagens mais recentes
daquela conversa (mensagem de quem pediu + resposta final, alternadas) são
entregues ao agente antes da mensagem nova. Omitido, uma conversa nova é
criada — mas só se o pedido concluir com sucesso.

`userId` liga a memória semântica: com ele, os até 3 fatos mais relevantes
guardados por aquele usuário (por sentido, não por palavra) entram no que o
agente recebe, e o agente ganha as ferramentas `remember_fact` (guardar um
fato — "lembra que...") e `forget_fact` (esquecer um fato pelo id, como
aparece entre colchetes nos fatos entregues). Memória é por usuário, não por
conversa: sobrevive entre conversas diferentes. Sem `userId`, nada disso
acontece, e o comportamento é idêntico ao de antes desta capacidade existir.

```bash
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"userId": "kauane", "message": "lembra que eu sou responsável pelo checkout"}' | jq -r '.answer'

# em outra conversa, sem repetir palavras do fato guardado:
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"userId": "kauane", "message": "quais serviços são meus?"}' \
  | jq '{answer, recalled: .metrics.recalledMemories}'
```

```bash
# primeiro turno — sem conversationId
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "qual serviço tem alerta crítico disparando?"}' | tee /tmp/t1.json | jq '{conversationId, answer}'

# segundo turno — continuação, usando o id devolvido
ID=$(jq -r .conversationId /tmp/t1.json)
curl -s -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d "{\"message\": \"e qual é o runbook dele?\", \"conversationId\": \"$ID\"}" | jq '{conversationId, answer}'
```

Resposta de sucesso (200): `{ answer, trace, metrics, stoppedReason, conversationId }`
— o `StrategyResult` que a arena imprime, sem transformação, mais o id da
conversa (o informado, ou o da conversa recém-criada) e, em `metrics`, o
campo `historyMessages` (`0..12` — mensagens de histórico entregues ao
agente naquele pedido). Com `userId`, `metrics` também traz
`recalledMemories` (`0..3`); sem `userId`, o campo não aparece.

| Status | `error.code` | Quando |
|---|---|---|
| 400 | `invalid_body` | corpo malformado — `error.details` lista os campos e o motivo |
| 422 | `unknown_strategy` | `strategy` não é um nome válido — `error.details.validStrategies` lista os aceitos |
| 404 | `conversation_not_found` | `conversationId` bem formado, mas nenhuma conversa corresponde a ele |
| 504 | `timeout` | a execução passou de 180s |
| 500 | `internal` | falha inesperada; nunca vaza detalhe interno |

Um pedido que não conclui com sucesso (400/404/422/504/500) não grava nada
na conversa — nem a mensagem, nem uma conversa nova. Uma falha ao recuperar
memória (ex.: modelo indisponível) não derruba o pedido: ele segue sem
fatos recuperados, com `recalledMemories: 0`, e o erro é só registrado no
servidor.

O estado operacional (serviços, alertas, incidentes, runbooks) é **compartilhado
por todas as requisições** do mesmo processo e **persiste em SQLite**
(`OPSPILOT_DB`, padrão `./data/opspilot.db`) — um incidente aberto num pedido
continua lá mesmo depois de reiniciar o servidor. As conversas (`conversationId`
e suas mensagens) e as memórias semânticas (por `userId`) persistem no mesmo
arquivo. A arena e o benchmark continuam usando um estado em memória, semeado
do zero a cada execução, para que comparações entre estratégias sempre partam
do mesmo ponto — nenhum dos dois usa conversa ou memória.

### Memória semântica: custo em disco

A busca por sentido (recuperar um fato mesmo sem nenhuma palavra em comum
com o pedido) roda **localmente**, via
[`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers)
— sem chamada de rede a cada uso, sem chave de API para embeddings. Isso tem
um custo conhecido:

- **+744 MB em `node_modules`** (a maior parte é o `onnxruntime-node`, que
  traz binários para várias plataformas).
- **~113 MB de modelo**, baixados uma vez para `data/models/` (já
  ignorado pelo git) na primeira vez que a memória é usada — ou
  antecipadamente com `npm run memory:model`.

Sem `userId` em nenhum pedido, nada disso é sequer carregado.

Detalhes completos (contratos, decisões técnicas, roteiro de validação) em
[specs/003-chat-http-api/](specs/003-chat-http-api/) (API HTTP),
[specs/004-sqlite-persistence/](specs/004-sqlite-persistence/) (persistência),
[specs/007-persistent-conversation/](specs/007-persistent-conversation/) (conversa
persistente) e [specs/008-semantic-memory/](specs/008-semantic-memory/) (memória
semântica).

## Servidor MCP

O OpsPilot também fala [MCP](https://modelcontextprotocol.io) por stdio, como
servidor `opspilot`, expondo `list_alerts`, `list_incidents`, `open_incident`
e `resolve_incident` a qualquer cliente compatível (Claude Code, Claude
Desktop, etc.) — as mesmas ferramentas, com a mesma descrição e o mesmo
esquema que o agente interno usa, e sobre o mesmo banco SQLite da API HTTP
(`OPSPILOT_DB`). `consultar_runbook` e `check_provider_status` não são
expostas por esse canal.

```bash
npm run mcp
```

> ⚠️ **Ao registrar num cliente, use sempre `npm run --silent mcp`** (ou
> `npm --prefix <caminho-do-repo> run --silent mcp` se o cliente roda de
> outro diretório). Sem `--silent`, o próprio `npm run` escreve o cabeçalho
> do script no stdout antes do servidor subir — e no transporte stdio o
> stdout **é** o canal do protocolo, então esse texto corrompe a sessão,
> mesmo sem nenhum `console.log` no código do servidor.

Registro num cliente MCP (ex.: `claude mcp add`):

```bash
claude mcp add opspilot -- npm --prefix "$PWD" run --silent mcp
```

Ou direto no arquivo de configuração do cliente:

```json
{
  "mcpServers": {
    "opspilot": {
      "command": "npm",
      "args": ["--prefix", "/caminho/para/ops-pilot", "run", "--silent", "mcp"]
    }
  }
}
```

Nenhuma credencial é necessária — o servidor MCP não chama modelo nenhum.
Detalhes completos (contrato observável, decisões técnicas, roteiro de
validação) em [specs/006-mcp-server/](specs/006-mcp-server/).

## Estrutura

```text
src/
├── domain/    # esquemas zod e erros de domínio (puro)
├── store/     # transições de estado puras + repositórios in-memory e SQLite
│              # (sqlite-ops-store.ts, sqlite-schema.ts, db.ts) e o
│              # ConversationStore de conversas (in-memory e SQLite)
├── trace/     # tipos e formatação do rastro de raciocínio (puro)
├── agents/    # tool-definitions.ts: fonte única das 6 ferramentas (list_alerts,
│              # list_incidents, consultar_runbook, open_incident, resolve_incident,
│              # check_provider_status) — nome, descrição, esquema e execução;
│              # tools.ts adapta para LangChain; fábrica do modelo, estratégias
│              # ReAct e Plan-and-Execute, crítico, reflexão (withReflection),
│              # histórico de conversa (withConversationHistory) e o registry
│              # (index.ts)
├── mcp/       # servidor MCP opspilot por stdio: ops-mcp-server.ts (composição
│              # pura sobre tool-definitions.ts) e server.ts (entrada: env, banco,
│              # transporte, stderr)
├── memory/    # memória semântica por usuário: embeddings.ts (singleton
│              # preguiçoso sobre @huggingface/transformers), memory-store.ts
│              # (MemoryStore, SqliteMemoryStore: remember/recall/forget),
│              # memory-tools.ts (remember_fact/forget_fact), with-memory.ts
│              # (decorador que entrega os fatos ao agente)
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
reflexão), [specs/003-chat-http-api/](specs/003-chat-http-api/) (API HTTP),
[specs/004-sqlite-persistence/](specs/004-sqlite-persistence/) (persistência
em SQLite), [specs/005-provider-status-tool/](specs/005-provider-status-tool/)
(status de provedores externos),
[specs/006-mcp-server/](specs/006-mcp-server/) (servidor MCP),
[specs/007-persistent-conversation/](specs/007-persistent-conversation/) (conversa
persistente) e [specs/008-semantic-memory/](specs/008-semantic-memory/) (memória
semântica).

## Nota sobre modelos gratuitos do OpenRouter

Aliases como `openrouter/free` têm cota diária agressiva
(`429 free-models-per-day`) e podem responder devagar sob carga. Se a arena
travar ou falhar com esse erro, não é um bug do projeto — troque de modelo no
`.env` ou aguarde a cota resetar.
