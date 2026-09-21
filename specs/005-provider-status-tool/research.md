# Research: Status de provedores externos

**Feature**: `005-provider-status-tool` | **Fase**: 0 | **Data**: 2026-09-18

Todas as decisões abaixo marcadas **verificado** foram confirmadas executando código
neste repositório, na versão instalada das dependências (Node 22.22.2, `zod@4.6.5`,
`@langchain/core@1.2.11`, `@langchain/langgraph@1.4.15`). As sondas foram removidas
depois de colhidos os resultados.

---

## R-001 — `AbortSignal.timeout` e `fetch` tipam sem mudar `tsconfig.json` (verificado)

**Decisão**: usar `AbortSignal.timeout(5000)` e o `fetch` global, sem polyfill e sem
dependência nova.

**Verificação**: `tsconfig.json` declara `"lib": ["ES2022"]` — que não inclui DOM — o que
levanta a dúvida legítima de se `AbortSignal`, `fetch` e `Response` existem no tipo. Existem:
`"types": ["node"]` traz `@types/node@26`, que declara os três como globais. Um arquivo de
sonda com `AbortSignal.timeout`, `typeof fetch`, `Response` e `new Response(...)` passou
`tsc --noEmit` sem erro.

**Consequência**: nenhuma mudança em `tsconfig.json`, `package.json` ou dependências.
A feature não adiciona nada ao projeto além de arquivos-fonte.

---

## R-002 — A falha por espera esgotada é identificada por `error.name === "TimeoutError"` (verificado)

**Decisão**: classificar as falhas por `name`, nunca por `instanceof`.

**Verificação**: contra um servidor local que nunca responde, `fetch` com
`AbortSignal.timeout(150)` rejeita com um `DOMException` cujo `name` é `"TimeoutError"`.
Uma falha de conexão rejeita com um `TypeError` de mensagem `"fetch failed"`. Ou seja:

| Situação | Construtor | `name` |
|---|---|---|
| Espera esgotada | `DOMException` | `"TimeoutError"` |
| Falha de rede | `TypeError` | `"TypeError"` |
| Corpo não-JSON | `SyntaxError` | `"SyntaxError"` |

**Alternativas rejeitadas**: `instanceof DOMException` funciona, mas `DOMException` também
cobre um aborto manual (`AbortError`), que não é o mesmo caso; `instanceof TypeError` é
inútil como sinal de rede, porque uma URL malformada também produz `TypeError` — o que
seria um erro de programação sendo retentado como se fosse instabilidade do provedor. O
risco é contido porque as URLs são constantes do projeto (FR-005), mas a classificação
por `name` é a que não depende disso.

---

## R-003 — ⚠️ Um `AbortSignal` NÃO pode ser compartilhado entre as duas tentativas (verificado)

**Decisão**: `AbortSignal.timeout(5000)` é criado **dentro** de cada tentativa.

**Verificação**: um sinal criado uma vez, já disparado, foi passado a um `fetch` contra um
servidor local que responde imediatamente. A chamada falhou na hora com `TimeoutError`,
sem sequer sair do processo.

**Por que isso está no caminho crítico**: a forma natural de escrever o retry é criar o
sinal uma vez, fora do laço, e reusá-lo nas duas tentativas. Escrito assim, **a segunda
tentativa nunca acontece de verdade**: ela falha instantaneamente com o mesmo erro da
primeira, e todos os testes de retry passam — porque o número de chamadas ao `fetch`
injetado é 2, exatamente como esperado. O bug é invisível para o dublê e só aparece em
produção, no único momento em que a retentativa importava.

**Consequência**: o limite de 5 s é **por tentativa**, e o pior caso total é ~10 s
(FR-013, SC-003). O teste da FR-037 conta as tentativas; o que protege contra este bug
especificamente é o dublê verificar que **cada** chamada recebeu um sinal ainda não
abortado.

---

## R-004 — O limite de espera cobre a leitura do corpo, não só os cabeçalhos (verificado)

**Decisão**: `response.json()` fica dentro do mesmo bloco protegido pelo mesmo sinal.

**Verificação**: contra um servidor que envia `200`, começa o corpo e trava, o `fetch`
resolveu com os cabeçalhos e foi o `await response.json()` que rejeitou — com
`TimeoutError`, do mesmo sinal.

**Consequência, e é a menos óbvia da feature**: `res.json()` pode rejeitar por **dois**
motivos de natureza oposta — `TimeoutError` (transitório, retenta) e `SyntaxError` (corpo
inválido, não retenta, FR-012). Um `try/catch` em volta do `json()` que assuma uma única
causa classifica errado metade dos casos. A classificação tem de ser por identidade do
erro (R-002), e não pela posição no código onde ele foi lançado.

