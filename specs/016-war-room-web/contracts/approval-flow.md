# Contract: Fluxo de aprovação (202 + decisão)

**Feature**: `016-war-room-web` | Satisfaz FR-012 a FR-016 | **Estado**: proposto

Esta feature **consome** o contrato: a war room o implementa e o testa contra um dublê. A API
passa a cumpri-lo numa feature separada, que pode emendar este documento. Até lá, a API nunca
responde 202, e a war room simplesmente nunca mostra o cartão.

Os esquemas ficam em `src/domain/wire.ts` (`chatAcceptedSchema`, `pendingActionSchema`,
`approvalDecisionSchema`, `approvalDeniedSchema`), definidos uma vez e usados pelos dois lados.

## `POST /chat` → 202 Accepted

Quando o agente decide executar uma ação que exige autorização humana, a execução pausa e a
resposta é:

```jsonc
// 202 Accepted
// X-Request-Id: 3f2b…
{
  "status": "pending_approval",
  "requestId": "3f2b…",
  "conversationId": "c-91…",
  "approval": {
    "id": "ap-7d…",                       // opaco, para a decisão
    "tool": "resolve_incident",           // nome da ferramenta
    "args": { "incidentId": "INC-42" },   // argumentos que serão usados
    "description": "Resolver o incidente INC-42 (checkout fora do ar).",
    "expiresAt": "2026-10-07T18:30:00.000Z"   // opcional
  },
  "trace": [ … ]                          // rastro até a pausa, mesmo formato do 200; opcional
}
```

## `POST /approvals/:id`

Corpo: `{ "decision": "approve" | "deny" }`.

| Situação | Status | Corpo |
|---|---|---|
| Aprovada e a execução terminou | `200` | Igual ao 200 do `/chat` (`answer`, `trace`, `metrics`, `stoppedReason`, `conversationId`, `requestId`). O rastro é o da execução retomada |
| Aprovada e a execução pediu outra aprovação | `202` | Igual ao 202 acima, com novo `approval.id` |
| Negada | `200` | `{ "status": "denied", "approvalId": "…", "conversationId": "…", "requestId": "…" }` |
| `decision` ausente ou inválida | `400` | `invalid_body` |
| Id desconhecido | `404` | `approval_not_found` |
| Já decidida | `409` | `approval_already_decided` |
| Expirada | `410` | `approval_expired` |
| Execução retomada falhou | `503`/`504`/`500` | Mesmos códigos do `/chat` (`model_unavailable`, `timeout`, `internal`) |

Toda resposta traz `X-Request-Id` e `requestId`, como o `/chat` (014).

## Garantias (que a war room assume)

- **AP1**: nenhuma ação que pediu aprovação é executada sem um `approve` para o seu `approval.id`.
- **AP2**: uma decisão por `approval.id`. A segunda recebe `409`, qualquer que seja a decisão.
- **AP3**: depois de `deny`, a ação não é executada, e a conversa continua aceitando mensagens.
- **AP4**: o corpo de erro segue o formato único (`{ error: { code, message, details? },
  requestId }`). A war room trata qualquer `code` desconhecido de forma genérica.

## Como a war room usa

- 202 do `/chat` ou da decisão → cartão (`approval`).
- 200 de aprovação → o cartão vira "aprovado" e a resposta entra como item `answer` com "ver
  raciocínio".
- 200 `denied` → o cartão vira "negado".
- 404/409/410 → o cartão vira "recusado", com o motivo (FR-015).
- Falha de rede numa decisão → o cartão volta a `pending` (nada foi decidido do lado da war room)
  e um erro legível aparece abaixo dele.
