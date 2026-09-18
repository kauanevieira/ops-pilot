# Quickstart: Núcleo de Raciocínio do OpsPilot

**Feature**: `001-reasoning-core` | **Date**: 2026-09-17

Guia de validação: como provar que a feature funciona ponta a ponta depois de
implementada. Não contém código de implementação — ver [contracts/](./contracts/) e
[data-model.md](./data-model.md) para as formas exatas.

---

## Pré-requisitos

1. **Node 22 LTS ou superior** — obrigatório, ver R-010 em [research.md](./research.md).
   Verificar com `node --version`. O ambiente de desenvolvimento atual roda 20.6.0 e
   **precisa ser atualizado antes de implementar**.
2. Dependências instaladas: `npm install`
3. Credenciais do OpenRouter em `.env` (a partir de `.env.example`):

   ```text
   OPENROUTER_API_KEY=<sua chave>
   OPENROUTER_MODEL=<ex.: openai/gpt-4o-mini>
   ```

   `.env` é ignorado pelo git e nunca é lido pelo agente de desenvolvimento — apenas
   pelo runtime, via a flag nativa `--env-file`.

---

## Validação 1 — Portões de qualidade (offline)

Nenhuma credencial nem rede necessária.

```bash
npm run typecheck
npm test
```

**Esperado**: ambos verdes. Os testes cobrem transições do store e formatação de rastro,
e rodam sem tocar em rede ou no modelo (FR-034, FR-035).

**Prova**: rodar `npm test` duas vezes produz resultados idênticos — SC-006.

---

## Validação 2 — Linha de base do estado

```bash
npm run seed
```

**Esperado**: confirmação de 5 serviços e 6 alertas (3 `firing`, 3 `resolved`), 0
incidentes — conforme a tabela em [data-model.md](./data-model.md#linha-de-base-seed).

**Prova de idempotência (SC-007)**: rodar o comando duas vezes deixa exatamente o mesmo
estado, sem duplicar registros.

> **Nota**: com store in-memory (R-008), o estado não sobrevive ao fim do processo. A
> carga inicial é aplicada no início de cada execução que precise da linha de base.

---

## Validação 3 — Estratégia ReAct (User Story 1, P1)

```bash
npm run arena -- "quais alertas estão disparando?" --strategies react
```

**Esperado**:
- Resposta final citando os 3 alertas `firing` (`checkout`, `payments`, `auth`)
- Rastro contendo `thought` → `action list_alerts {"status":"firing"}` → `observation` → `answer`
- Linha de métricas com `llmCalls` e `latencyMs` preenchidos

**Cobre**: acceptance scenarios 1 e 4 da User Story 1; SC-001, SC-002, SC-004.

### Abertura e resolução de incidente

```bash
npm run arena -- "abra um incidente crítico para o checkout e depois resolva ele" --strategies react
```

**Esperado**: rastro com `action open_incident` carregando `title`, `service` e
`severity`, seguido de `action resolve_incident` com o `id` devolvido pela observação
anterior.

**Cobre**: acceptance scenarios 2 e 3 da User Story 1.

---

## Validação 4 — Plan-and-Execute (User Story 2, P2)

```bash
npm run arena -- "levante os alertas disparando e abra um incidente para cada serviço afetado" --strategies plan-and-execute
```

**Esperado**:
- Um evento `plan` com a lista de passos **antes** de qualquer `action`
- Um passo executado por vez, com evento `plan` de revisão entre eles (`revision` incrementando)
- Encerramento com `stoppedReason: completed` quando o plano se esgota

**Cobre**: acceptance scenarios 1, 2 e 3 da User Story 2.

### Teto de 8 passos

```bash
npm run arena -- "<pedido deliberadamente aberto que gere muitos passos>" --strategies plan-and-execute
```

**Esperado**: execução encerra com `stoppedReason: max-steps`, rastro parcial preservado,
sem exceção propagada — FR-028, acceptance scenario 4 da User Story 2.

---

## Validação 5 — Comparação de estratégias (User Story 3, P3)

```bash
npm run arena -- "quais alertas estão disparando?" --strategies react,plan-and-execute
```

**Esperado**: duas seções na saída, uma por estratégia, cada uma com rastro completo e
bloco de métricas próprio — SC-005.

### Limite de iterações

```bash
npm run arena -- "<pedido multi-etapa>" --strategies react --max-iterations 1
```

**Esperado**: encerramento controlado com `stoppedReason: max-iterations` e rastro
parcial; **não** é erro — FR-005, SC-003.

### Nome de estratégia inválido

```bash
npm run arena -- "teste" --strategies nao-existe
```

**Esperado**: erro listando os nomes válidos, código de saída diferente de zero, e
nenhuma estratégia executada — FR-033.

---

## Validação 6 — Configuração ausente

```bash
OPENROUTER_API_KEY= npm run arena -- "teste" --strategies react
```

**Esperado**: falha imediata nomeando a variável ausente, antes de qualquer tentativa de
raciocínio — FR-010.

---

## Checklist de aceitação da feature

- [ ] `npm run typecheck` e `npm test` verdes
- [ ] Testes rodam sem rede e são determinísticos em execuções repetidas
- [ ] Carga inicial produz a linha de base e é idempotente
- [ ] ReAct resolve pedido de leitura e pedido de escrita, com rastro completo
- [ ] Plan-and-Execute registra plano inicial e revisões, um passo por vez
- [ ] Teto de 8 passos e limite de iterações encerram sem exceção
- [ ] Arena compara duas estratégias numa invocação
- [ ] Nome de estratégia inválido falha sem executar nada
- [ ] Toda `action` do rastro mostra ferramenta e argumentos