---

## R-005 — A retentativa cobre rede e 5xx; 4xx e validação não retentam

**Decisão**: a política, derivada de FR-010/011/012:

| Resultado da tentativa | Retenta? | Motivo |
|---|---|---|
| `TimeoutError` | **sim** | instabilidade transitória |
| `TypeError` (rede) | **sim** | FR-010, literal no pedido |
| HTTP 5xx | **sim** | falha do lado do provedor |
| HTTP 4xx | não | repetir dá o mesmo resultado (FR-011) |
| Corpo fora do esquema / não-JSON | não | repetir dá o mesmo resultado (FR-012) |
| Provedor não suportado | não chega a haver tentativa | FR-004 |

**Sem espera entre tentativas** (assunção registrada na spec): com uma única retentativa,
um recuo progressivo só somaria latência ao pior caso, que já é ~10 s.

**Consequência**: no máximo 2 tentativas, sempre (SC-005). O laço é `for (let i = 0; i < 2; i++)`
com saída explícita nos casos não-retentáveis — não uma função recursiva genérica de retry,
que é onde a terceira tentativa costuma entrar sem ninguém notar.

---

## R-006 — ⚠️ Um valor inválido de `provider` é rejeitado ANTES do corpo da ferramenta (verificado)

**Decisão**: manter o `z.enum` (Princípio IV, regra 6) e **corrigir a leitura da FR-004**.

**Verificação**: `tool.invoke({ provider: "aws" })` **lança**:

```
Error: Received tool input did not match expected schema
✖ Invalid option: expected one of "github"|"cloudflare" → at provider
```

O corpo da ferramenta nunca executa. Verificado também que `tool.invoke({})` aplica o
`.default("github")` corretamente (FR-003 ✅) e que um `throw` dentro do corpo **escapa** de
`invoke()` — é exatamente por isso que as cinco ferramentas existentes já envolvem tudo em
`try/catch`.

**Correção à spec**: a FR-004 diz que o provedor inválido "MUST ser rejeitado antes de
qualquer chamada externa, com observação legível que informe os provedores disponíveis".
As duas metades continuam verdadeiras, mas **não no nível que a spec sugere**:

- "antes de qualquer chamada externa" ✅ — é rejeitado antes até do corpo da ferramenta.
- "observação legível com os provedores disponíveis" ✅ — mas quem a produz é o `ToolNode`
  do LangGraph, não o nosso código, e a mensagem já traz `"github"|"cloudflare"`.

**Verificado que a observação de fato chega ao agente**: `ToolNode.handleToolErrors` tem
default `true` (`node_modules/@langchain/langgraph/dist/prebuilt/tool_node.js:179`), e o
`catch` converte a exceção num `ToolMessage` com `status: "error"` e conteúdo
`Error: <mensagem>\n Please fix your mistakes.`. Ambas as estratégias passam por lá:
`react.ts` via `createReactAgent`, e `plan-and-execute.ts` também, porque o executor de
cada passo é um `createReactAgent` (`plan-and-execute.ts:88`).

**Consequência para os testes**: o teste da FR-004 MUST afirmar que `invoke()` **rejeita**,
e não que devolve string — escrever `assert.match(await tool.invoke({provider:"aws"}), /…/)`
falharia, e a reação natural a esse teste vermelho é trocar o enum por `z.string()`, que é
justamente a violação do Princípio IV que o enum existe para impedir.

**Consequência para a FR-015**: "nenhuma exceção escapa da ferramenta" vale para o corpo da
ferramenta — a fronteira que o nosso código controla. A validação de esquema é do framework,
acontece antes, e já tem rede de segurança própria.

---

## R-007 — O `fetch` é injetado em `createOpsTools`, com default, e nada mais na cadeia muda

**Decisão**: `createOpsTools(store, deps?)`, com `deps.fetchImpl` default `globalThis.fetch`.

**O problema que isso evita**: a cadeia de composição hoje é tipada como
`(store: OpsRepository) => ReasoningStrategy`, e essa assinatura aparece em
`BASE_FACTORIES`, `FACTORIES`, `createStrategy`, `baseStrategyNames`, no tipo exportado
`ResolveStrategy` e em `resolveStrategy` — que é consumido pela camada HTTP da 003. Enfiar
um `fetcher` por esse caminho até chegar em `createOpsTools` alteraria o contrato público de
uma feature já entregue, para servir uma ferramenta que nenhuma das duas estratégias precisa
configurar.

