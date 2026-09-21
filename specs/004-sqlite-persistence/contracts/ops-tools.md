# Contract: As 5 ferramentas operacionais

**Feature**: `004-sqlite-persistence` | Satisfaz FR-028, FR-029, FR-029a/b, FR-034 a FR-037

**Substitui** [`specs/001-reasoning-core/contracts/tools.md`](../../001-reasoning-core/contracts/tools.md),
que descreve três ferramentas. Este contrato descreve as cinco e é o que vale a partir desta
feature; o contrato da 001 permanece como registro histórico daquela entrega.

Toda ferramenta MUST satisfazer as **6 regras** do Princípio IV da constituição:
**(1)** o que faz · **(2)** quando usar · **(3)** quando NÃO usar · **(4)** o que devolve ·
**(5)** todo campo com `.describe()` · **(6)** conjunto fechado é enum.

---

## Auditoria do estado atual

O que existe hoje em `src/agents/tools.ts`, medido regra a regra:

| Ferramenta | R1 | R2 | R3 | R4 | R5 | R6 | Dívida |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| `list_alerts` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | Não se distingue de `list_incidents` (que passa a existir); não diz o que devolve; nenhum campo descrito |
| `open_incident` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | **Dívida nomeada no pedido**: não diz quando NÃO usar — o modelo abre incidente quando o pedido era só consultar |
| `resolve_incident` | ✅ | ❌ | ❌ | ❌ | ❌ | n/a | Uma frase, nenhum gatilho, nenhum retorno, `id` sem descrição |

**Nenhum campo de nenhuma ferramenta tem `.describe()` hoje** — a Regra 5 falha em 100% dos
casos. A Regra 6 já é respeitada onde há conjunto fechado (`status` em `list_alerts`,
`severitySchema` em `open_incident`), mas os valores não são explicitados na descrição.

**Por que isso piora agora**: com cinco ferramentas em vez de três, surgem dois pares
genuinamente confundíveis — `list_alerts` × `list_incidents` (sinal do monitoramento ×
registro de trabalho) e `open_incident` × `list_incidents` (escrever × ler). Cada escolha
errada é uma chamada de modelo paga e um passo a mais no rastro.

---

## As ferramentas

### 1. `list_alerts` — revisada

**Descrição** (R1 · R2 · R3 · R4):

> Lista os alertas emitidos pelo monitoramento. Use quando o pedido for sobre o que está
> disparando agora, o estado dos serviços ou "como está o plantão". **Não use** para
> incidentes registrados por pessoas — alerta é sinal automático do monitoramento, incidente
> é trabalho aberto por alguém; para esses, use `list_incidents`. Devolve a lista de alertas
> com id, serviço, resumo, severidade, status e horário em que disparou, em ordem
> cronológica; devolve lista vazia quando nenhum alerta corresponde ao filtro.

| Campo | Tipo | Obrigatório | `.describe()` |
|---|---|---|---|
| `status` | enum `firing \| resolved \| all` | não (default `firing`) | "Filtra por status do alerta: firing (disparando agora), resolved (já normalizado) ou all (todos). Padrão: firing." |

**Efeitos**: nenhum. Somente leitura.

---

### 2. `list_incidents` — NOVA (FR-028)

**Descrição** (R1 · R2 · R3 · R4):

> Lista os incidentes registrados, filtrados por status. Use quando o pedido for sobre o que
> já foi registrado, o que continua em aberto ou o que já foi resolvido — inclusive para
> descobrir o id de um incidente antes de resolvê-lo. **Não use** para saber o que o
> monitoramento está acusando: isso é `list_alerts`. Devolve a lista de incidentes com id,
> título, serviço, severidade, status, horário de abertura e de resolução; devolve lista
> vazia quando não há incidente no status pedido.

| Campo | Tipo | Obrigatório | `.describe()` |
|---|---|---|---|
| `status` | enum `open \| resolved \| all` | não (default `open`) | "Filtra por status do incidente: open (ainda em aberto), resolved (já resolvido) ou all (todos). Padrão: open." |

**Efeitos**: nenhum. Somente leitura.

**Nota de desenho**: o "inclusive para descobrir o id antes de resolvê-lo" é deliberado —
`resolve_incident` exige um id, e sem essa ponte o modelo precisa adivinhar ou inventar um.
É a diferença entre uma ferramenta que existe e uma ferramenta que é encontrada.

