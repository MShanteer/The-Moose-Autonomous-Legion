#!/usr/bin/env bash
# zm-lane.sh — run ONE implementation lane as a headless Claude Code agent on a ZenMux FREE model
# (Anthropic-compatible route https://zenmux.ai/api/anthropic). No Claude-account tokens are spent.
# usage: zm-lane.sh -d <worktree dir> -b <brief.md> [-m z-ai/glm-5.3-flash] [-t 60] [-o out.txt] [-k <env file with ZENMUX_API_KEY>]   (default: $ZM_ENV_FILE or ./.env.local — worktrees have none, so pass -k)
# The agent may read/write/edit and run node / tsc / npm run / git status|diff|log. It may NOT commit, push, rm, curl, deploy.
# ALWAYS follow with zm-accept.sh — the output of this script is never trusted on its own.
set -euo pipefail
DIR=""; BRIEF=""; MODEL="z-ai/glm-5.3-flash"; TURNS=60; OUT=""; ENVF="${ZM_ENV_FILE:-$PWD/.env.local}"
while getopts "d:b:m:t:o:k:" o; do case $o in d)DIR=$OPTARG;; b)BRIEF=$OPTARG;; m)MODEL=$OPTARG;; t)TURNS=$OPTARG;; o)OUT=$OPTARG;; k)ENVF=$OPTARG;; esac; done
[ -d "$DIR" ] && [ -f "$BRIEF" ] || { echo "need -d <dir> and -b <brief>"; exit 2; }
case "$MODEL" in deepseek/*) echo "refusing $MODEL: hangs on the Anthropic route (measured 2026-10-14)"; exit 2;; esac
KEY=$(grep '^ZENMUX_API_KEY=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r"'"'")
[ -n "$KEY" ] || { echo "no ZENMUX_API_KEY in $ENVF"; exit 2; }
RULES='STANDING RULES: edit ONLY the files listed in the brief (new files only where named). Do not commit, push, deploy, delete files, or call the network. Write the failing test FIRST, run it, then implement until it passes. Run the typecheck (npx tsc --noEmit --incremental false -p tsconfig.json; delete tsconfig.tsbuildinfo first) before finishing. Finish with a report: files changed, test results (counts), what you did NOT verify. Never claim a test passed unless you ran it and saw it pass.'
cd "$DIR"
export ANTHROPIC_BASE_URL=https://zenmux.ai/api/anthropic ANTHROPIC_AUTH_TOKEN="$KEY" ANTHROPIC_API_KEY="" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1
RES=$(claude -p "$(cat "$BRIEF")

$RULES" --model "$MODEL" --permission-mode acceptEdits \
  --allowedTools "Read Write Edit Glob Grep Bash(node:*) Bash(npx tsc:*) Bash(npm run:*) Bash(git status:*) Bash(git diff:*) Bash(git log:*)" \
  --disallowedTools "Bash(git commit:*) Bash(git push:*) Bash(rm:*) Bash(curl:*) Bash(vercel:*) Bash(npx convex deploy:*)" \
  --max-turns "$TURNS" 2>&1 | sed "s/$KEY/<key>/g") || true
[ -n "$OUT" ] && printf '%s\n' "$RES" > "$OUT"
printf '%s\n' "$RES" | tail -40
