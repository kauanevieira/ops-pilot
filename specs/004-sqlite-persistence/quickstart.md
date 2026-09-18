# Quickstart: validar a persistência real de operações

**Feature**: `004-sqlite-persistence` | **Fase**: 1 | **Data**: 2026-09-18

Roteiro de validação da feature implementada. As validações **1 a 5 são offline** — sem
credencial, sem rede, sem chamada de modelo. As **6 e 7 precisam de `OPENROUTER_API_KEY`**,
porque exercitam o agente de verdade.

Detalhes de esquema, statements e descrições estão nos
[contratos](./contracts/); este documento é o roteiro de execução.

## Pré-requisitos

```bash
nvm use            # Node 22 LTS (.nvmrc)
npm install        # sequelize e mysql2 saem nesta feature (R-019)
```

---

## Validação 1 — Portões de qualidade (offline)

```bash
npm run typecheck
npm test
```

**Esperado**: ambos verdes. A suíte roda em menos de 30 s (SC-009) e cobre, entre outros:
seed idempotente, abrir/listar/resolver incidente, os três filtros de status, rejeição por
`CHECK`, ida-e-volta de datas, persistência entre aberturas e as 5 ferramentas sobre
`':memory:'`.

**Verificar também** (FR-032, SC-009):

```bash
git status --short          # nenhum arquivo novo
ls data/ 2>/dev/null        # a suíte NÃO cria data/
```

Se `data/` apareceu depois de `npm test`, algum teste está abrindo um caminho de arquivo em
vez de `':memory:'` — ver R-016.

---

## Validação 2 — Seed e idempotência (offline)

```bash
rm -rf data/                # começar do zero
npm run seed
npm run seed
npm run seed
```

**Esperado**: as três execuções reportam o mesmo cenário — 5 serviços, 6 alertas (3 firing,
3 resolved), 3 runbooks —, `data/opspilot.db` existe, e nada foi duplicado (FR-026, SC-003).

**Conferir por dentro**, sem instalar nada:

```bash
node --disable-warning=ExperimentalWarning -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('./data/opspilot.db');
for (const t of ['services','alerts','incidents','runbooks'])
  console.log(t, db.prepare(\`SELECT COUNT(*) c FROM \${t}\`).get().c);
"
```

**Esperado**: `services 5`, `alerts 6`, `incidents 0`, `runbooks 3`.

**E a pasta é criada sozinha** (FR-006):

```bash
rm -rf data/ && npm run seed && ls data/opspilot.db
```

---

## Validação 3 — As restrições do banco de fato pegam (offline)

Grava direto no banco, contornando a validação de aplicação — é o ponto do teste
(FR-018, SC-004):

```bash
node --disable-warning=ExperimentalWarning -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('./data/opspilot.db');
const tent=(rot,fn)=>{try{fn();console.log('❌',rot,'PASSOU — não deveria')}catch(e){console.log('✅',rot,'—',e.message)}};
tent('severidade inválida',()=>db.prepare('INSERT INTO incidents (id,title,service_id,severity,status,opened_at) VALUES (?,?,?,?,?,?)')
  .run('x','t','checkout','urgentissimo','open',new Date().toISOString()));
tent('status inválido',()=>db.prepare('INSERT INTO incidents (id,title,service_id,severity,status,opened_at) VALUES (?,?,?,?,?,?)')
  .run('y','t','checkout','high','meio-aberto',new Date().toISOString()));
tent('serviço inexistente',()=>db.prepare('INSERT INTO incidents (id,title,service_id,severity,status,opened_at) VALUES (?,?,?,?,?,?)')
  .run('z','t','nao-existe','high','open',new Date().toISOString()));
tent('tier inválido',()=>db.prepare('INSERT INTO services VALUES (?,?,?)').run('novo','Novo','tier-9'));
"
```

**Esperado**: quatro ✅ — três `CHECK constraint failed` e um `FOREIGN KEY constraint failed`.
Qualquer ❌ significa que a restrição correspondente não chegou ao DDL, ou que o pragma de
chave estrangeira não está ligado (R-008).

---

## Validação 4 — Nenhum SQL concatenado (offline)

```bash
grep -rn "prepare(" src/store/ | grep -E '\$\{|\+ *[a-zA-Z_]|`.*\$' || echo "✅ nenhum SQL montado dinamicamente"
```

**Esperado**: a mensagem de sucesso (FR-021, FR-022, SC-005). Qualquer ocorrência é um
statement sendo montado em tempo de execução — inclusive o filtro condicional de status, que
deve ser dois statements fixos (R-013).

**E o teste de injeção, pelo caminho normal**:

```bash
node --disable-warning=ExperimentalWarning --import tsx -e "
import { openDatabase } from './src/store/db.ts';
import { SqliteOpsStore } from './src/store/sqlite-ops-store.ts';
const store = new SqliteOpsStore(openDatabase(':memory:'));
// título com aspas, ponto-e-vírgula e um DROP TABLE dentro
const t = \"Erro 'grave'; DROP TABLE incidents; --\";
store.openIncident({ title: t, serviceId: 'checkout', severity: 'high' });
const lidos = store.listIncidents();
console.log(lidos.length === 1 && lidos[0].title === t ? '✅ gravado e lido idêntico' : '❌ divergiu');
console.log('✅ tabela intacta:', store.listIncidents().length, 'incidente(s)');
"
```

Requer o seed do banco em memória — se o store não semeia sozinho, semeie antes.

---

## Validação 5 — Durabilidade entre processos (offline)

O coração da feature (FR-001, SC-001). Dois processos separados, o mesmo arquivo:

```bash
npm run seed

