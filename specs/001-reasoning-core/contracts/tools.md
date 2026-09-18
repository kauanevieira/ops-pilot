# Contract: Ferramentas operacionais

**Feature**: `001-reasoning-core` | Satisfies FR-011 a FR-015

> ⚠️ **Substituído pela feature `004-sqlite-persistence`**: as três ferramentas descritas
> abaixo permanecem como registro histórico desta entrega, mas o contrato vigente — com
> essas três revisadas e mais duas novas (`list_incidents`, `consultar_runbook`) — é
> [`specs/004-sqlite-persistence/contracts/ops-tools.md`](../../004-sqlite-persistence/contracts/ops-tools.md).

Três ferramentas expostas às estratégias. Toda entrada é validada por esquema zod antes
de qualquer efeito sobre o estado (FR-014, SC-008).

---

## `list_alerts`

Lista alertas, opcionalmente filtrados por status.

**Input**

| Campo | Tipo | Obrigatório | Regras |
|-------|------|-------------|--------|
| `status` | `"firing" \| "resolved"` | Não | Ausente ⇒ devolve todos |

**Output**: lista de alertas com `id`, `serviceId`, `summary`, `severity`, `status`, `firedAt`.

**Erros**: `status` fora do conjunto ⇒ erro de validação devolvido como observação.

**Efeitos**: nenhum. Somente leitura.

---

## `open_incident`

Abre um incidente para um serviço.

**Input**

| Campo | Tipo | Obrigatório | Regras |
|-------|------|-------------|--------|
| `title` | `string` | Sim | Não vazio |
| `service` | `string` | Sim | MUST corresponder a um `Service.id` existente |
| `severity` | `"critical" \| "high" \| "medium" \| "low"` | Sim | — |

**Output**: o incidente criado, com `id` gerado e `status: "open"`.

**Erros**
- `service` inexistente ⇒ `ServiceNotFoundError`
- `title` vazio ou `severity` inválida ⇒ erro de validação

**Efeitos**: acrescenta um incidente. Nenhum efeito se a validação falhar.

> **Nota de nomenclatura**: o parâmetro exposto ao modelo chama-se `service` (conforme a
> descrição da feature), mas mapeia para `Incident.serviceId` no modelo de dados.

---

## `resolve_incident`

Resolve um incidente aberto.

**Input**

| Campo | Tipo | Obrigatório | Regras |
|-------|------|-------------|--------|
| `id` | `string` | Sim | MUST corresponder a um incidente existente |

**Output**: o incidente atualizado, com `status: "resolved"` e `resolvedAt` preenchido.

**Erros**
- `id` inexistente ⇒ `IncidentNotFoundError`
- Incidente já resolvido ⇒ `IncidentAlreadyResolvedError`

**Efeitos**: altera o status do incidente. Nenhum efeito se a validação ou a regra falhar.

---

## Tratamento de erro comum

Erros de domínio são **classes** (`src/domain/errors.ts`), traduzidas na borda da
ferramenta para uma observação legível ao modelo, com `isError: true` no evento de rastro
(FR-015). A execução **não** aborta: o agente recebe a observação e pode se corrigir.

Falhas técnicas (bug, indisponibilidade) propagam e encerram a execução — são
distinguíveis dos erros de domínio pelo tipo.
