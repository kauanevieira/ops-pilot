# Contract: registry de estratégias (`src/agents/index.ts`)

**Feature**: `003-chat-http-api` | Satisfies FR-009 a FR-012, FR-022

Ponto único de resolução entre um nome de estratégia e a estratégia correspondente, com a
reflexão aplicada como modificador. Substitui `src/agents/registry.ts`, absorvendo sua
superfície inteira (R-002).

## Interface

```ts
/** A seleção que a API expressa: nome base + reflexão como modificador (FR-010). */
export interface StrategySelection {
  name?: string;      // default: "react" (FR-007)
  reflect?: boolean;  // default: false  (FR-008)
}

export type ResolveStrategy = (
  selection: StrategySelection,
  store: OpsRepository,
) => ReasoningStrategy;

/** Fonte única de verdade do caminho HTTP: validação e mensagem de 422 (FR-011). */
export function baseStrategyNames(): string[];

/** Resolve a seleção. Lança UnknownStrategyError se `name` não for um nome base. */
export const resolveStrategy: ResolveStrategy;

// --- Superfície da arena, preservada sem alteração de comportamento (FR-012) ---

/** Base + reflect:* derivados. Só para a arena; nunca aparece numa resposta HTTP. */
export function availableStrategyNames(): string[];

/** Aceita "react" e "reflect:react". Implementado sobre resolveStrategy. */
export function createStrategy(name: string, store: OpsRepository): ReasoningStrategy;

/** Só as cruas — o padrão da arena sem --strategies. */
export function defaultStrategyNames(): string[];

export { DEFAULT_MAX_ITERATIONS } from "./types.ts";
```

## Regras

1. **Um único mapa base** (`react`, `plan-and-execute`) alimenta as duas superfícies.
   `availableStrategyNames()` continua **derivando** os nomes `reflect:*` do mapa base, e
   não os lista como literais — invariante herdado da 002 (FR-024 de lá), que impede o nome
   registrado de divergir do nome que a estratégia reporta.
2. **`resolveStrategy` aplica `withReflection` quando `reflect` é verdadeiro**, sobre
   qualquer estratégia do mapa base — sem entrada registrada por combinação (FR-010). Uma
   estratégia nova acrescentada ao mapa base fica imediatamente disponível com e sem
   reflexão, pelas duas superfícies, sem alteração no endpoint (SC-008).
3. **`resolveStrategy` não aceita nomes compostos**: `"reflect:react"` lança. Isso é o que
   materializa o edge case de 422 da spec.
4. **`createStrategy` decompõe o prefixo** `reflect:` e delega a `resolveStrategy`, para que
   a arena mantenha exatamente o comportamento e as mensagens de hoje.
5. **Erro de nome desconhecido lista os nomes válidos** — pela superfície correspondente:
   `resolveStrategy` lista `baseStrategyNames()`, `createStrategy` lista
   `availableStrategyNames()`.
6. **Construir não executa**: resolver uma estratégia só monta o objeto; nenhuma chamada de
   modelo acontece antes de `.run()`. É o que mantém os testes do registry offline.

## Ponto de injeção (FR-022)

`resolveStrategy` tem o tipo `ResolveStrategy` justamente para poder ser substituído em
`createApp({ resolveStrategy })`. O substituto do teste devolve uma estratégia falsa e
determinística, definida no próprio arquivo de teste — nada de mentira mora em `src/`
(R-007).

## Migração a partir de `registry.ts`

| Antes | Depois |
|---|---|
| `src/agents/registry.ts` | `src/agents/index.ts` (arquivo movido) |
| `src/agents/registry.test.ts` | `src/agents/index.test.ts` (casos preservados + novos) |
| `import ... from "./agents/registry.ts"` em `arena.ts` | `from "./agents/index.ts"` — **extensão explícita obrigatória**, `./agents` não resolve sob `NodeNext` |
| `bench.ts` | inalterado — importa as fábricas diretamente, não o registry |

Comportamento observável da arena após a migração: idêntico. `npm run arena` sem flags roda
as duas cruas; `--strategies reflect:react` continua válido; a mensagem de erro para nome
inválido continua listando os quatro nomes.
