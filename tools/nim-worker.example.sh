#!/usr/bin/env bash
# 🟩 NIM cheap worker — one-shot mechanical file transforms for swarm lanes
# that don't need a full subagent (mass sweeps, helper substitutions,
# boilerplate ports). Doctrine: /coding-legion Phase 3 "cheap mechanical
# lanes"; the orchestrator ALWAYS verifies the output (diff + tsc).
#
# Model: meta/muse-glimmer-30b — auditioned 2026-08-14 on the real sweep
# pattern (replace inline identity lookups with the shared helper while
# preserving each function's null-handling): PERFECT output in ~16s, and it
# also caught the seeded claim-token review bug. Rejected alternative:
# nemotron-3.5-lightning-30b (leaks its reasoning into the content field and
# hallucinated the Convex API — unusable).
#
# KNOWN QUIRK: it sometimes writes `from "convex/server"` where this repo
# needs `from "./_generated/server"` — check imports on every result.
#
# Usage:
#   scripts/nim-worker.sh <file> "<instruction>"          # prints result
#   scripts/nim-worker.sh <file> "<instruction>" --write  # writes in place
# Env: NVIDIA_NIM_WORKER_KEY (get a key at build.nvidia.com)
set -euo pipefail

FILE="${1:?usage: nim-worker.sh <file> \"<instruction>\" [--write]}"
INSTRUCTION="${2:?instruction required}"
WRITE="${3:-}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }

KEY="${NVIDIA_NIM_WORKER_KEY:-${NVIDIA_NIM_API_KEY:-$(grep '^NVIDIA_NIM_WORKER_KEY=' .env.local 2>/dev/null | cut -d= -f2- || true)}}"
[ -n "$KEY" ] || { echo "NVIDIA_NIM_WORKER_KEY not set"; exit 1; }

OUT="$(FILE="$FILE" INSTRUCTION="$INSTRUCTION" KEY="$KEY" node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.env.FILE, "utf8");
  const prompt = `${process.env.INSTRUCTION}\n\nRULES: change ONLY what the instruction requires; preserve every functions existing behavior exactly (return shapes, thrown error messages, auth gates); keep the file style. Return ONLY the complete rewritten file with no markdown fences and no commentary.\n\n${src}`;
  fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + process.env.KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "meta/muse-glimmer-30b", messages: [{ role: "user", content: prompt }],
      temperature: 0.2, top_p: 0.95, max_tokens: 8192, stream: false }),
    signal: AbortSignal.timeout(300000),
  }).then(async (r) => {
    if (!r.ok) { console.error(`ERROR ${r.status}: ${(await r.text()).slice(0,200)}`); process.exit(1); }
    const j = await r.json();
    let out = (j.choices?.[0]?.message?.content ?? "").trim();
    out = out.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");  // strip fences if present
    process.stdout.write(out);
  });
')"

if [ "$WRITE" = "--write" ]; then
  printf '%s\n' "$OUT" > "$FILE"
  echo "wrote $FILE — NOW VERIFY: git diff + typecheck before trusting it."
else
  printf '%s\n' "$OUT"
fi
