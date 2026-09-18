import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IncidentAlreadyResolvedError,
  IncidentNotFoundError,
  ServiceNotFoundError,
} from "../domain/errors.ts";
import { severitySchema, serviceTierSchema, alertStatusSchema, incidentStatusSchema } from "../domain/schemas.ts";
import type { WorldState } from "./types.ts";
import { SqliteOpsStore } from "./sqlite-ops-store.ts";
import { seedDatabase } from "./sqlite-schema.ts";
import { baselineState } from "./seed.ts";

/** A tiny scenario made up in the test, decoupled from the real seed.json (R-005). */
function minimalState(): WorldState {
  return {
    services: [{ id: "checkout", name: "Checkout", tier: "tier-1" }],
    alerts: [
      {
        id: "alert-1",
        serviceId: "checkout",
        summary: "Erro acima do limiar",
        severity: "high",
        status: "firing",
        firedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
    incidents: [],
    runbooks: [
      { serviceId: "checkout", title: "Checkout fora do ar", steps: ["Passo 1", "Passo 2"] },
    ],
  };
}

// --- T015: ida-e-volta de datas (R-003) ---------------------------------

describe("conversão de datas (R-003)", () => {
  it("openedAt sobrevive à escrita e à leitura sem perda de precisão", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const before = store.openIncident({ title: "t", serviceId: "checkout", severity: "high" });
    assert.ok(before.openedAt instanceof Date);
    assert.ok(!Number.isNaN(before.openedAt.getTime()));

    const reread = store.getIncident(before.id);
    assert.ok(reread);
    assert.equal(reread!.openedAt.getTime(), before.openedAt.getTime());
  });

  it("resolvedAt é null enquanto aberto e uma Date válida depois de resolvido", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const opened = store.openIncident({ title: "t", serviceId: "checkout", severity: "high" });
    assert.equal(opened.resolvedAt, null);

    const resolved = store.resolveIncident(opened.id);
    assert.ok(resolved.resolvedAt instanceof Date);
    assert.ok(!Number.isNaN(resolved.resolvedAt!.getTime()));
  });

  it("nenhuma coluna de data obrigatória fica NULL (rede do NOT NULL)", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());
    store.openIncident({ title: "t", serviceId: "checkout", severity: "high" });

    const row = db.prepare("SELECT opened_at FROM incidents").get() as { opened_at: unknown };
    assert.equal(typeof row.opened_at, "string");
    assert.ok((row.opened_at as string).length > 0);
  });
});

// --- T016: seed idempotente -----------------------------------------------

describe("seed idempotente (FR-026, FR-027)", () => {
  it("semear 3x deixa o cenário canônico no mesmo estado, sem duplicatas", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db); // aplica o DDL
    const state = baselineState();
    seedDatabase(db, state);
    seedDatabase(db, state);
    seedDatabase(db, state);

    const services = db.prepare("SELECT COUNT(*) c FROM services").get() as { c: number };
    const alerts = db.prepare("SELECT COUNT(*) c FROM alerts").get() as { c: number };
    const runbooks = db.prepare("SELECT COUNT(*) c FROM runbooks").get() as { c: number };
    const firing = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'firing'").get() as { c: number };
    const resolved = db.prepare("SELECT COUNT(*) c FROM alerts WHERE status = 'resolved'").get() as {
      c: number;
    };

    assert.equal(services.c, 5);
    assert.equal(alerts.c, 6);
    assert.equal(runbooks.c, 3);
    assert.equal(firing.c, 3);
    assert.equal(resolved.c, 3);
  });

  it("um incidente aberto antes do seed sobrevive a uma nova rodada de seed", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, baselineState());

    const created = store.openIncident({ title: "Fora do ar", serviceId: "checkout", severity: "critical" });

    seedDatabase(db, baselineState());

    const stillThere = store.getIncident(created.id);
    assert.ok(stillThere);
    assert.equal(stillThere!.status, "open");
  });
});

// --- T017: CHECK e chave estrangeira ---------------------------------------

