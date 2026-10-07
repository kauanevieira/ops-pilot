# Quickstart: War Room Web

**Feature**: `016-war-room-web`

## Pré-requisitos

- Node 22 (`nvm use`).
- `npm install` na raiz. A war room resolve `zod` e `src/domain/` a partir da raiz
  ([research R-003](./research.md#r-003--esquemas-compartilhados-entre-api-e-war-room)).
- `npm --prefix web install`.

## 1. Portões (offline, sem API)

```bash
npm run typecheck && npm test                              # API: inalterada + cors + wire
npm --prefix web run typecheck && npm --prefix web test    # war room
```

Esperado: tudo verde, sem rede e sem `.env`.

## 2. CORS na API

```bash
npm run dev    # OPSPILOT_CORS_ORIGINS ausente → só http://localhost:5173

# Preflight permitido → 204 com Allow-Origin/Methods/Headers
curl -si -X OPTIONS localhost:3000/chat \
  -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' | head -12

# Preflight de outra origem → 204 sem Access-Control-*
curl -si -X OPTIONS localhost:3000/chat \
  -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' | grep -i access-control

# Sem Origin → como antes (sem Access-Control-*)
curl -si localhost:3000/stats | grep -i access-control
```

Esperado conforme [contracts/cors.md](./contracts/cors.md). `GET /stats` não ganha nenhum pedido
novo por causa dos preflights (CO2).

Para validar a lista inválida, rode `OPSPILOT_CORS_ORIGINS='nao-e-url' npm run dev`. O servidor não
sobe, e a mensagem nomeia o item.

## 3. War room contra a API local (US1, US2, US4, US5)

```bash
npm --prefix web run dev   # http://localhost:5173/opspilot/
```

1. Envie "quais alertas críticos estão abertos?". Aparece "pensando… Ns" e depois a resposta.
2. Envie "e qual deles é o mais antigo?". A resposta usa a mesma conversa (o rastro mostra
   `historyMessages` > 0).
3. Clique em "ver raciocínio". A gaveta mostra a rota, as ações com argumentos, as observações e
   a resposta, cada tipo com seu rótulo, e as métricas no topo. Esc fecha.
4. Engrenagem: troque para `http://localhost:3999` e envie. Aparece o erro "Não foi possível
   falar com a API em http://localhost:3999…". Recarregue a página: a URL continua `3999`.
   "Restaurar padrão" volta a `3000`.
5. "Nova conversa" limpa a tela. A próxima resposta tem outro `conversationId`.

## 4. Caminho base

```bash
npm --prefix web run build && npm --prefix web run preview   # http://localhost:4173/opspilot/
```

Esperado: a página carrega sob `/opspilot/`, sem 404 de recurso no console. `web/dist/404.html`
existe e é igual a `index.html`. Com a preview, a origem é `http://localhost:4173`, que precisa
estar em `OPSPILOT_CORS_ORIGINS` (ex.: `OPSPILOT_CORS_ORIGINS=http://localhost:5173,http://localhost:4173`).

## 5. Aprovação (US3), contra o dublê

A API ainda não responde 202 ([approval-flow.md](./contracts/approval-flow.md), estado
"proposto"). A US3 é validada pelos testes da war room:

```bash
npm --prefix web test -- ApprovalCard conversation App
```

Esperado (o filtro seleciona o cartão, o reducer da conversa e os fluxos do `App`): 202 vira cartão. Aprovar mostra a resposta final com "ver raciocínio". Negar mostra
"negado". Duplo clique faz uma chamada só. 409 mostra "Já decidida". O compositor fica bloqueado
enquanto o cartão está pendente.
