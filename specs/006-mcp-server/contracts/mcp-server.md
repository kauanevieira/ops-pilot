# Contract: Servidor MCP `opspilot`

**Feature**: `006-mcp-server` | **Status**: Draft | **Data**: 2026-09-21

Contrato observável do servidor MCP: o que um cliente vê e pode esperar. Mudar qualquer item
abaixo é mudança de comportamento observável e MUST atualizar este arquivo no mesmo conjunto
de mudanças (Princípio III).

## Processo

| Item | Valor |
|---|---|
| Comando | `npm --prefix <caminho-do-repo> run --silent mcp` |
| Script | `tsx --disable-warning=ExperimentalWarning --env-file-if-exists=.env src/mcp/server.ts` |
| Transporte | stdio: JSON-RPC 2.0, uma mensagem por linha |
| Diretório de trabalho | raiz do repositório (garantido pelo `--prefix`) |
| stdout | **exclusivamente** mensagens do protocolo |
| stderr | diagnóstico em texto livre (prontidão, erro de configuração, falha técnica, encerramento) |
| Encerramento | fim do stdin, `SIGINT` ou `SIGTERM` → fecha servidor e banco, sai com código 0 |
| Falha de inicialização | causa no stderr, código de saída 1, stdout vazio |

> ⚠️ **`--silent` é obrigatório.** Sem ele, o próprio npm escreve o cabeçalho do script no
> stdout e corrompe a sessão antes do servidor iniciar (research R-006).

### Ambiente

| Variável | Obrigatória | Default | Uso |
|---|---|---|---|
| `OPSPILOT_DB` | não | `./data/opspilot.db` | O mesmo banco da API HTTP. Vazio (`""`) é erro de inicialização. |

Nenhuma credencial de modelo é lida ou exigida. `.env` é carregado se existir.

## Identificação (`initialize`)

| Campo | Valor |
|---|---|
| `serverInfo.name` | `opspilot` |
| `serverInfo.version` | `version` do `package.json` (hoje `0.1.0`) |
| `capabilities` | `tools` (sem `resources`, `prompts`, `logging` nem `listChanged`) |

## Ferramentas (`tools/list`)

Exatamente estas quatro, nesta forma:

| Nome | Argumentos | Retorno de sucesso (`content[0].text`) |
|---|---|---|
| `list_alerts` | `status?: "firing" \| "resolved" \| "all"` (default `firing`) | JSON: lista de alertas |
| `list_incidents` | `status?: "open" \| "resolved" \| "all"` (default `open`) | JSON: lista de incidentes |
| `open_incident` | `title: string`, `service: string`, `severity: "critical" \| "high" \| "medium" \| "low"` | JSON: incidente criado, `status: "open"` |
| `resolve_incident` | `id: string` | JSON: incidente com `status: "resolved"` e `resolvedAt` |

**Descrições e esquemas não são redefinidos aqui**: são os do contrato de ferramentas já
vigente ([`004-sqlite-persistence/contracts/ops-tools.md`](../../004-sqlite-persistence/contracts/ops-tools.md),
com a emenda de fronteira da 005). O `inputSchema` anunciado é o JSON Schema (draft-07)
gerado a partir do mesmo `z.object` usado pelo agente interno. **Invariante verificada por
teste**: `description` e `inputSchema` de cada ferramenta são iguais, byte a byte e
deep-equal, aos da definição interna (FR-025).

Qualquer outro nome em `tools/call`, inclusive `consultar_runbook` e
`check_provider_status`, é recusado.

## Resultados (`tools/call`)

| Situação | `isError` | `content[0].text` |
|---|---|---|
| Sucesso | ausente/`false` | JSON do domínio, idêntico ao que o agente interno recebe |
| Lista vazia | ausente/`false` | `[]`. Vazio não é erro. |
| Erro de domínio (serviço inexistente, incidente inexistente, já resolvido) | `true` | `{"error":"<mensagem>"}` |
| Argumento inválido | `true` | `MCP error -32602: Input validation error: ...` (gerado pelo SDK, lista os valores aceitos) |
| Ferramenta desconhecida | `true` | `MCP error -32602: Tool <nome> not found` |
| Falha técnica | `true` | mensagem da exceção; causa também registrada no stderr |

Nenhum desses casos encerra a sessão nem o processo. Nenhum é enviado como erro JSON-RPC
de nível de protocolo.

## Estado

O servidor não tem estado próprio. Toda leitura e escrita passa pelo `OpsRepository` sobre
o arquivo de `OPSPILOT_DB`, com as mesmas regras de criação e semeadura idempotente da
API HTTP. Um incidente aberto pelo MCP é visível pela API HTTP na consulta seguinte, e
vice-versa.

**Limitação conhecida**: escritas simultâneas dos dois processos no mesmo instante podem
falhar com `SQLITE_BUSY`, que chega como falha técnica (`isError: true`) e não corrompe
dados (research R-010).

## Exemplo de registro em cliente

```json
{
  "mcpServers": {
    "opspilot": {
      "command": "npm",
      "args": ["--prefix", "/caminho/para/ops-pilot", "run", "--silent", "mcp"]
    }
  }
}
```