**Por que o default basta**: os testes das ferramentas **não passam pelas estratégias** —
`src/agents/tools.test.ts` chama `createOpsTools(store)` diretamente, em todos os 8 casos.
Injetar no ponto onde o teste já está satisfaz a FR-033 sem tocar em nada acima. As duas
estratégias seguem chamando `createOpsTools(store)`, sem alteração (FR-034).

**Alternativas rejeitadas**: variável de ambiente apontando para um servidor falso nos testes
(violaria FR-035, que proíbe rede, e FR-006, que proíbe configuração nova); substituir
`globalThis.fetch` na suíte (estado global compartilhado entre testes, contra o Princípio V —
"cada execução de teste MUST partir de um estado próprio e isolado").

**Parâmetro opcional com default**, não obrigatório: um parâmetro obrigatório quebraria os
três call sites existentes por nenhum ganho.

---

## R-008 — A lógica vive em `src/agents/provider-status.ts`; `tools.ts` só a expõe

**Decisão**: um módulo novo com a função `checkProviderStatus(provider, deps)`, e em
`tools.ts` um `tool()` fino que a chama.

**Motivos**:
1. `tools.ts` tem 184 linhas para cinco ferramentas, todas com corpo de 3 a 12 linhas. Timeout,
   retry, classificação de erro e validação somam mais lógica do que as cinco juntas; deixar
   isso inline transforma o arquivo de catálogo de ferramentas em módulo de infraestrutura.
2. É o Princípio I aplicado ao que a feature tem de borda: a decisão de *quando* retentar é
   determinística e testável sozinha; o I/O fica num único ponto identificável.
3. Os testes da lógica de retry não precisam construir uma ferramenta LangChain nem contornar
   a validação de esquema (R-006) para exercitar os casos de falha.

**Consequência**: dois arquivos de teste. `provider-status.test.ts` cobre timeout, retry,
classificação e validação (o grosso da FR-036); `tools.test.ts` ganha os casos de fronteira
da ferramenta — default aplicado, provedor inválido rejeitado, formato do retorno.

---

## R-009 — O esquema exige indicador de conjunto fechado e descarta o resto (verificado)

**Decisão**:

```ts
z.object({
  status: z.object({
    indicator: z.enum(["none", "minor", "major", "critical"]),
    description: z.string(),
  }),
})
```

**Verificação**, sobre um corpo realista do statuspage.io (com `page`, `components` e um
campo extra dentro de `status`): campos não declarados são descartados pelo `z.object` do
zod 4 sem configuração extra (FR-023 ✅); um indicador fora do conjunto reprova
(`success: false`); um `description` ausente reprova.

**O custo assumido**: um quinto indicador introduzido pelo provedor no futuro passa a ser
tratado como resposta inválida — a ferramenta diz "não consegui confirmar" em vez de repassar
um valor desconhecido. É a troca certa para esta feature: o consumidor é um modelo que vai
decidir "é nosso ou é deles?", e um indicador que ele não sabe interpretar é pior que uma
recusa explícita. Está registrado como assunção aberta na spec.

---

## R-010 — O retorno é uma linha de texto, não JSON — e isso diverge das outras cinco ferramentas

**Decisão**: seguir o pedido — texto legível de uma linha, para sucesso e para falha.

```
github: operacional — All Systems Operational
github: não foi possível confirmar o status (o provedor não respondeu em 5s, 2 tentativas)
```

**A divergência, explícita**: as cinco ferramentas existentes devolvem `JSON.stringify(...)`,
e erros de domínio como `JSON.stringify({ error: message })`. Esta devolve prosa.

**Por que ainda assim é a escolha certa aqui**: as outras cinco devolvem *registros* — um
incidente, uma lista de alertas — que o modelo pode precisar percorrer campo a campo. Esta
devolve **um fato**, e o pedido é explícito em duas frentes ("retorno compacto, uma linha"
e "string de erro legível"). Um JSON de duas chaves não seria mais estruturado em nenhum
sentido útil; seria só mais tokens em volta da mesma informação.

**O que a decisão obriga** (FR-019): a linha de erro não pode ser confundida com estado
válido. Daí o formato de sucesso sempre trazer o indicador traduzido (`operacional`,
`degradação parcial`, `interrupção grave`, `interrupção crítica`) e a linha de erro sempre
começar por "não foi possível confirmar o status" — que nenhum estado válido produz.

**Registrado como ponto de confirmação**: se a preferência for consistência com o idioma
JSON das outras cinco, é uma linha de código. A spec (FR-025, FR-027) está escrita para
texto.

---

