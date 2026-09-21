# Quickstart: Servidor MCP do OpsPilot

**Feature**: `006-mcp-server` | **Data**: 2026-09-21

Roteiro de validação ponta a ponta. O comportamento esperado está em
[`contracts/mcp-server.md`](./contracts/mcp-server.md); aqui estão só os passos e o que
observar.

## Pré-requisitos

- Node 22 (`.nvmrc`) e `npm install` feito. A dependência `@modelcontextprotocol/sdk` entra
  nesta feature.
- Nenhuma credencial é necessária.

## 1. Portões offline (obrigatório)

```bash
npm run typecheck
npm test
```

**Esperado**: ambos passam sem rede e sem `.env`. Entre os testes:
- `src/mcp/server.test.ts`: sobe o processo real, confirma `serverInfo.name === "opspilot"`
  e exatamente `list_alerts`, `list_incidents`, `open_incident`, `resolve_incident`; captura
  o stdout bruto de uma sessão e confirma que só há JSON-RPC; confirma que `OPSPILOT_DB=""`
  sai com código 1, causa no stderr e stdout vazio.
- `src/mcp/ops-mcp-server.test.ts`: descrição e `inputSchema` iguais aos da definição
  interna; execução com inspeção do estado; `isError` em erro de domínio.
- `src/agents/tools.test.ts`: passa **sem nenhuma alteração** (prova de que a extração da
  fonte única não mudou o agente interno).

## 2. Stdout limpo, manualmente

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| OPSPILOT_DB=":memory:" npm run --silent mcp 2>/dev/null
```

**Esperado**: exatamente duas linhas no stdout, as duas JSON (`id: 1` com
`serverInfo.name: "opspilot"`, `id: 2` com as 4 ferramentas). O processo termina sozinho
quando o `printf` fecha o stdin.

**Contraprova do R-006**: repita sem `--silent` e observe o cabeçalho do npm antes do JSON.
É por isso que toda configuração de cliente usa `--silent`.

## 3. Diagnóstico vai para o stderr

```bash
OPSPILOT_DB="" npm run --silent mcp </dev/null >/tmp/opspilot-out.txt; echo "exit=$?"; wc -c </tmp/opspilot-out.txt
```

**Esperado**: `OPSPILOT_DB inválida: ...` no terminal (stderr), `exit=1`, `0` bytes no
stdout.

## 4. Inspector oficial (opcional, usa rede para baixar o inspector)

```bash
npx @modelcontextprotocol/inspector npm --prefix "$PWD" run --silent mcp
```

**Esperado**: servidor `opspilot` conectado. Em *Tools*, as 4 ferramentas com as descrições
em português do agente interno. Chamar `list_alerts` sem argumentos devolve os alertas
`firing` do seed. Chamar `resolve_incident` com `id: "inc-nope"` devolve resultado marcado
como erro, com `{"error": ...}`, e a sessão continua.

## 5. Estado compartilhado com a API HTTP (opcional)

1. Terminal A: `npm run dev` (usa `./data/opspilot.db`).
2. No cliente MCP (passo 4): `open_incident` com `service: "checkout"`, `severity: "high"`.
3. Terminal B: pergunte ao agente pelo `POST /chat` (ver README, seção "API HTTP"):
   "quais incidentes estão abertos?".

**Esperado**: o incidente aberto pelo MCP aparece (SC-007).

## 6. Registrar num cliente MCP

Use o bloco de exemplo de [`contracts/mcp-server.md`](./contracts/mcp-server.md#exemplo-de-registro-em-cliente),
com o caminho absoluto do repositório. Para o Claude Code:

```bash
claude mcp add opspilot -- npm --prefix "$PWD" run --silent mcp
```
