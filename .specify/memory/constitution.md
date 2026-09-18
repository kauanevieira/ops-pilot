# OpsPilot Constitution

## Core Principles

### I. Domínio Puro, Bordas Finas

Regras de negócio MUST viver em funções puras `(estado, comando) => novoEstado`,
sem I/O, sem mutação da entrada, sem leitura de relógio e sem geração de ids.
Relógio, ids e persistência MUST ficar nas bordas (repositórios, CLIs, handlers
HTTP), que recebem esses valores por parâmetro ou os produzem num único ponto
identificável. Entidades de domínio MUST ser definidas uma única vez como
esquemas zod em `src/domain/` e derivadas por inferência de tipo — nenhum tipo
paralelo escrito à mão.

**Rationale**: é o que torna o comportamento do agente testável sem rede, sem
banco e sem relógio falso, e o que permite trocar a implementação de
persistência sem tocar em regra de negócio.

### II. Persistência Local em SQLite (NON-NEGOTIABLE)

A persistência do OpsPilot MUST ser um arquivo SQLite local acessado pelo módulo
nativo `node:sqlite`. O projeto MUST NOT depender de um servidor de banco de
dados (MySQL, Postgres, ou equivalente), de ORM, ou de qualquer dependência de
runtime para acesso a dados. Regras adicionais:

- O caminho do arquivo MUST ser configurável por variável de ambiente, com
  default relativo ao projeto; testes MUST usar bancos `":memory:"`.
- O DDL MUST ser idempotente (`CREATE TABLE IF NOT EXISTS`) e aplicado na
  abertura da conexão: nenhum passo manual de migração para rodar o projeto.
- Todo campo de domínio de conjunto fechado MUST ter `CHECK` na tabela, de modo
  que o banco rejeite o valor inválido mesmo que a validação de aplicação falhe.
- Toda consulta MUST usar prepared statements com parâmetros ligados. SQL
  construído por concatenação ou interpolação de valores é proibido.
- O seed MUST ser idempotente: rodá-lo N vezes deixa o banco no mesmo estado.
- Arquivos de banco MUST ser ignorados pelo versionamento.

**Rationale**: o OpsPilot é uma ferramenta de estudo e demonstração que precisa
rodar com `npm install && npm run dev`, offline e sem infraestrutura. SQLite
embutido no Node dá durabilidade real com custo operacional zero, e as regras
acima garantem que o banco seja um detalhe substituível, não uma dependência de
ambiente.

### III. Contrato Antes de Código

Toda feature MUST nascer de um diretório em `specs/` com spec, plano e contratos
antes da implementação. Requisitos funcionais MUST ser numerados e verificáveis,
e o código MUST referenciá-los onde a rastreabilidade não for óbvia. Mudança de
comportamento observável (ferramenta, endpoint, CLI, formato de rastro) MUST
atualizar o contrato correspondente no mesmo conjunto de mudanças.

**Rationale**: o valor do repositório está tanto no raciocínio documentado
quanto no código; um contrato desatualizado é pior que contrato nenhum.

### IV. Ferramentas Descritas pelas 6 Regras (NON-NEGOTIABLE)

A descrição de uma ferramenta exposta ao modelo é interface, não comentário.
Toda ferramenta MUST satisfazer as 6 regras:

1. **O que faz** — primeira frase no imperativo, declarando a ação única da
   ferramenta.
2. **Quando usar** — o gatilho concreto, na linguagem de quem está de plantão,
   não na linguagem do código.
3. **Quando NÃO usar** — a fronteira contra a ferramenta vizinha mais fácil de
   confundir, sempre que existir uma.
4. **O que devolve** — a forma do retorno e o que o modelo consegue fazer com
   ele, incluindo o caso vazio.
5. **Todo campo descrito** — cada campo do esquema MUST ter `.describe()`, com o
   significado do campo e seu default quando houver.
6. **Conjuntos fechados são enums** — valores de conjunto fechado MUST ser
   `enum` no esquema, com os valores aceitos explicitados na descrição; nunca
   `string` livre.

**Rationale**: a escolha de ferramenta é feita pelo modelo a partir da
descrição. Descrição ambígua não vira bug de compilação — vira uma execução
errada, cara e difícil de diagnosticar.

### V. Portões Offline e Determinísticos

`npm run typecheck` e `npm test` MUST passar sem credenciais, sem rede e sem
servidor externo. Testes MUST NOT chamar o provedor de modelo; estratégias e
modelos são substituídos por dublês determinísticos. Verificação de acerto em
benchmark e testes de ferramenta MUST inspecionar o estado resultante, não o
texto produzido pelo modelo. Cada execução de teste MUST partir de um estado
próprio e isolado, sem depender da ordem dos testes.

**Rationale**: um projeto sobre agentes não-determinísticos só é mantível se a
suíte que o protege for determinística.

## Restrições Técnicas

- **Runtime**: Node 22 LTS, ESM (`"type": "module"`), TypeScript executado via
  `tsx`. Preferir módulos nativos do Node (`node:sqlite`, `node:test`,
  `--env-file-if-exists`) a dependências equivalentes de terceiros.
- **Validação**: zod na borda de toda entrada externa — corpo HTTP, argumentos
  de ferramenta, dados lidos do banco ou de arquivo.
- **Credenciais**: chegam ao processo por variável de ambiente. `.env` MUST NOT
  ser commitado nem lido pelo agente de codificação; `.env.example` documenta as
  chaves.
- **Estado de teste e de benchmark**: a implementação in-memory do store
  permanece suportada como dublê de teste e como base reprodutível do
  benchmark; ela MUST NOT ser a persistência de produção.
- **Erros de domínio** são classes em `src/domain/errors.ts`, traduzidas na
  borda da ferramenta em observação legível ao modelo sem abortar a execução.
  Falhas técnicas propagam e encerram a execução.

## Fluxo de Desenvolvimento

1. `/speckit.specify` → spec com histórias priorizadas e requisitos numerados.
2. `/speckit.plan` → plano, pesquisa, modelo de dados e contratos.
3. `/speckit.tasks` → tarefas executáveis, agrupadas por história.
4. Implementação, uma história por vez, cada uma entregando valor sozinha.
5. Portões antes de integrar: `npm run typecheck`, `npm test`, e o roteiro de
   validação (`quickstart.md`) da feature.
6. README e contratos atualizados no mesmo conjunto de mudanças que altera o
   comportamento observável.

Uma feature MUST ser integrável quando suas histórias P1 estiverem completas;
histórias de prioridade menor não bloqueiam a entrega.

## Governança

Esta constituição prevalece sobre qualquer outra prática do repositório. Em caso
de conflito entre um documento de feature e esta constituição, a constituição
vence e o documento de feature MUST ser corrigido.

**Emendas**: MUST ser feitas neste arquivo, com Sync Impact Report descrevendo a
mudança, e MUST declarar o impacto sobre specs existentes.

**Versionamento** (semver):
- **MAJOR**: remoção ou redefinição incompatível de princípio ou regra de
  governança.
- **MINOR**: novo princípio ou seção, ou expansão material de orientação.
- **PATCH**: esclarecimento, redação, correção sem mudança de semântica.

**Conformidade**: toda revisão de mudança MUST verificar aderência aos
princípios. Complexidade adicional — nova dependência de runtime, nova camada,
novo serviço externo — MUST ser justificada explicitamente no plano da feature,
com a alternativa mais simples descartada e o motivo. Não havendo justificativa
registrada, a alternativa mais simples vence.

**Version**: 1.0.0 | **Ratified**: 2026-09-17 | **Last Amended**: 2026-09-18
