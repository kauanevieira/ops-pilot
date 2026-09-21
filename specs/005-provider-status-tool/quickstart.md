# Quickstart: validar o status de provedores externos

**Feature**: `005-provider-status-tool` | **Fase**: 1 | **Data**: 2026-09-18

Roteiro de validação da feature implementada. As validações **1 a 4 são offline** — sem
credencial, sem rede, sem chamada de modelo. A **5 precisa de `OPENROUTER_API_KEY`** e a
**6 precisa de rede**; ambas ficam fora dos portões.

Detalhes de formato e comportamento estão nos [contratos](./contracts/); este documento é o
roteiro de execução.

## Pré-requisitos

```bash
nvm use            # Node 22 LTS (.nvmrc)
npm install        # nenhuma dependência nova nesta feature (R-001)
```

---

## Validação 1 — Portões de qualidade (offline)

```bash
npm run typecheck
npm test
```

**Esperado**: ambos verdes, a suíte em menos de 30 s (SC-009). Nenhum teste toca a rede
(FR-035) e nenhum espera 5 segundos reais (FR-038, R-011) — se a suíte ficou
perceptivelmente mais lenta, algum teste está exercitando o timeout de verdade em vez de
usar o dublê.

Confirmar que a feature não pediu configuração nova (FR-006, SC-010):

```bash
git diff --stat .env.example package.json    # sem alterações
```

---

## Validação 2 — A ferramenta está exposta e bem descrita (offline)

```bash
npx tsx --disable-warning=ExperimentalWarning -e '
import { createOpsTools } from "./src/agents/tools.ts";
import { InMemoryOpsRepository } from "./src/store/in-memory.ts";
import { baselineState } from "./src/store/seed.ts";
const tools = createOpsTools(new InMemoryOpsRepository(baselineState()));
console.log("ferramentas:", tools.map(t => t.name).join(", "));
const t = tools.find(t => t.name === "check_provider_status");
console.log("\n--- descrição ---\n" + t.description);
console.log("\n--- campo provider ---");
console.log(JSON.stringify(t.schema.shape.provider.description));
'
```

**Esperado**: seis ferramentas listadas, a nova entre elas. Ler a descrição e conferir as 6
regras à mão (FR-028, SC-008), contra a tabela de auditoria em
[`contracts/check-provider-status.md`](./contracts/check-provider-status.md):

1. primeira frase diz o que faz;
2. gatilhos na linguagem do plantão — "é o nosso ou do provedor?" (FR-029);
3. fronteira explícita contra `list_alerts` e `list_incidents` (FR-030);
4. diz o que devolve, **incluindo** o caso de falha (FR-031);
5. `provider` tem descrição própria, com valores e padrão (FR-032);
6. `provider` é enum.

Conferir também a fronteira recíproca em `list_alerts` (FR-030, R-015): a descrição dela
deve mencionar `check_provider_status`.

---

## Validação 3 — Comportamento com dublê (offline)

```bash
npx tsx --disable-warning=ExperimentalWarning -e '
import { createOpsTools } from "./src/agents/tools.ts";
import { InMemoryOpsRepository } from "./src/store/in-memory.ts";
import { baselineState } from "./src/store/seed.ts";

function toolWith(fetchImpl) {
  const tools = createOpsTools(new InMemoryOpsRepository(baselineState()), { fetchImpl });
  return tools.find(t => t.name === "check_provider_status");
}
const body = JSON.stringify({ page:{id:"x"}, status:{ indicator:"none", description:"All Systems Operational" }, components:[1,2,3] });

// sucesso, com o default aplicado
console.log("1 default+ok  ->", await toolWith(async () => new Response(body)).invoke({}));

// timeout nas duas tentativas
let n = 0;
const timeout = async () => { n++; throw new DOMException("t", "TimeoutError"); };
console.log("2 timeout     ->", await toolWith(timeout).invoke({ provider: "cloudflare" }), "| tentativas:", n);

// 5xx e depois sucesso: a falha some do retorno
let m = 0;
console.log("3 5xx->ok     ->", await toolWith(async () => (++m === 1 ? new Response("boom", {status:503}) : new Response(body))).invoke({}), "| tentativas:", m);

// 4xx: uma tentativa só
let k = 0;
console.log("4 4xx         ->", await toolWith(async () => { k++; return new Response("nope", {status:404}); }).invoke({}), "| tentativas:", k);

// corpo fora do esquema: uma tentativa só
let j = 0;
console.log("5 inválido    ->", await toolWith(async () => { j++; return new Response("<html>oops</html>"); }).invoke({}), "| tentativas:", j);

// provedor não suportado: rejeitado no esquema, sem chamada
let z = 0;
try { await toolWith(async () => { z++; return new Response(body); }).invoke({ provider: "aws" }); console.log("6 inválido    -> NÃO REJEITOU (falha)"); }
catch (e) { console.log("6 provedor    -> rejeitado:", String(e.message).split("\n")[0], "| chamadas:", z); }
'
```

**Esperado**, linha a linha:

| # | Saída | Requisito |
|---|---|---|
| 1 | `github: operacional — All Systems Operational` | FR-003, FR-024, FR-025 |
| 2 | `cloudflare: não foi possível confirmar o status (…5s, 2 tentativas)`, `tentativas: 2` | FR-009, FR-010, FR-017 |
| 3 | a linha de sucesso, `tentativas: 2` — sem vestígio do 503 | US2 cenário 3, SC-004 |
| 4 | linha de falha, **`tentativas: 1`** | FR-011 |
| 5 | linha de falha "formato inesperado", **`tentativas: 1`** | FR-012, FR-022 |
| 6 | rejeitado com `github`/`cloudflare` na mensagem, **`chamadas: 0`** | FR-004, R-006 |

