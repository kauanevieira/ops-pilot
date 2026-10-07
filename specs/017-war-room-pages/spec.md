# Feature Specification: War Room no GitHub Pages

**Feature Branch**: `017-war-room-pages`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Deploy do web/ no Pages via Actions: upload-pages-artifact + deploy-pages, permissions, README (atualizar)"

## Clarifications

### Session 2026-10-07

- Q: O Pages de um repositório chamado `ops-pilot` serve em `/ops-pilot/`, mas a war room é construída para `/opspilot/` (016, FR-020). Qual caminho vale para a publicação? → A: O caminho base passa a ser definido no momento do build. `/opspilot/` continua sendo o padrão (dev e preview locais não mudam), e a publicação no Pages usa o caminho do repositório (`/ops-pilot/`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A war room publicada a cada mudança em `main` (Priority: P1)

Quem mantém o OpsPilot integra uma mudança da war room em `main` e, sem nenhum passo manual, a versão nova fica disponível num endereço público do GitHub Pages do repositório. Quem está de plantão abre esse endereço no navegador e usa a war room sem instalar nada nem rodar o servidor de desenvolvimento.

**Why this priority**: É o pedido. Hoje a war room só existe em `localhost:5173` ou na preview local do build. Sem publicação, cada pessoa precisa clonar, instalar e subir o `web/` para usá-la.

**Independent Test**: Integrar em `main` uma mudança visível em `web/` (ex.: um texto) e, ao fim da execução do fluxo de publicação, abrir o endereço público e ver a mudança.

**Acceptance Scenarios**:

1. **Given** Pages habilitado no repositório com origem "GitHub Actions", **When** um commit que altera a war room chega a `main`, **Then** o fluxo de publicação roda sozinho e, ao terminar com sucesso, o endereço público serve a versão desse commit.
2. **Given** a publicação concluída, **When** a pessoa abre o endereço público, **Then** a war room carrega por completo (estilos, scripts, ícone) sem nenhum recurso com erro de página inexistente.
3. **Given** a war room publicada, **When** a pessoa abre direto um endereço interno sob o caminho da war room, **Then** a war room carrega, não uma página de erro.
4. **Given** a execução do fluxo, **When** a pessoa abre a execução no GitHub, **Then** vê o endereço público da publicação no resumo da execução.

---

### User Story 2 - Nada quebrado vai ao ar (Priority: P1)

Antes de publicar, o fluxo roda os mesmos portões que a war room já tem localmente (tipos e testes). Se qualquer um falhar, ou o build falhar, nada é publicado e a versão anterior continua no ar.

**Why this priority**: O endereço público passa a ser a war room "oficial". Publicar uma versão que não passa nos próprios testes troca uma ferramenta que funciona por uma quebrada, justo no plantão.

**Independent Test**: Integrar um commit com um teste da war room falhando; a execução termina com falha antes da etapa de publicação, e o endereço público continua servindo a versão anterior.

**Acceptance Scenarios**:

1. **Given** um commit em que a verificação de tipos ou os testes da war room falham, **When** o fluxo roda, **Then** ele falha antes de publicar e o endereço público não muda.
2. **Given** um commit em que o build falha, **When** o fluxo roda, **Then** nada é publicado.
3. **Given** dois commits integrados em sequência rápida, **When** os dois fluxos rodam, **Then** só uma publicação acontece por vez e a versão no ar ao final é a do commit mais recente.

---

### User Story 3 - Publicar sob demanda (Priority: P2)

Quem mantém o OpsPilot dispara a publicação manualmente pelo GitHub, sem precisar de commit, para republicar `main` (ex.: depois de habilitar o Pages pela primeira vez ou de mudar a URL padrão da API).

**Why this priority**: Cobre a primeira publicação e recuperações. Não é o caminho do dia a dia.

**Independent Test**: Disparar o fluxo manualmente na aba Actions; ele roda os portões, o build e publica, como num push.

**Acceptance Scenarios**:

1. **Given** o fluxo de publicação no repositório, **When** a pessoa o dispara manualmente, **Then** ele roda as mesmas etapas de um push e publica `main`.

---

### User Story 4 - Saber como usar e manter a versão publicada (Priority: P2)

O README passa a dizer onde a war room está publicada, como habilitar o Pages na primeira vez, como escolher a URL padrão da API embutida na publicação e o que a API precisa liberar (CORS) para aceitar a war room publicada.

**Why this priority**: Sem isso, a primeira publicação falha por falta de configuração no repositório, e a war room publicada abre mas não consegue falar com nenhuma API, porque a origem do Pages não está liberada.

**Independent Test**: Uma pessoa que nunca configurou o repositório segue só o README, habilita o Pages, obtém a war room publicada e conversa com uma API local que liberou a origem do Pages.

**Acceptance Scenarios**:

1. **Given** o README atualizado, **When** a pessoa procura a war room, **Then** encontra o endereço público e a diferença para o modo de desenvolvimento local.
2. **Given** o README atualizado, **When** a pessoa vai publicar pela primeira vez, **Then** encontra o passo de habilitar o Pages com origem "GitHub Actions" e como disparar a primeira publicação.
3. **Given** o README atualizado, **When** a pessoa quer que a war room publicada fale com a sua API, **Then** encontra qual origem colocar em `OPSPILOT_CORS_ORIGINS` (a origem do Pages, sem caminho) e como trocar a URL pela engrenagem ou pela URL padrão da publicação.

---

### Edge Cases

- **Mudança só na API** (nada em `web/` nem nos esquemas compartilhados com ela): não precisa republicar; o fluxo não roda.
- **Mudança nos esquemas compartilhados** (`src/domain/`, que a war room importa): a war room pode mudar de comportamento, então o fluxo roda.
- **Pages não habilitado** no repositório: a etapa de publicação falha com mensagem do GitHub; o README diz como resolver.
- **URL padrão da API não configurada no repositório**: a publicação usa `http://localhost:3000`, que funciona para quem roda a API na própria máquina; nada falha.
- **URL padrão configurada inválida**: a war room já ignora valor inválido e cai em `http://localhost:3000` (016, FR-019); a publicação segue.
- **War room publicada em HTTPS chamando API em HTTP**: navegadores aceitam `http://localhost` a partir de página HTTPS, mas bloqueiam HTTP em outro host. O README avisa que a API remota precisa estar em HTTPS.
- **Fork do repositório**: a publicação roda no fork só se o dono do fork habilitar o Pages; nenhum segredo é necessário.

## Requirements *(mandatory)*

### Functional Requirements

**Publicação**

- **FR-001**: Um fluxo de GitHub Actions MUST gerar o build de `web/` e publicá-lo no GitHub Pages do repositório, empacotando a saída com `actions/upload-pages-artifact` e publicando com `actions/deploy-pages`.
- **FR-002**: O fluxo MUST rodar automaticamente em todo push para `main` que altere `web/`, `src/domain/` (esquemas que a war room importa), as dependências da raiz das quais a war room depende, ou o próprio fluxo, e MUST poder ser disparado manualmente.
- **FR-003**: O fluxo MUST declarar só as permissões necessárias: leitura do conteúdo do repositório, escrita no Pages e emissão de token de identidade para a publicação. Nenhuma outra permissão MUST ser concedida.
- **FR-004**: Só uma publicação MUST acontecer por vez; uma publicação em andamento MUST NOT ser cancelada por uma mais nova, que espera a vez.
- **FR-005**: A publicação MUST usar o ambiente `github-pages` do repositório e expor o endereço publicado no resumo da execução.
- **FR-006**: O fluxo MUST usar a mesma versão de Node do projeto (`.nvmrc`) e instalar dependências de forma reprodutível a partir dos lockfiles da raiz e de `web/`.

**Portões**

- **FR-007**: Antes de publicar, o fluxo MUST rodar a verificação de tipos e os testes da war room. Falha em qualquer portão ou no build MUST impedir a publicação, mantendo a versão anterior no ar.
- **FR-008**: O fluxo MUST NOT exigir a API rodando, rede além da instalação de dependências, nem segredos (Princípio V).

**Caminho e URL da API**

- **FR-009**: O caminho base da war room MUST poder ser definido no momento do build, sem alterar código. Sem definição, MUST valer `/opspilot/` (016, FR-020), de modo que dev e preview locais não mudem.
- **FR-009a**: A publicação no Pages MUST usar o caminho do repositório (`/ops-pilot/`), MUST carregar todos os recursos corretamente nesse endereço e MUST manter o acesso direto a endereços internos funcionando (o `404.html` de 016 continua sendo gerado).
- **FR-009b**: Um caminho base malformado (sem barra inicial ou final) MUST ser normalizado ou recusado com mensagem clara no build, nunca gerar uma publicação com recursos quebrados.
- **FR-010**: A URL padrão da API embutida na publicação MUST poder ser definida por uma variável do repositório (não segredo), sem alterar código. Sem a variável, MUST valer o padrão atual (`http://localhost:3000`).

**Documentação**

- **FR-011**: O README MUST ser atualizado com: o endereço público da war room; o passo único de habilitar o Pages com origem "GitHub Actions"; como disparar a publicação manualmente; a variável do repositório para a URL padrão da API; e a origem do Pages a acrescentar em `OPSPILOT_CORS_ORIGINS`, com o aviso sobre API em HTTP fora de `localhost`.
- **FR-012**: As partes do README que hoje descrevem a war room só como local (seção "War room", bloco de comandos rápidos e a árvore de diretórios) MUST passar a refletir o fluxo de publicação, sem contradizer o que continua valendo para o desenvolvimento local.

### Key Entities

- **Fluxo de publicação**: a automação que, a partir de um commit de `main`, roda os portões, gera o build e publica. Tem gatilhos, permissões e um ambiente de destino.
- **Publicação**: uma versão da war room no ar, ligada ao commit que a gerou e com um endereço público.
- **URL padrão da API da publicação**: valor opcional configurado no repositório, embutido no build; a engrenagem continua podendo trocá-lo por navegador.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma mudança da war room integrada em `main` fica disponível no endereço público em até 5 minutos, sem nenhum passo manual.
- **SC-002**: 100% das execuções com portão ou build falhando terminam sem publicar, e o endereço público continua servindo a versão anterior.
- **SC-003**: A war room publicada carrega sem nenhum recurso com erro, tanto pelo endereço raiz quanto por acesso direto a um endereço interno.
- **SC-004**: Uma pessoa que nunca configurou o repositório chega da leitura do README à war room publicada conversando com uma API local em menos de 15 minutos.
- **SC-005**: Os portões existentes da API e da war room continuam verdes; esta feature não altera o comportamento de nenhum dos dois em desenvolvimento local.

## Assumptions

- **Ferramentas definidas pelo pedido**: GitHub Actions com `actions/upload-pages-artifact` e `actions/deploy-pages`; não se usa branch `gh-pages` nem ferramenta de terceiros.
- **Habilitar o Pages é manual e único**: escolher "GitHub Actions" como origem do Pages nas configurações do repositório não é automatizado; o README documenta o passo.
- **Repositório público (ou plano que permite Pages)**: a publicação depende de o Pages estar disponível para o repositório.
- **Sem domínio próprio**: a war room é servida no endereço padrão do Pages do repositório (`https://kauanevieira.github.io/ops-pilot/`). Domínio próprio fica fora de escopo.
- **Dois endereços documentados**: local em `/opspilot/` (dev e preview), publicado em `/ops-pilot/`. O README deixa a diferença explícita.
- **Só a war room vai para o Pages**: a API continua rodando onde cada pessoa a sobe; o Pages serve só arquivos estáticos. Hospedar a API fica fora de escopo.
- **Sem pré-visualização por pull request**: só `main` é publicado. Pré-visualizações ficam fora de escopo.
- **A war room depende da raiz**: ela importa `zod` e `src/domain/` da raiz (016), então o fluxo instala as dependências da raiz e de `web/`.
- **CORS não muda de comportamento**: a API já aceita uma lista de origens (016, FR-023/FR-024). Esta feature só documenta qual origem acrescentar; o padrão continua `http://localhost:5173`.