## R-011 — Os testes de espera esgotada não esperam 5 segundos (verificado)

**Decisão**: o dublê rejeita imediatamente com
`new DOMException("The operation was aborted due to timeout", "TimeoutError")`.

**Verificação**: o `DOMException` construído assim tem `name === "TimeoutError"`, idêntico ao
que o `fetch` real produz (R-002) — o classificador não distingue um do outro.

**Consequência**: a FR-038 é satisfeita sem relógio falso, sem `--test-concurrency` e sem
suíte lenta. Os dublês das demais falhas seguem o mesmo padrão: `new Response(body, {status})`
para 5xx e 4xx (verificado: `ok: false`, `status: 503`), e `new Response("<html>…")` para o
corpo não-JSON (verificado: `res.json()` lança `SyntaxError`).

**O que o dublê precisa registrar**, para a FR-037 e para o bug do R-003: quantas vezes foi
chamado, com que URL e com que sinal — e o teste afirma que nenhum sinal recebido chegou já
abortado.

---

## R-012 — As URLs são uma tabela constante, e o provedor nunca entra numa URL montada

**Decisão**:

```ts
const PROVIDER_STATUS_URLS = {
  github: "https://www.githubstatus.com/api/v2/status.json",
  cloudflare: "https://www.cloudflarestatus.com/api/v2/status.json",
} as const satisfies Record<ProviderName, string>;
```

com `ProviderName` derivado do enum zod por inferência, nunca escrito duas vezes
(Princípio I: "derivadas por inferência de tipo — nenhum tipo paralelo escrito à mão").

**O que isso fecha**: nada vindo do modelo participa da construção de uma URL. É o mesmo
raciocínio que o Princípio II aplica a SQL — uma URL montada por interpolação com um valor
que o modelo escolheu é a versão em HTTP do SQL concatenado (FR-005, FR-008). O `satisfies`
faz o `typecheck` reprovar um provedor adicionado ao enum sem URL correspondente.

---

## R-013 — Nenhum dado do OpsPilot sai no pedido

**Decisão**: `GET` sem cabeçalhos além dos que o `fetch` põe por padrão, sem corpo, sem query
string, sem cookies.

A FR-008 é uma exigência de privacidade, não de desempenho: o OpsPilot lida com nomes de
serviço internos, títulos de incidente e conteúdo de conversa de plantão, e a página de
status de um provedor não tem por que ver nada disso. Como a URL é constante (R-012) e não há
corpo, não há caminho por onde vazar — a decisão é o que garante que continue assim.

---

## R-014 — Sem cache e sem persistência

**Decisão**: cada chamada consulta o provedor; nada é gravado.

Um cache de poucos minutos economizaria chamadas num cenário que não existe (um plantão não
pergunta pelo GitHub dez vezes por minuto) e custaria exatamente o que não se pode pagar:
responder "operacional" durante os primeiros minutos de uma interrupção, que é o momento em
que alguém está perguntando. A feature não toca em `src/store/` nem em `src/domain/`.

---

## R-015 — Nenhuma mudança nos contratos de ferramenta anteriores, exceto uma linha de fronteira

**Decisão**: `contracts/check-provider-status.md` acrescenta a sexta ferramenta ao catálogo
de `specs/004-sqlite-persistence/contracts/ops-tools.md` sem substituí-lo.

**A única alteração de código fora da feature**: a regra 3 do Princípio IV exige declarar a
fronteira "contra a ferramenta vizinha mais fácil de confundir", e ela é recíproca. A
descrição de `list_alerts` hoje delimita-se contra `list_incidents`; com uma ferramenta que
também responde "o que está acontecendo", mas do lado de fora, ela passa a precisar dizer
que trata de sinal **interno** (FR-030). É uma frase em `list_alerts` — e é obrigação
constitucional, não polimento.

---

## Resumo do que a Fase 0 mudou em relação à leitura ingênua do pedido

1. **O sinal de timeout é criado por tentativa** (R-003). Compartilhá-lo torna a retentativa
   decorativa, com todos os testes verdes.
2. **`res.json()` tem duas falhas de naturezas opostas** (R-004), e só a identidade do erro
   as separa.
3. **O provedor inválido não chega ao nosso código** (R-006). O teste da FR-004 afirma
   rejeição, não retorno — e escrevê-lo errado empurra para trocar o enum por string.
4. **O `fetch` entra por `createOpsTools`, não pela cadeia de estratégias** (R-007), que é
   contrato público da 003.
5. **O retorno em texto diverge do idioma JSON das outras cinco ferramentas** (R-010), de
   propósito e por pedido explícito — registrado para confirmação.
