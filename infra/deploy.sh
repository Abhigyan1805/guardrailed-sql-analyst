#!/usr/bin/env bash
# One-command, idempotent deploy. Usage:
#   AUTH_SECRET=... [GOOGLE_API_KEY=...] ./infra/deploy.sh ghcr.io/<owner>/guardrailed-sql-analyst:<tag>
set -euo pipefail
IMAGE="${1:?image reference required}"
RG="${AZ_RESOURCE_GROUP:-gsa-rg}"
LOC="${AZ_LOCATION:-centralindia}"
: "${AUTH_SECRET:?set AUTH_SECRET}"
PROVIDER="${LLM_PROVIDER:-$([ -n "${GOOGLE_API_KEY:-}" ] && echo gemini || echo offline)}"

az group create -n "$RG" -l "$LOC" -o none
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait
az deployment group create -g "$RG" -f "$(dirname "$0")/main.bicep" -o none \
  --parameters image="$IMAGE" authSecret="$AUTH_SECRET" llmProvider="$PROVIDER" \
               googleApiKey="${GOOGLE_API_KEY:-}" openaiApiKey="${OPENAI_API_KEY:-}" \
               appVersion="${IMAGE##*:}"
az deployment group show -g "$RG" -n main --query properties.outputs.url.value -o tsv