# Processo 1: abre um incidente
node --disable-warning=ExperimentalWarning --import tsx -e "
import { openDatabase } from './src/store/db.ts';
import { SqliteOpsStore } from './src/store/sqlite-ops-store.ts';
const s = new SqliteOpsStore(openDatabase());
const i = s.openIncident({ title: 'Checkout fora do ar', serviceId: 'checkout', severity: 'critical' });
console.log('aberto:', i.id, i.openedAt.toISOString());
s.close();
"

# Processo 2: outro processo, mesmo arquivo
node --disable-warning=ExperimentalWarning --import tsx -e "
import { openDatabase } from './src/store/db.ts';
import { SqliteOpsStore } from './src/store/sqlite-ops-store.ts';
const s = new SqliteOpsStore(openDatabase());
const abertos = s.listIncidents('open');
console.log('em aberto:', abertos.length);
console.log(abertos.map(i => \`\${i.id} | \${i.title} | \${i.openedAt.toISOString()}\`).join('\n'));
s.close();
"
```

**Esperado**: o processo 2 lista o incidente do processo 1, com **o mesmo id e o mesmo
horário de abertura**.

⚠️ **Se `openedAt` vier nulo ou inválido, é o bug do R-003**: alguma data está sendo passada
como `Date` a um parâmetro ligado e gravada como `NULL` em silêncio. O `NOT NULL` do DDL
deveria ter transformado isso em exceção — confira se a coluna o declara.

**E o seed não destrói o trabalho** (FR-027):

```bash
npm run seed
# repita o processo 2 acima
```

**Esperado**: o incidente continua lá.

---

## Validação 6 — As ferramentas novas pela conversa (precisa de credencial)

```bash
npm run arena -- "quais incidentes estão em aberto?" --strategies react
npm run arena -- "o que eu faço se o checkout cair?" --strategies react
npm run arena -- "tem runbook pro search?" --strategies react
```

**Esperado** (SC-006, FR-029a):

1. O rastro mostra **uma** chamada a `list_incidents` — não a `list_alerts`, e não as duas.
2. O rastro mostra `consultar_runbook` com `service: "checkout"` e a resposta traz os passos
   na ordem.
3. O `search` existe e não tem runbook: a resposta diz que não há procedimento escrito, **sem
   sugerir que o serviço não existe**.

⚠️ **Atenção à arena**: ela roda no store in-memory por decisão (R-014), então os incidentes
abertos aqui **não** persistem. Para validar persistência, use a Validação 5 ou a 7.

**Teste da fronteira que mais importa** — o pedido ambíguo que não pede escrita:

```bash
npm run arena -- "como está o plantão?" --strategies react
```

**Esperado**: o modelo **consulta** e não abre incidente nenhum. É a dívida do `open_incident`
(FR-035) sendo cobrada: se aparecer um `open_incident` no rastro, a Regra 3 da descrição não
está fazendo efeito.

---

## Validação 7 — Ponta a ponta pela API, com durabilidade (precisa de credencial)

```bash
npm run dev
```

Noutro terminal:

```bash
curl -s -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"message":"abra um incidente critical no checkout: erro 500 acima do limiar"}' | head -c 400
echo

curl -s -X POST http://localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"message":"quais incidentes estão em aberto?"}' | head -c 400
```

Agora **reinicie o servidor** (`Ctrl-C`, `npm run dev`) e repita a segunda chamada.

**Esperado** (SC-001): o incidente continua lá depois do reinício. Antes desta feature, ele
teria sumido — é a diferença que ela entrega.

---

## Resumo

| # | Valida | Precisa de credencial | Requisitos |
|---|---|:---:|---|
| 1 | Portões e ausência de rastro em disco | não | FR-032, FR-033, FR-038, SC-009 |
| 2 | Seed idempotente, criação da pasta | não | FR-006, FR-024 a FR-026, SC-003 |
| 3 | `CHECK` e chave estrangeira aplicados | não | FR-018, FR-019, SC-004 |
| 4 | Zero SQL dinâmico, resistência a injeção | não | FR-021, FR-022, SC-005 |
| 5 | Durabilidade entre processos; seed preserva incidentes | não | FR-001, FR-027, FR-040, SC-001 |
| 6 | Ferramentas novas e fronteiras das descrições | **sim** | FR-028, FR-029a, FR-035, SC-006 |
| 7 | Durabilidade ponta a ponta pela API | **sim** | FR-010, SC-001 |