describe("restrições do banco (FR-018, FR-019, SC-004)", () => {
  function seededDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db); // aplica o DDL
    seedDatabase(db, minimalState());
    return db;
  }

  it("rejeita tier fora do conjunto", () => {
    const db = seededDb();
    assert.throws(
      () => db.prepare("INSERT INTO services (id, name, tier) VALUES (?, ?, ?)").run("novo", "Novo", "tier-9"),
      /CHECK constraint failed/,
    );
  });

  it("rejeita severity fora do conjunto (incidents)", () => {
    const db = seededDb();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO incidents (id, title, service_id, severity, status, opened_at) VALUES (?,?,?,?,?,?)",
          )
          .run("x", "t", "checkout", "urgentissimo", "open", new Date().toISOString()),
      /CHECK constraint failed/,
    );
  });

  it("rejeita status fora do conjunto (incidents)", () => {
    const db = seededDb();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO incidents (id, title, service_id, severity, status, opened_at) VALUES (?,?,?,?,?,?)",
          )
          .run("y", "t", "checkout", "high", "meio-aberto", new Date().toISOString()),
      /CHECK constraint failed/,
    );
  });

  it("rejeita status fora do conjunto (alerts)", () => {
    const db = seededDb();
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO alerts (id, service_id, summary, severity, status, fired_at) VALUES (?,?,?,?,?,?)")
          .run("a9", "checkout", "s", "high", "acked", new Date().toISOString()),
      /CHECK constraint failed/,
    );
  });

  it("rejeita service_id inexistente por chave estrangeira", () => {
    const db = seededDb();
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO incidents (id, title, service_id, severity, status, opened_at) VALUES (?,?,?,?,?,?)",
          )
          .run("z", "t", "nao-existe", "high", "open", new Date().toISOString()),
      /FOREIGN KEY constraint failed/,
    );
  });
});

// --- T018: sincronia CHECK <-> enum zod (R-007) -----------------------------

describe("sincronia entre CHECK do banco e enums zod (R-007)", () => {
  function checkValuesFor(db: DatabaseSync, table: string, column: string): Set<string> {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string };
    // Extrai o conteúdo de `CHECK (<column> IN (...))` para a coluna pedida.
    const re = new RegExp(`CHECK \\(${column} IN \\(([^)]+)\\)\\)`);
    const match = re.exec(row.sql);
    assert.ok(match, `CHECK não encontrado para ${table}.${column}`);
    return new Set(
      match![1]!
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, "")),
    );
  }

  it("services.tier bate com serviceTierSchema", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db);
    assert.deepEqual(checkValuesFor(db, "services", "tier"), new Set(serviceTierSchema.options));
  });

  it("incidents.severity e alerts.severity batem com severitySchema", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db);
    assert.deepEqual(checkValuesFor(db, "incidents", "severity"), new Set(severitySchema.options));
    assert.deepEqual(checkValuesFor(db, "alerts", "severity"), new Set(severitySchema.options));
  });

  it("incidents.status bate com incidentStatusSchema", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db);
    assert.deepEqual(checkValuesFor(db, "incidents", "status"), new Set(incidentStatusSchema.options));
  });

  it("alerts.status bate com alertStatusSchema", () => {
    const db = new DatabaseSync(":memory:");
    new SqliteOpsStore(db);
    assert.deepEqual(checkValuesFor(db, "alerts", "status"), new Set(alertStatusSchema.options));
  });
});

// --- T019: CRUD e erros de domínio -----------------------------------------

describe("CRUD e erros de domínio (FR-012, invariantes C4-C6)", () => {
  it("abre um incidente para um serviço existente", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const incident = store.openIncident({ title: "Checkout fora do ar", serviceId: "checkout", severity: "critical" });
    assert.equal(incident.status, "open");
    assert.equal(incident.serviceId, "checkout");
    assert.ok(incident.id.startsWith("inc-"));
  });

  it("abrir incidente com serviço inexistente lança ServiceNotFoundError e nada é gravado", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    assert.throws(
      () => store.openIncident({ title: "t", serviceId: "nao-existe", severity: "high" }),
      ServiceNotFoundError,
    );
    const count = db.prepare("SELECT COUNT(*) c FROM incidents").get() as { c: number };
    assert.equal(count.c, 0);
  });

  it("resolve um incidente aberto", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const opened = store.openIncident({ title: "t", serviceId: "checkout", severity: "high" });
    const resolved = store.resolveIncident(opened.id);
    assert.equal(resolved.status, "resolved");
    assert.ok(resolved.resolvedAt instanceof Date);
  });

  it("resolver de novo lança IncidentAlreadyResolvedError e não sobrescreve resolvedAt", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const opened = store.openIncident({ title: "t", serviceId: "checkout", severity: "high" });
    const firstResolve = store.resolveIncident(opened.id);

    assert.throws(() => store.resolveIncident(opened.id), IncidentAlreadyResolvedError);

    const stillSame = store.getIncident(opened.id);
    assert.equal(stillSame!.resolvedAt!.getTime(), firstResolve.resolvedAt!.getTime());
  });

  it("resolver id inexistente lança IncidentNotFoundError", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    assert.throws(() => store.resolveIncident("inc-nao-existe"), IncidentNotFoundError);
  });

  it("listAlerts filtra por status e sem argumento devolve todos", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, baselineState());

    assert.equal(store.listAlerts().length, 6);
    assert.equal(store.listAlerts("firing").length, 3);
    assert.equal(store.listAlerts("resolved").length, 3);
  });

  it("findService devolve undefined para id inexistente", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    assert.equal(store.findService("nao-existe"), undefined);
    assert.equal(store.findService("checkout")?.tier, "tier-1");
  });

  it("findService valida a linha lida pelo esquema de domínio, não apenas converte (FR-023)", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());
    // Insere uma linha que o CHECK de tier não barra, mas que viola uma
    // regra do domínio que só o zod conhece (id não é um slug minúsculo).
    db.prepare("INSERT INTO services (id, name, tier) VALUES (?, ?, ?)").run("ID INVÁLIDO", "x", "tier-1");

    assert.throws(() => store.findService("ID INVÁLIDO"), /id must be a lowercase slug/);
  });
});