---

### 3. `consultar_runbook` — NOVA (FR-029)

**Descrição** (R1 · R2 · R3 · R4):

> Devolve o procedimento de resposta (runbook) escrito para um serviço. Use quando o pedido
> for sobre **o que fazer** diante de um problema: como investigar, quais passos seguir, qual
> o procedimento padrão daquele serviço. **Não use** para saber o que está acontecendo
> (`list_alerts`) nem para registrar trabalho (`open_incident`). Devolve o título e os passos
> na ordem em que devem ser seguidos; quando o serviço existe mas não tem runbook escrito,
> diz isso explicitamente, em vez de devolver passos vazios.

| Campo | Tipo | Obrigatório | `.describe()` |
|---|---|---|---|
| `service` | string | sim | "Id do serviço cujo runbook se quer consultar, em formato de slug minúsculo (ex.: checkout, payments, auth). Use list_alerts para descobrir os ids disponíveis." |

**Saídas** (FR-029a):

| Situação | Resposta |
|---|---|
| Serviço com runbook | `{ serviceId, title, steps: [...] }` |
| Serviço existe, sem runbook | `{ error: "Runbook not found for service: <id>" }` — `RunbookNotFoundError` |
| Serviço não existe | `{ error: "Service not found: <id>" }` — `ServiceNotFoundError` |

Os dois últimos são recados diferentes para quem está de plantão: "não há procedimento
escrito para esse serviço" versus "esse serviço não existe, confira o nome". Colapsá-los num
só faria o modelo sugerir corrigir um nome que estava certo.

**Efeitos**: nenhum. Somente leitura.

**⚠️ Nome a confirmar** (R-020): é o nome do pedido, mas quebra o padrão em inglês das
outras cinco. `get_runbook` seria o equivalente consistente. Sem efeito funcional; uma
palavra a trocar, se for o caso.

---

### 4. `open_incident` — revisada (a dívida do pedido)

**Descrição** (R1 · R2 · **R3** · R4):

> Abre um novo incidente para um serviço. Use quando o pedido for explicitamente para
> registrar, abrir ou criar um incidente — normalmente a partir de um alerta que está
> disparando. **Não use** para consultar o que já existe (`list_incidents`) nem para
> responder perguntas sobre o estado dos serviços (`list_alerts`): esta ferramenta **escreve**,
> e abrir um incidente que ninguém pediu é trabalho que alguém vai ter que resolver depois.
> Um pedido por si só não é motivo para abrir; o pedido precisa dizer para abrir. Devolve o
> incidente criado, com o id gerado e status "open".
>
> ⚠️ **Emenda 005-provider-status-tool** (achado em uso real, não em teste — o Princípio V
> proíbe testes que chamem o modelo, então esta classe de bug é invisível à suíte por
> construção): a observação da ferramenta já devolve o incidente inteiro em JSON, mas a
> *síntese em linguagem natural* — o texto final que a pessoa lê — é decisão do modelo a
> cada execução, não um eco garantido. Duas correções foram tentadas, nesta ordem:
>
> 1. **Reforçar a descrição** ("sempre inclua id, título, serviço, severidade e status").
>    **Piorou o problema**: em três execuções reais, duas produziram um id plausível mas
>    **fabricado** (separador errado, um deles um padrão repetido de placeholder) em vez do
>    id real. Pedir a um modelo probabilístico para "sempre incluir X" não o impede de
>    inventar X quando ele não está de fato lendo a saída da ferramenta — só aumenta a
>    pressão para produzir *algo* com a forma certa. **Revertida.**
> 2. **Confirmação determinística fora do modelo**
>    (`src/agents/incident-confirmation.ts`, `withIncidentConfirmation`): depois de cada
>    `run()`, o próprio código relê as observações reais de `open_incident` no rastro e, se
>    a resposta final do modelo não citar o id verdadeiro **literalmente**, substitui a
>    resposta inteira por um bloco montado a partir do JSON da ferramenta — nunca por texto
>    gerado pelo modelo. Substituição, não acréscimo: um id certo ao lado de um errado não dá
>    para quem está de plantão nenhuma forma de saber qual confiar. Aplicado no nível dos
>    `BASE_FACTORIES` (`src/agents/index.ts`), antes de um eventual `withReflection`, para que
>    o crítico julgue a resposta já corrigida.