Três coisas a conferir com atenção:

- **Nenhuma linha de sucesso traz `page` ou `components`** (FR-026): o corpo do dublê tem os
  dois, e o retorno é uma linha.
- **As linhas 2, 4 e 5 começam por "não foi possível confirmar o status"** (FR-019). Se uma
  falha puder ser lida como estado normal, o requisito não está cumprido.
- **A linha 6 é uma exceção, não um retorno.** É o comportamento correto (R-006): a
  validação de esquema do LangChain rejeita antes do corpo da ferramenta, e o `ToolNode`
  converte isso em observação para o agente. Um teste que espere string aqui empurra para
  trocar o enum por `z.string()` — violação do Princípio IV.

---

## Validação 4 — Nenhuma exceção escapa, e o tempo é limitado (offline)

```bash
npx tsx --disable-warning=ExperimentalWarning -e '
import { createOpsTools } from "./src/agents/tools.ts";
import { InMemoryOpsRepository } from "./src/store/in-memory.ts";
import { baselineState } from "./src/store/seed.ts";
const store = new InMemoryOpsRepository(baselineState());
const falhas = [
  ["rede",        async () => { throw new TypeError("fetch failed"); }],
  ["abort",       async () => { throw new DOMException("a", "AbortError"); }],
  ["json ruim",   async () => new Response("{")],
  ["502",         async () => new Response("", { status: 502 })],
  ["vazio",       async () => new Response("")],
  ["erro exótico",async () => { throw new Error("algo inesperado"); }],
];
for (const [nome, fetchImpl] of falhas) {
  const t = createOpsTools(store, { fetchImpl }).find(t => t.name === "check_provider_status");
  const ini = Date.now();
  try { console.log(nome.padEnd(13), "->", await t.invoke({}), `(${Date.now()-ini}ms)`); }
  catch (e) { console.log(nome.padEnd(13), "-> ESCAPOU (falha):", e.name); }
}
'
```

**Esperado**: seis linhas de texto legível, **nenhuma** "ESCAPOU" (FR-015, FR-016, SC-002),
todas rápidas — o dublê rejeita na hora, então nenhuma se aproxima de 5 s. Nenhuma linha
contém rastro de pilha nem caminho de arquivo (FR-020).

> O pior caso real é ~10 s (FR-013, SC-003) — dois timeouts de 5 s. Ele não é exercitado
> aqui de propósito: verificá-lo contra o relógio real é o que tornaria a suíte lenta. O que
> garante o comportamento é o sinal ser criado **por tentativa** (R-003), coberto no teste
> que afirma que nenhum sinal chega abortado ao dublê.

---

## Validação 5 — O agente escolhe a ferramenta certa (precisa de `OPENROUTER_API_KEY`)

```bash
npm run dev
```

Em outro terminal:

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"o deploy tá falhando, isso é nosso ou é o GitHub?"}' | jq -r '.trace[] | select(.type=="action") | .tool'
```

**Esperado**: `check_provider_status` entre as ferramentas usadas — idealmente a primeira
(US4, SC-001). Contraprova, que importa tanto quanto:

```bash
curl -s localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message":"como está o plantão?"}' | jq -r '.trace[] | select(.type=="action") | .tool'
```

**Esperado**: `list_alerts`, e **não** `check_provider_status`. Se o status externo for
consultado aqui, a fronteira da regra 3 não está clara o bastante numa das duas descrições.

---

## Validação 6 — Contra o provedor de verdade (precisa de rede, fora dos portões)

Esta é a única validação que toca a rede. Ela existe porque a suíte, por decisão
constitucional, **não detecta uma mudança de contrato do provedor**
([`contracts/statuspage-api.md`](./contracts/statuspage-api.md)).

```bash
npx tsx --disable-warning=ExperimentalWarning -e '
import { createOpsTools } from "./src/agents/tools.ts";
import { InMemoryOpsRepository } from "./src/store/in-memory.ts";
import { baselineState } from "./src/store/seed.ts";
const tools = createOpsTools(new InMemoryOpsRepository(baselineState()));
const t = tools.find(t => t.name === "check_provider_status");
console.log(await t.invoke({ provider: "github" }));
console.log(await t.invoke({ provider: "cloudflare" }));
'
```

**Esperado**: duas linhas de status reais. Se vier "resposta em formato inesperado" para
ambos os provedores, o payload do statuspage.io mudou e o esquema precisa ser revisto — é
exatamente o sintoma explícito que a validação zod existe para produzir, em vez de um estado
inventado.

---

## Checklist de encerramento

- [ ] `npm run typecheck` e `npm test` verdes, sem rede e sem credencial (FR-039)
- [ ] Suíte continua abaixo de 30 s (SC-009)
- [ ] Nenhuma variável de ambiente nova (FR-006, SC-010)
- [ ] As 6 regras auditadas na ferramenta nova (SC-008)
- [ ] `list_alerts` declara a fronteira contra a ferramenta nova (FR-030, R-015)
- [ ] Nenhuma falha escapa como exceção (SC-002)
- [ ] Máximo de 2 tentativas em todos os cenários (SC-005)
- [ ] Retorno de uma linha, sem o corpo bruto (SC-006)
- [ ] README atualizado com a sexta ferramenta (Princípio III)