// --- T020: persistência entre aberturas (FR-040) ----------------------------

describe("persistência entre aberturas de conexão (FR-040)", () => {
  it("o que uma conexão grava, outra conexão sobre o mesmo arquivo lê de volta", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "opspilot-test-"));
    const dbPath = path.join(dir, "test.db");
    try {
      const db1 = new DatabaseSync(dbPath);
      const store1 = new SqliteOpsStore(db1);
      seedDatabase(db1, minimalState());
      const created = store1.openIncident({ title: "Persistente", serviceId: "checkout", severity: "high" });
      db1.close();

      const db2 = new DatabaseSync(dbPath);
      const store2 = new SqliteOpsStore(db2);
      const reread = store2.getIncident(created.id);
      assert.ok(reread);
      assert.equal(reread!.title, "Persistente");
      assert.equal(reread!.openedAt.getTime(), created.openedAt.getTime());
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- T021: texto hostil -----------------------------------------------------

describe("texto com aspas e caracteres especiais (FR-022, SC-005)", () => {
  it("é gravado e lido de volta idêntico, sem alterar a estrutura da consulta", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const hostile = "Erro 'grave'; DROP TABLE incidents; --";
    store.openIncident({ title: hostile, serviceId: "checkout", severity: "high" });

    const rows = db.prepare("SELECT * FROM incidents").all();
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { title: string }).title, hostile);
  });
});

// --- T030: listIncidents (FR-028, invariantes C2, C3, C10) -----------------

describe("listIncidents", () => {
  function seededStore(): SqliteOpsStore {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());
    return store;
  }

  it("sem argumento devolve TODOS os incidentes (invariante C2 — o default 'open' é da ferramenta, não do repositório)", () => {
    const store = seededStore();
    const open = store.openIncident({ title: "a", serviceId: "checkout", severity: "high" });
    const toResolve = store.openIncident({ title: "b", serviceId: "checkout", severity: "low" });
    store.resolveIncident(toResolve.id);

    const all = store.listIncidents();
    assert.equal(all.length, 2);
    assert.ok(all.some((i) => i.id === open.id));
  });

  it("filtra por 'open' e por 'resolved'", () => {
    const store = seededStore();
    const open = store.openIncident({ title: "a", serviceId: "checkout", severity: "high" });
    const toResolve = store.openIncident({ title: "b", serviceId: "checkout", severity: "low" });
    store.resolveIncident(toResolve.id);

    const openOnly = store.listIncidents("open");
    assert.equal(openOnly.length, 1);
    assert.equal(openOnly[0]!.id, open.id);

    const resolvedOnly = store.listIncidents("resolved");
    assert.equal(resolvedOnly.length, 1);
    assert.equal(resolvedOnly[0]!.id, toResolve.id);
  });

  it("devolve lista vazia quando não há incidente no status pedido, sem lançar (FR-029b, C3)", () => {
    const store = seededStore();
    assert.deepEqual(store.listIncidents("resolved"), []);
    assert.deepEqual(store.listIncidents(), []);
  });

  it("devolve em ordem cronológica estável (C10)", () => {
    const store = seededStore();
    const first = store.openIncident({ title: "primeiro", serviceId: "checkout", severity: "low" });
    const second = store.openIncident({ title: "segundo", serviceId: "checkout", severity: "low" });

    const all = store.listIncidents();
    assert.equal(all[0]!.id, first.id);
    assert.equal(all[1]!.id, second.id);
  });
});

// --- T031: findRunbook (FR-029, FR-023) -------------------------------------

describe("findRunbook", () => {
  it("devolve título e passos na ordem definida para um serviço com runbook", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());

    const runbook = store.findRunbook("checkout");
    assert.ok(runbook);
    assert.equal(runbook!.serviceId, "checkout");
    assert.deepEqual(runbook!.steps, ["Passo 1", "Passo 2"]);
  });

  it("devolve undefined para um serviço existente sem runbook", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, baselineState()); // 'search' e 'notifications' não têm runbook

    assert.equal(store.findRunbook("search"), undefined);
  });

  it("JSON inválido em steps falha na validação zod na leitura, não vira objeto meio-formado (FR-023)", () => {
    const db = new DatabaseSync(":memory:");
    const store = new SqliteOpsStore(db);
    seedDatabase(db, minimalState());
    db.prepare("UPDATE runbooks SET steps = ? WHERE service_id = ?").run("{ isso não é um array", "checkout");

    assert.throws(() => store.findRunbook("checkout"));
  });
});
