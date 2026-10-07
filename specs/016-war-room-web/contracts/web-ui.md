# Contract: War room (`web/`)

**Feature**: `016-war-room-web` | Satisfaz FR-001 a FR-022

## Publicação

| Item | Valor |
|---|---|
| Caminho base | `/opspilot/` por padrão (dev, preview e build). Configurável no build por `OPSPILOT_WEB_BASE` (017); no GitHub Pages: `/ops-pilot/` |
| Build | `npm --prefix web run build` → `web/dist/` com `index.html` e `404.html` idênticos |
| Variável de build | `VITE_OPSPILOT_API_URL` (default `http://localhost:3000`) |
| Servidor de dev | `http://localhost:5173/opspilot/` (origem padrão do CORS) |
| Portões | `npm --prefix web run typecheck`, `npm --prefix web test`, offline e sem API |

## Chamadas que a war room faz

| Quando | Chamada | Corpo |
|---|---|---|
| Enviar mensagem | `POST {api}/chat` | `{ message, conversationId? }`, nunca `strategy`, `reflect` ou `userId` |
| Aprovar/Negar | `POST {api}/approvals/{id}` | `{ decision }` |

Mais nada. "Ver raciocínio" usa o rastro já recebido, sem nova chamada.

## Tela

- **Cabeçalho**: nome "OpsPilot · War Room", URL da API em uso (abreviada, com indicação se é a
  padrão), botão "Nova conversa", botão engrenagem (rótulo acessível "Configurações").
- **Conversa**: itens em ordem. Mensagem do usuário à direita. Resposta à esquerda com "ver
  raciocínio", rota (`route.strategy`) e duração. Cartão de aprovação. Bolha de erro.
- **Compositor**: textarea (Enter envia, Shift+Enter quebra linha) e botão Enviar, desabilitados
  quando `!canSend`. Indicador "pensando… Ns" enquanto `inFlight`.
- **Gaveta de rastro**: abre sobre a conversa (à direita, ≥ 641 px; tela cheia, ≤ 640 px). Fecha
  com Esc, com o botão fechar ou clicando fora. O foco volta ao "ver raciocínio" de origem.
- **Diálogo de configurações**: campo URL, Salvar, Restaurar padrão, Cancelar. Erro inline para
  URL inválida. Aviso se o armazenamento não estiver disponível.

## Apresentação do rastro

Cabeçalho: `stoppedReason`, depois cada métrica presente (`llmCalls`, `latencyMs`,
`promptTokens`, `modelUsed`, `historyMessages`, `summaryCoveredMessages`, `recalledMemories`,
`contextBreakdown`). Métrica ausente não aparece (FR-009).

| Tipo | Rótulo | Campos exibidos |
|---|---|---|
| `summarize` | Resumo | `content` (recolhível), `absorbedMessages` |
| `route` | Rota | `route`, `strategy`, `source` (router/override/fallback), `reason` |
| `thought` | Pensamento | `content` |
| `action` | Ação | `tool`, `args` como árvore chave/valor (aninhado legível, nunca `[object Object]`) |
| `observation` | Observação | `tool?`, `content` (recolhível), selo "erro" se `isError` |
| `plan` | Plano (rev. N) | `steps` numerados, `revision` |
| `critique` | Crítica | `content`, selo aprovado/reprovado pelo prefixo |
| `answer` | Resposta | `content` |
| `fallback` | Troca de modelo | `from` → `to`, `reason` |
| desconhecido | Evento `<type>` | JSON bruto formatado |

Todo evento mostra o `nodeName` quando presente. Conteúdo com mais de 600 caracteres ou mais de 12
linhas vem recolhido, com "mostrar tudo" (FR-010).

## Mensagens de erro

| Origem | Texto (resumo) |
|---|---|
| `invalid_body` | "A API recusou a mensagem." + a mensagem da API |
| `unknown_strategy` | "Estratégia desconhecida." (não deve ocorrer: a war room não envia `strategy`) |
| `conversation_not_found` | "Esta conversa não existe mais na API." + botão "Nova conversa" |
| `timeout` | "O OpsPilot não respondeu a tempo (180 s)." + "Tentar de novo" |
| `model_unavailable` | "Nenhum modelo disponível agora." + "Tentar de novo" |
| `internal` | "Erro interno da API." + "Tentar de novo" |
| `approval_not_found` / `approval_already_decided` / `approval_expired` | no cartão: "Pendência não encontrada" / "Já decidida" / "Expirou" |
| outro `code` | "A API respondeu com erro `<code>`." + a mensagem da API |
| `unreachable` (rede/CORS) | "Não foi possível falar com a API em `<url>`. Confira a URL na engrenagem e se esta origem está em `OPSPILOT_CORS_ORIGINS`." |
| `unreachable` (prazo) | "Sem resposta da API em 190 s." |
| `malformed` | "A API respondeu num formato inesperado." |

Toda bolha de erro mostra `requestId` quando existir, com botão copiar. "Tentar de novo" reenvia
o mesmo texto na mesma conversa.

## Garantias

- **UI1**: um evento de rastro inválido ou desconhecido nunca impede a exibição dos demais nem da
  conversa.
- **UI2**: o cartão de aprovação dispara no máximo uma chamada de decisão por id, mesmo com
  cliques repetidos.
- **UI3**: nenhum texto da conversa é gravado no navegador. Só `opspilot.apiUrl` é gravado.
- **UI4**: todo controle tem rótulo acessível, e o tipo de evento é dito em texto, não só por cor.
