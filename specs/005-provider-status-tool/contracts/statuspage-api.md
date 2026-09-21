# Contrato: API pública statuspage.io (dependência externa)

**Feature**: `005-provider-status-tool` | **Fase**: 1 | **Data**: 2026-09-18

Contrato de uma dependência **que não controlamos**. Vale como registro do que assumimos e
de como nos protegemos quando a suposição deixar de valer.

---

## Endpoints consumidos

| Provedor | URL | Método | Autenticação |
|---|---|---|---|
| `github` | `https://www.githubstatus.com/api/v2/status.json` | `GET` | nenhuma |
| `cloudflare` | `https://www.cloudflarestatus.com/api/v2/status.json` | `GET` | nenhuma |

Ambos seguem o `status.json` do padrão statuspage.io. As URLs são constantes do projeto
(R-012); nada vindo do modelo participa de sua construção.

## Pedido

- Sem cabeçalhos além dos que o `fetch` envia por padrão.
- Sem corpo, sem query string, sem cookies, sem credencial.
- **Nenhum dado do OpsPilot** — nome de serviço, título de incidente ou conteúdo de conversa
  — é transmitido (FR-008, R-013).
- `signal: AbortSignal.timeout(5000)`, criado por tentativa (R-003).

## Resposta esperada

```json
{
  "page": { "id": "kctbh9vrtdwd", "name": "GitHub", "url": "https://www.githubstatus.com",
            "updated_at": "2026-09-18T12:00:00Z" },
  "status": { "indicator": "none", "description": "All Systems Operational" }
}
```

Do corpo inteiro, **consumimos dois campos**: `status.indicator` e `status.description`.
Todo o resto — `page`, e qualquer campo futuro — é descartado na validação (FR-023, R-009),
que é o que impede o corpo de inflar o contexto (FR-026).

### `status.indicator`

| Valor | Significado no padrão | Tradução na linha de retorno |
|---|---|---|
| `none` | tudo operacional | `operacional` |
| `minor` | degradação parcial | `degradação parcial` |
| `major` | interrupção relevante | `interrupção grave` |
| `critical` | interrupção crítica | `interrupção crítica` |

> ⚠️ **Assumimos que este conjunto é fechado.** Um quinto valor introduzido pelo provedor é
> tratado como `invalid-response`: a ferramenta diz "não foi possível confirmar o status" em
> vez de repassar um valor que o modelo não sabe interpretar (R-009). É uma troca deliberada,
> registrada como assunção aberta na spec — e o sintoma, se acontecer, é inconfundível.

## Respostas fora do esperado — e o que fazemos

| Situação | Classificação | Retenta? |
|---|---|---|
| HTTP 5xx | `unavailable` | sim |
| HTTP 4xx | `unavailable` | não |
| Conexão recusada, DNS, TLS (`TypeError: fetch failed`) | `unavailable` | sim |
| Sem resposta em 5 s (`DOMException` `TimeoutError`) | `timeout` | sim |
| Corpo travado no meio (`TimeoutError` no `res.json()`) | `timeout` | sim |
| Corpo não-JSON (`SyntaxError` no `res.json()`) | `invalid-response` | não |
| JSON válido fora do esquema | `invalid-response` | não |

A classificação é por **identidade do erro** (`error.name`), nunca por `instanceof` nem pela
posição no código: o mesmo `res.json()` produz `TimeoutError` e `SyntaxError`, que caem em
lados opostos da política de retentativa (R-002, R-004).

## O que NÃO assumimos

- **Que o provedor responde rápido.** Daí o limite por tentativa, não por chamada.
- **Que responde JSON.** Uma página de erro HTML de CDN é um cenário realista justamente
  durante uma interrupção — e é o caso `invalid-response`.
- **Que os campos são estáveis.** O esquema é a fronteira; uma mudança no payload vira falha
  legível, nunca um estado inventado (FR-022).
- **Que o endpoint continuará público e sem chave.** Se passar a exigir autenticação,
  responderá 4xx e a ferramenta dirá que não foi possível confirmar — sem quebrar nada mais.

## Estabilidade e verificação

Nenhum teste toca a rede (FR-035): toda a cobertura usa dublê (R-011). Isso significa que
**a suíte não detecta uma mudança de contrato do provedor** — é o preço, aceito, de portões
offline e determinísticos (Princípio V). O que a detecta é o uso real, e o sintoma é
explícito: `invalid-response` em toda consulta a um provedor. A validação zod existe
precisamente para que esse sintoma seja uma linha legível em vez de um estado falso.

O roteiro de [`../quickstart.md`](../quickstart.md) inclui uma verificação online opcional,
fora dos portões, para quem quiser confirmar o contrato contra o provedor de verdade.
