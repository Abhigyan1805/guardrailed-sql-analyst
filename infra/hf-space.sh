#!/usr/bin/env bash
# Create/update the Hugging Face Docker Space from this repo. Idempotent.
#   HF_SPACE=Dratinia/guardrailed-sql-analyst ./infra/hf-space.sh   (uses `hf auth` or HF_TOKEN)
# Secrets (GOOGLE_API_KEY) are NOT set here; add them in the Space settings UI.
set -euo pipefail
SPACE="${HF_SPACE:?set HF_SPACE=<user>/<name>}"
HF="${HF:-hf}"
command -v "$HF" >/dev/null || HF="$HOME/.local/bin/hf"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
rm -rf "$STAGE/eval/reports" "$STAGE/.github" "$STAGE/infra/main.bicep"
# Space config lives in README front-matter; prepend it to the project README.
{
  cat <<FM
---
title: Guardrailed SQL Analyst
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3000
pinned: false
short_description: Plain-English SQL analyst with RLS, AST and cost guardrails
---

FM
  cat "$ROOT/README.md"
} > "$STAGE/README.md"

"$HF" repos create "$SPACE" --repo-type space --space-sdk docker --exist-ok >/dev/null
# Non-secret config. Public demo = mock tenants; per-IP/user/tenant rate limits stay on.
python3 - "$SPACE" <<'PY'
import os, sys, secrets
from huggingface_hub import HfApi
api = HfApi(); sp = sys.argv[1]
for k, v in {"LLM_PROVIDER": "gemini", "ALLOW_MOCK_AUTH": "true", "PER_IP_PER_MIN": "20"}.items():
    api.add_space_variable(sp, k, v)
# Signing key for demo tokens. Rotating it per deploy only invalidates short-lived tokens;
# the UI mints a fresh one. It is never printed.
api.add_space_secret(sp, "AUTH_SECRET", os.environ.get("AUTH_SECRET") or secrets.token_hex(32))
PY
"$HF" upload "$SPACE" "$STAGE" . --repo-type space --commit-message "Deploy ${GITHUB_SHA:-$(git -C "$ROOT" rev-parse --short HEAD)}" >/dev/null
echo "https://huggingface.co/spaces/$SPACE"
