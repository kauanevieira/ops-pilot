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

## Comandos

```bash
# Popula o estado in-memory a partir de src/store/seed.json
# (5 serviços, 6 alertas: 3 firing, 3 resolved). Não precisa de credenciais.
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

> `npm run dev` ainda não faz nada útil: `src/index.ts` está vazio porque a
> API Express ficou fora do escopo da feature atual. Para ver o agente
> funcionando, use `npm run arena`.

## Estrutura

```text
src/
├── domain/    # esquemas zod e erros de domínio (puro)
├── store/     # transições de estado puras + repositório in-memory
├── trace/     # tipos e formatação do rastro de raciocínio (puro)
├── agents/    # fábrica do modelo, ferramentas, estratégias ReAct e Plan-and-Execute,
│              # crítico e camada de reflexão (withReflection)
├── scripts/   # comando de seed
├── bench/     # cenários e verificação de acerto do benchmark (puro)
├── arena.ts   # CLI de comparação de estratégias
└── bench.ts   # CLI de benchmark: 3 cenários x 2 estratégias, acerto por estado
```

A documentação completa das features — spec, plano, decisões técnicas e
roteiro de validação — está em
[specs/001-reasoning-core/](specs/001-reasoning-core/) (núcleo de raciocínio)
e [specs/002-reflection-layer/](specs/002-reflection-layer/) (camada de
reflexão).

## Nota sobre modelos gratuitos do OpenRouter

Aliases como `openrouter/free` têm cota diária agressiva
(`429 free-models-per-day`) e podem responder devagar sob carga. Se a arena
travar ou falhar com esse erro, não é um bug do projeto — troque de modelo no
`.env` ou aguarde a cota resetar.
