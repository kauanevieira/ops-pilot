# ops-pilot

OpsPilot é um copiloto de plantão que gerencia alertas e incidentes de
produção. O núcleo é um agente LangChain/LangGraph rodando sobre o OpenRouter,
com duas estratégias de raciocínio comparáveis lado a lado: **ReAct** e
**Plan-and-Execute**.

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

# Limita o número de iterações (padrão: 12)
npm run arena -- "<pedido>" --strategies react --max-iterations 3

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
├── agents/    # fábrica do modelo, ferramentas, estratégias ReAct e Plan-and-Execute
├── scripts/   # comando de seed
└── arena.ts   # CLI de comparação de estratégias
```

A documentação completa da feature — spec, plano, decisões técnicas e roteiro
de validação — está em
[specs/001-reasoning-core/](specs/001-reasoning-core/).

## Nota sobre modelos gratuitos do OpenRouter

Aliases como `openrouter/free` têm cota diária agressiva
(`429 free-models-per-day`) e podem responder devagar sob carga. Se a arena
travar ou falhar com esse erro, não é um bug do projeto — troque de modelo no
`.env` ou aguarde a cota resetar.
