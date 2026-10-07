# Contract: CORS da API

**Feature**: `016-war-room-web` | Satisfaz FR-023 a FR-025

Vale para todas as rotas da API (`POST /chat`, `GET /requests/:id`, `GET /stats` e as futuras,
inclusive `POST /approvals/:id` de [approval-flow.md](./approval-flow.md)).

## Configuração

| Variável | Formato | Default |
|---|---|---|
| `OPSPILOT_CORS_ORIGINS` | origens separadas por vírgula, ex.: `http://localhost:5173,https://kauane.dev` | `http://localhost:5173` |

Cada item MUST ser uma URL `http`/`https` sem caminho, query nem fragmento. Lista vazia ou item
inválido faz o servidor não subir, com mensagem que nomeia o item (mesma regra de `PORT`).

## Comportamento

| Pedido | Resposta |
|---|---|
| Sem `Origin` | Idêntica a antes desta feature (CO1) |
| `Origin` permitida, não-preflight | Resposta normal + `Access-Control-Allow-Origin: <origin>`, `Access-Control-Expose-Headers: X-Request-Id`, `Vary: Origin` |
| `Origin` não permitida, não-preflight | Resposta normal, sem cabeçalhos `Access-Control-*`, + `Vary: Origin` |
| `OPTIONS` + `Access-Control-Request-Method`, origem permitida | `204`, corpo vazio, + `Allow-Origin`, `Allow-Methods: GET, POST`, `Allow-Headers: Content-Type`, `Max-Age: 600`, `Vary: Origin` |
| `OPTIONS` preflight, origem não permitida | `204`, corpo vazio, sem `Access-Control-*` |

## Garantias

- **CO1**: um pedido sem `Origin` (curl, testes, MCP) recebe status, corpo e cabeçalhos idênticos
  aos de antes, exceto pela ausência de qualquer `Access-Control-*`.
- **CO2**: o preflight nunca chega a `requestTracking`. Não gera `requestId`, registro em
  `requests` nem linha de log `request.*`.
- **CO3**: a comparação de origem é exata, depois de normalizar (`new URL(o).origin`). Não há
  curinga nem sufixo.
- **CO4**: `Access-Control-Allow-Credentials` nunca é enviado.
- **CO5**: o JSON malformado (400) e os erros 5xx de origem permitida também levam os cabeçalhos,
  porque o middleware roda antes de `express.json()` e do handler de erro.
