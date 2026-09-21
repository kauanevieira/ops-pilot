#!/usr/bin/env bash
#
# 010-context-measurement (US3, contracts/conversa-longa.md), emendado por
# 011-history-summarization (contracts/conversa-longa.md): conduz uma
# conversa fixa de vários turnos contra o /chat local e imprime, por
# turno, o promptTokens real e a decomposição estimada, incluindo a fonte
# `summary` e se o turno provocou uma sumarização. Precisa do servidor no
# ar com credenciais reais (npm run dev); não faz parte de `npm test`.
#
# Uso:
#   ./scripts/conversa-longa.sh
#   OPSPILOT_URL=http://localhost:4000 ./scripts/conversa-longa.sh

set -euo pipefail

BASE_URL="${OPSPILOT_URL:-http://localhost:3000}"

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "conversa-longa.sh precisa de '$bin' no PATH" >&2
    exit 1
  fi
done

# 16 mensagens fixas de plantão, em ordem. As últimas dependem do
# histórico ("e o runbook dele?", "e o segundo?") para que a conversa
# faça sentido além de só encher a janela. Com a janela de 8 e o resumo
# cumulativo (011), 4 turnos (8 mensagens) já bastam para atingir
# HISTORY_WINDOW (007), e o roteiro segue além disso de propósito
# (FR-020, SC-004 da 010): 16 turnos gravam 32 mensagens, o suficiente
# para duas sumarizações (nos turnos 9 e 13, S4/S6 de contracts/conversa-longa.md).
MESSAGES=(
  "quais alertas críticos estão abertos?"
  "e o runbook do serviço do primeiro alerta?"
  "quais incidentes estão abertos agora?"
  "abre um incidente para o checkout, severidade alta"
  "quais serviços dependem do checkout?"
  "e quais desses estão saudáveis agora?"
  "quem é o responsável pelo checkout?"
  "e pelo pagamento?"
  "quais alertas estão disparando no serviço de pagamento?"
  "algum deles já tem incidente aberto?"
  "resolve o incidente que abrimos no checkout"
  "confirma o status atual do checkout"
  "quais são todos os serviços cadastrados?"
  "algum deles está sem runbook?"
  "resume o que mudou nesta conversa até aqui"
  "isso é tudo por agora, algo mais preocupante?"
)

echo "conversa em ${BASE_URL} (${#MESSAGES[@]} turnos)"
printf '%-5s %12s %9s %8s %9s %8s %8s %9s %8s\n' \
  "turno" "promptTokens" "llmCalls" "est.msg" "est.hist" "est.sum" "est.mem" "est.total" "resumo"

conversation_id=""
turn=0
for message in "${MESSAGES[@]}"; do
  turn=$((turn + 1))

  if [[ -z "$conversation_id" ]]; then
    body=$(jq -n --arg message "$message" '{message: $message}')
  else
    body=$(jq -n --arg message "$message" --arg conversationId "$conversation_id" '{message: $message, conversationId: $conversationId}')
  fi

  set +e
  response=$(curl -sS --fail-with-body -X POST "${BASE_URL}/chat" -H 'content-type: application/json' -d "$body")
  status=$?
  set -e

  if [[ $status -ne 0 ]]; then
    echo "turno ${turn} falhou:" >&2
    echo "$response" >&2
    exit 1
  fi

  conversation_id=$(echo "$response" | jq -r '.conversationId')
  prompt_tokens=$(echo "$response" | jq -r 'if (.metrics.promptTokens != null) then .metrics.promptTokens else "n/d" end')
  llm_calls=$(echo "$response" | jq -r '.metrics.llmCalls')
  est_msg=$(echo "$response" | jq -r '.metrics.contextBreakdown.message')
  est_hist=$(echo "$response" | jq -r '.metrics.contextBreakdown.history')
  est_sum=$(echo "$response" | jq -r '.metrics.contextBreakdown.summary')
  est_mem=$(echo "$response" | jq -r '.metrics.contextBreakdown.memories')
  est_total=$(echo "$response" | jq -r '.metrics.contextBreakdown.total')
  # 011-history-summarization: presente só quando este turno provocou uma
  # sumarização (o evento summarize aparece em trace[0]) — vazio nos demais.
  resumo=$(echo "$response" | jq -r '[.trace[]? | select(.type == "summarize") | .absorbedMessages] | first // "" | if . == "" then "" else "+" + (tostring) end')

  printf '%-5d %12s %9s %8s %9s %8s %8s %9s %8s\n' \
    "$turn" "$prompt_tokens" "$llm_calls" "$est_msg" "$est_hist" "$est_sum" "$est_mem" "$est_total" "$resumo"
done
