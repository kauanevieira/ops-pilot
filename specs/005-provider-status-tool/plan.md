# Implementation Plan: Status de provedores externos

**Branch**: `005-provider-status-tool` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-provider-status-tool/spec.md`

## Summary

Dar ao OpsPilot a primeira ferramenta que olha para **fora**: `check_provider_status`
consulta a página pública de status de um provedor (GitHub, Cloudflare) pelo padrão
statuspage.io, sem chave, e devolve uma linha dizendo se ele está operando normalmente — a
resposta para a primeira pergunta de todo plantão, "é o nosso ou é do provedor?".

A abordagem técnica, definida na Fase 0: **a lógica de resiliência vive em
`src/agents/provider-status.ts`, e `tools.ts` só a expõe** (R-008). Timeout por tentativa,
retentativa única, classificação de erro e validação zod somam mais lógica que as cinco
ferramentas existentes juntas; inline, transformariam o catálogo de ferramentas em módulo de
infraestrutura. O `fetch` entra por um parâmetro opcional de `createOpsTools` com default
`globalThis.fetch` (R-007) — os testes injetam o dublê onde já chamam a fábrica, e a cadeia
`BASE_FACTORIES → createStrategy → resolveStrategy`, contrato público da 003, não é tocada.

Quatro achados da Fase 0 alteram a leitura ingênua do pedido e estão no caminho crítico:

1. **Um `AbortSignal` não sobrevive à segunda tentativa** (R-003, verificado). Criado uma vez
   fora do laço — a forma natural de escrever —, a segunda tentativa falha instantaneamente
   com o erro da primeira. **Todos os testes de retry passam**, porque o número de chamadas ao
   dublê é 2 como esperado. O bug só aparece em produção, no momento em que a retentativa
   importava. O sinal é criado **dentro** de cada tentativa, e o dublê afirma que nenhum sinal
   recebido chegou já abortado.
2. **`res.json()` falha por duas naturezas opostas** (R-004, verificado): `TimeoutError`
   (retenta) e `SyntaxError` (não retenta). A classificação é por `error.name`, nunca por
   `instanceof` nem pela posição no código.
3. **Um `provider` inválido nunca chega ao nosso código** (R-006, verificado). A validação de
   esquema do LangChain **lança** antes do corpo da ferramenta; quem converte isso em
   observação para o agente é o `ToolNode` do LangGraph, e a mensagem já lista
   `"github"|"cloudflare"`. O teste da FR-004 afirma **rejeição**, não retorno — escrito
   errado, o teste vermelho empurra para trocar o enum por `z.string()`, que é exatamente a
   violação do Princípio IV que o enum existe para impedir.
4. **O retorno em texto diverge do idioma JSON das outras cinco ferramentas** (R-010). É
   deliberado e pedido explicitamente, mas é divergência — registrada para confirmação.

## Technical Context

**Language/Version**: TypeScript 7.x em ESM (`"type": "module"`), `strict: true`, module
NodeNext. Runtime **Node 22.22.2**.

**Primary Dependencies**: **Nenhuma nova, e nenhuma mudança de configuração** (R-001,
verificado). `fetch`, `Response` e `AbortSignal.timeout` são globais do runtime e tipam sob
`"lib": ["ES2022"]` + `"types": ["node"]` — o `@types/node@26` os declara, e uma sonda com os
três passou `tsc --noEmit`. `zod@4.6.5` para a validação de fronteira do corpo recebido
(FR-021). `@langchain/core` apenas para o `tool()`, como nas cinco existentes.

**Storage**: nenhum. A feature não lê nem grava — `src/store/` e `src/domain/` ficam
intocados, e nada é cacheado (R-014).

**Testing**: `node:test` via `tsx`, arquivos `*.test.ts` ao lado do código. Um alvo novo,
`src/agents/provider-status.test.ts` (timeout, retry, classificação, validação — o grosso da
FR-036), e casos novos em `src/agents/tools.test.ts` (default aplicado, provedor rejeitado,
formato do retorno). **Zero rede** (FR-035): todo cenário usa dublê, inclusive os de falha.

**Target Platform**: Linux/macOS, via `npm run dev`. A rede só é usada em execução real; os
portões seguem offline.

**Project Type**: Single project. Nenhuma camada nova — uma ferramenta a mais no catálogo
existente e um módulo de apoio ao lado dele.

**Performance Goals**: nenhuma além do limite de tempo. O pior caso é ~10 s (duas tentativas
de 5 s), e a latência está dominada por chamadas de modelo de qualquer forma.

**Constraints**:
- O sinal de timeout é criado **por tentativa** (R-003). Compartilhá-lo invalida a
  retentativa sem quebrar nenhum teste.
- No máximo **2** tentativas, sempre (SC-005). Laço explícito, não função recursiva genérica
  de retry — que é onde a terceira tentativa entra sem ninguém notar.
- A classificação de erro é por `error.name` (R-002, R-004).
- Nenhuma exceção escapa do **corpo** da ferramenta (FR-015). A validação de esquema é do
  framework, acontece antes, e tem rede de segurança própria (R-006).
- `provider` é `z.enum`, nunca `z.string()` (Princípio IV regra 6; R-006).
- Nenhuma URL montada com valor vindo do modelo (R-012) — o equivalente em HTTP do SQL
  concatenado que o Princípio II proíbe.
- Nenhuma variável de ambiente nova (FR-006, SC-010).
- A assinatura `(store: OpsRepository) => ReasoningStrategy` **não** muda (R-007).
- ⚠️ **Duas suposições da spec seguem abertas**: o conjunto fechado de indicadores (R-009) e
  o retorno em texto em vez de JSON (R-010). Nenhuma bloqueia a implementação — cada uma é
  poucas linhas se mudar —, mas confirmá-las antes é mais barato que depois.

**Scale/Scope**: 1 arquivo de código novo + 1 de teste novo; 3 arquivos existentes alterados
(`tools.ts`, `tools.test.ts`, `README.md`); nenhuma dependência, nenhuma configuração,
nenhuma migração.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Veredito |
|---|---|---|
| **I. Domínio Puro, Bordas Finas** | A feature é inteiramente borda, e a separação é explícita: `checkProviderStatus` concentra o I/O num único ponto identificável e recebe o `fetch` por parâmetro (R-007, R-008), enquanto a decisão de *quando* retentar é determinística e testável sozinha. `ProviderName` é derivado do enum zod por inferência, sem tipo paralelo escrito à mão (R-012). Nenhuma regra de negócio é adicionada ao domínio — corretamente: o estado de um provedor externo não é entidade do OpsPilot. | ✅ Passa |
| **II. Persistência Local em SQLite** | Não se aplica: a feature não persiste nada (R-014). O espírito da regra "nada de SQL concatenado" **se aplica por analogia** e foi seguido: a URL é constante e nenhum valor vindo do modelo participa de sua construção (R-012, R-013). | ✅ N/A, espírito preservado |
| **III. Contrato Antes de Código** | Spec, plano, pesquisa, modelo de dados, dois contratos e quickstart escritos antes da implementação. O contrato de ferramentas da 004 (`004-sqlite-persistence/contracts/ops-tools.md`) segue válido; `contracts/check-provider-status.md` **acrescenta** a sexta ferramenta sem substituí-lo, e declara a única alteração que ele sofre (a fronteira recíproca em `list_alerts`). `README.md` diz hoje "as 5 ferramentas" (linha 154) e passa a mentir — corrigido na mesma leva. | ✅ Passa |
| **IV. Ferramentas Descritas pelas 6 Regras** | A ferramenta nasce conforme, auditada regra a regra em [`contracts/check-provider-status.md`](./contracts/check-provider-status.md). A regra 3 é tratada como **recíproca**: `list_alerts` também passa a declarar a fronteira contra a ferramenta nova (R-015) — obrigação constitucional, não polimento. O enum é defendido explicitamente contra a pressão que o teste da FR-004 exerce sobre ele (R-006). | ✅ Passa |
| **V. Portões Offline e Determinísticos** | É o princípio sob maior tensão: a feature introduz a **primeira dependência de rede do projeto**. Resolvida por injeção, não por exceção ao princípio — nenhum teste toca a rede, inclusive os de falha (FR-035, R-011), e nenhum espera 5 s reais: o dublê rejeita na hora com um `DOMException` de `name === "TimeoutError"`, idêntico ao que o `fetch` produz (verificado). Cada teste constrói sua própria fábrica, sem `globalThis` substituído e sem estado partilhado entre casos. | ✅ Passa |

**Sobre a tensão com o Princípio V**, explicitamente: os portões exigem `npm test` sem rede,
e a feature respeita isso porque toda a cobertura usa dublê. O preço, aceito e registrado em
[`contracts/statuspage-api.md`](./contracts/statuspage-api.md), é que **a suíte não detecta
uma mudança de contrato do provedor**. A mitigação não é um teste online nos portões — seria
trocar um risco pequeno por um portão intermitente —, é a validação zod garantir que o
sintoma seja explícito (`invalid-response` em toda consulta) em vez de um estado inventado,
mais uma validação online opcional no quickstart, fora dos portões.

**Resultado do portão**: nenhuma violação. A tabela de Complexity Tracking está vazia.

**Re-avaliação pós-Fase 1**: os artefatos de desenho não introduziram violações, e dois
pontos ficaram *mais* aderentes que o esboço inicial:

- **`fetch` injetado em `createOpsTools`, não na cadeia de estratégias** (R-007). Enfiar um
  `fetcher` por `BASE_FACTORIES → createStrategy → resolveStrategy` alteraria o contrato
  público da 003 para servir uma ferramenta que nenhuma estratégia precisa configurar. Os
  testes já chamam `createOpsTools` diretamente — injetar onde o teste já está é o que torna
  a mudança local.
- **Lógica em módulo próprio, e não inline em `tools.ts`** (R-008). As cinco ferramentas
  existentes têm corpo de 3 a 12 linhas; manter essa proporção é o que impede o catálogo de
  ferramentas de virar infraestrutura — e é o que permite testar a política de retentativa
  sem construir uma ferramenta LangChain e sem contornar a validação de esquema (R-006).

## Project Structure

### Documentation (this feature)

```text
specs/005-provider-status-tool/
├── plan.md                          # Este arquivo
├── spec.md                          # Especificação da feature
├── research.md                      # Fase 0 — 15 decisões, 8 verificadas em código
├── data-model.md                    # Fase 1 — tipos em trânsito (nenhuma entidade nova)
├── contracts/                       # Fase 1
│   ├── check-provider-status.md     # A ferramenta + auditoria pelas 6 regras
│   └── statuspage-api.md            # A dependência externa: o que assumimos e o que não
├── quickstart.md                    # Fase 1 — 6 validações (4 offline, 1 com chave, 1 com rede)
└── tasks.md                         # Fase 2 — criado por /speckit.tasks, NÃO por este comando
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── provider-status.ts        # NOVO — providerSchema, tabela de URLs, esquema da
│   │                             #   resposta, política de retentativa, formatação
│   │                             #   da linha. Único ponto de I/O (R-008)
│   ├── provider-status.test.ts   # NOVO — timeout, retry, classificação, validação,
│   │                             #   contagem de tentativas, sinal por tentativa (R-003)
│   ├── tools.ts                  # ALTERADO — createOpsTools ganha `deps` opcional (R-007);
│   │                             #   + check_provider_status; fronteira recíproca em
│   │                             #   list_alerts (R-015)
│   ├── tools.test.ts             # ALTERADO — + default aplicado, provedor rejeitado,
│   │                             #   formato do retorno
│   ├── react.ts                  # inalterado — segue chamando createOpsTools(store)
│   └── plan-and-execute.ts       # inalterado — idem
├── store/                        # INTOCADO — a feature não persiste nada (R-014)
├── domain/                       # INTOCADO — status de provedor não é entidade nossa
└── http/                         # INTOCADO — o contrato da 003 não muda (R-007)
```

Fora de `src/`:

```text
README.md            # ALTERADO — "as 5 ferramentas" (linha 154) passa a ser falso
package.json         # inalterado — nenhuma dependência nova (R-001)
.env.example         # inalterado — nenhuma configuração nova (FR-006)
tsconfig.json        # inalterado — os globais já tipam (R-001, verificado)
```

**Structure Decision**: projeto único, testes ao lado do código, como nas features
anteriores. A fronteira entre os dois arquivos de `agents/` é a mesma que a 004 usou em
`store/`: `provider-status.ts` é *mecanismo* (falar com o mundo lá fora e decidir o que fazer
quando ele não coopera), `tools.ts` é *catálogo* (o que o modelo vê e como escolhe). Deixar o
mecanismo no catálogo é o que faria `tools.ts` deixar de ser legível como a lista de coisas
que o agente sabe fazer.

Quatro pontos de atenção na implementação:

1. **O sinal criado fora do laço é o bug que a suíte não pega** (R-003). É a forma natural de
   escrever, e a retentativa vira decorativa com todos os testes verdes. O teste que protege
   não é o de contagem de tentativas — esse passa dos dois jeitos — é o dublê afirmar que
   **cada** sinal recebido chegou não abortado.
2. **Ordem de implementação**: `provider-status.ts` e seus testes **antes** de tocar em
   `tools.ts`. A política de retentativa é o grosso da feature e é testável sem LangChain;
   fazê-la primeiro evita depurar classificação de erro através da validação de esquema de
   uma ferramenta (R-006).
3. **O teste do provedor inválido é `assert.rejects`, não `assert.match`** (R-006). Escrito
   como retorno, ele fica vermelho, e a correção intuitiva é trocar o enum por `z.string()`
   com validação manual dentro — que devolveria a string bonita e violaria o Princípio IV,
   regra 6. Vale um comentário no teste dizendo isso.
4. **A fronteira recíproca em `list_alerts` é fácil de esquecer** (R-015), porque a feature
   "não mexe nas outras ferramentas". Mexe em uma frase de uma, e é obrigação da regra 3.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação a justificar. A feature não introduz dependência, camada, serviço
gerenciado, configuração nem abstração: um módulo, uma ferramenta, um parâmetro opcional com
default.

O único item que mereceria justificativa sob a regra de conformidade — "novo serviço externo
MUST ser justificado explicitamente, com a alternativa mais simples descartada e o motivo" —
é a dependência de rede em si. A alternativa mais simples seria não ter a feature; ela é
descartada porque a pergunta "é o nosso ou é do provedor?" é a primeira de todo plantão e
hoje não tem resposta dentro da ferramenta. A dependência é de **runtime**, não dos portões
(Princípio V), e é somente leitura, sem credencial, sem estado e sem envio de dado nosso.

---

## Próxima fase

`/speckit.tasks` para gerar `tasks.md`. Este comando encerra após a Fase 1.

**Antes de implementar**, confirmar as duas suposições abertas — ou aceitá-las como estão:

- **R-009**: indicador como conjunto fechado (`none|minor|major|critical`); um quinto valor
  futuro vira "não foi possível confirmar" em vez de ser repassado.
- **R-010**: retorno em texto de uma linha, divergindo do idioma JSON das outras cinco
  ferramentas. É o que o pedido descreve; a alternativa consistente é uma linha de código.
