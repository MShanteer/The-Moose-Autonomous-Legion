#!/usr/bin/env bash
# Second-reviewer example: pipe your working-tree diff to a free NVIDIA
# NIM-hosted model for an adversarial review pass (Phase 5 reviewer
# diversity). Generic version of the script running in production at MTS.
#
# BEFORE TRUSTING ANY REVIEWER, AUDITION IT (see SKILL.md Phase 5):
# hand it a diff whose ground-truth defect a trusted reviewer already
# caught, and measure catch / miss / hallucination. Our audition:
# z-ai/glm-5.2 caught a real claim-token overwrite race in ~5s and wrote
# correct Convex code zero-shot; nemotron-3-super-120b caught the same
# race in thinking mode but hallucinated framework APIs on codegen —
# so: GLM reviews and drafts, nemotron reviews only, neither ships alone.
#
# Setup: export NVIDIA_NIM_API_KEY (get one at build.nvidia.com).
# Free tier allows 1 concurrent request per key — keep calls serial.
set -euo pipefail

KEY="${NVIDIA_NIM_API_KEY:?export NVIDIA_NIM_API_KEY first}"
MODEL="${NIM_REVIEW_MODEL:-z-ai/glm-5.2}"
PROMPT="${1:-Review this git diff as a strict second reviewer for likely bugs, security issues, concurrency races, and framework-API misuse. Report ONLY findings you are confident are real (file + one-sentence failure sequence), prioritized. If none: CLEAN. If the codebase's datastore has serializable transactions, do not report intra-transaction read-modify-write races.}"

DIFF="$(git diff -- .)"
[ -n "$DIFF" ] || DIFF="$(git diff --cached -- .)"
[ -n "$DIFF" ] || { echo "no diff to review"; exit 0; }

DIFF="$DIFF" NIM_PROMPT="$PROMPT" MODEL="$MODEL" KEY="$KEY" node -e '
  const body = {
    model: process.env.MODEL, stream: false, temperature: 0.6, top_p: 0.95, max_tokens: 4096,
    messages: [{ role: "user", content: process.env.NIM_PROMPT + "\n\n" + process.env.DIFF.slice(0, 180000) }],
  };
  const t0 = Date.now();
  fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
  }).then(async (r) => {
    if (!r.ok) { console.error(`ERROR ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1); }
    const j = await r.json();
    console.log(`───── ${process.env.MODEL} (${Date.now() - t0}ms) ─────`);
    console.log((j.choices?.[0]?.message?.content ?? "").trim());
  });
'