| Campo | Tipo | Obrigatório | `.describe()` |
|---|---|---|---|
| `title` | string (min 1) | sim | "Título curto do incidente, descrevendo o problema como quem está de plantão o relataria. Ex.: 'Erro 500 no checkout acima do limiar'." |
| `service` | string | sim | "Id do serviço afetado, em formato de slug minúsculo (ex.: checkout, payments, auth). Precisa ser um serviço existente — use list_alerts para descobrir os ids." |
| `severity` | enum `critical \| high \| medium \| low` | sim | "Gravidade do incidente: critical (impacto total), high (impacto grave), medium (degradação), low (menor). Não há padrão — escolha a partir do que o pedido descreve." |

**Erros**: serviço inexistente ⇒ `ServiceNotFoundError`; título vazio ou severidade inválida
⇒ erro de validação. Nada é gravado em nenhum dos casos.

**Efeitos**: **escreve**. Grava um incidente de forma durável.

> **Nota de nomenclatura** (herdada da 001): o parâmetro exposto ao modelo chama-se
> `service`, mas mapeia para `Incident.serviceId` no modelo de dados.

---

### 5. `resolve_incident` — revisada

**Descrição** (R1 · R2 · R3 · R4):

> Marca um incidente já aberto como resolvido. Use quando o pedido disser que o problema foi
> corrigido, normalizado ou encerrado, e você souber o id do incidente. **Não use** sem o id
> — descubra-o antes com `list_incidents`, e não invente um. **Não use** para fechar alertas:
> alerta não se resolve por ferramenta. Devolve o incidente atualizado, com status "resolved"
> e o horário da resolução.

| Campo | Tipo | Obrigatório | `.describe()` |
|---|---|---|---|
| `id` | string (min 1) | sim | "Id do incidente a resolver, como devolvido por open_incident ou list_incidents (formato inc-<uuid>). Não invente: consulte list_incidents se não tiver o id." |

**Erros**: id inexistente ⇒ `IncidentNotFoundError`; já resolvido ⇒
`IncidentAlreadyResolvedError`. Nada muda em nenhum dos casos, e o horário da primeira
resolução nunca é sobrescrito.

**Efeitos**: **escreve**. Altera o status do incidente de forma durável.

---

## Tratamento de erro comum

Inalterado em relação à 001, e continua valendo para as duas ferramentas novas: erros de
domínio (`src/domain/errors.ts`) são traduzidos na borda da ferramenta em observação legível
ao modelo, com `isError: true` no evento de rastro. **A execução não aborta** — o agente
recebe a observação e pode se corrigir, que é o comportamento que faz uma ferramenta de
leitura ser recuperável.

Falhas técnicas — incluindo `ERR_SQLITE_ERROR` de `CHECK` ou chave estrangeira — propagam e
encerram a execução. São bug, não situação prevista, e mascará-las como observação faria o
modelo tentar contornar um banco inconsistente.

---

## Checklist de aceitação (FR-034 a FR-037)

Para cada uma das **5 ferramentas** (correção: o documento chegou a dizer "6" em versões
anteriores — são list_alerts, list_incidents, consultar_runbook, open_incident,
resolve_incident; 3 existentes + 2 novas = 5):

- [x] R1 — primeira frase declara a ação única, no imperativo
- [x] R2 — declara o gatilho concreto, na linguagem de quem está de plantão
- [x] R3 — declara a fronteira contra a ferramenta vizinha mais confundível
- [x] R4 — declara o que devolve, **incluindo o caso vazio**
- [x] R5 — todo campo do esquema tem `.describe()`, com o default explicitado quando houver
- [x] R6 — todo conjunto fechado é `enum`, com os valores explicitados na descrição

Verificado por leitura de `src/agents/tools.ts` (implementação final) contra as 5 descrições
deste documento, e por rede automática: `src/agents/tools.test.ts` percorre a lista
devolvida por `createOpsTools` e afirma que nenhum campo de nenhum esquema está sem
descrição (Regra 5, a única das seis regras mecanicamente verificável), e que todo campo de
conjunto fechado é `ZodEnum` com os valores presentes no texto da descrição (Regra 6).
