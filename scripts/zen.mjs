#!/usr/bin/env node
// zen — call ANY gateway model over /chat/completions.
//
// THE ESCAPE HATCH described in docs/PLANNER_SETUP.md, Trap 1.
//
// Agent CLIs speak one wire protocol. Codex speaks the OpenAI *Responses* API
// and, as of codex-cli 0.143, only that — it rejects `wire_api = "chat"`. If
// your gateway's /responses shim is broken for some providers (ours returned
// HTTP 400 "messages must not be empty" for every non-OpenAI model), those
// models are unreachable from the CLI. They are NOT broken: the same key on
// /chat/completions returns clean answers.
//
// This has no file access, which makes it useless for planning and ideal for
// review — diff in, findings out. It is also how you get a reviewer from a
// different vendor lineage than the author.
//
// USAGE
//   node scripts/zen.mjs <model> "<prompt>"
//   git diff | node scripts/zen.mjs <model> "Review this diff."
//   node scripts/zen.mjs --list
//
// CONFIG (env, or a gitignored .gateway.env beside this repo's root)
//   ZEN_API_KEY   required
//   ZEN_BASE_URL  default https://opencode.ai/zen/v1
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = process.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1";

// Never inline a key here. Read it from the environment, or from a gitignored
// env file. Accepts a couple of common names so this drops into existing setups.
function loadKey() {
  for (const n of ["ZEN_API_KEY", "OPENCODE_API_KEY", "GATEWAY_KEY"]) {
    if (process.env[n]) return process.env[n];
  }
  for (const f of [".gateway.env", ".opencode.env", ".env.local"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs
      .readFileSync(p, "utf8")
      .match(/^\s*(?:export\s+)?(?:ZEN_API_KEY|OPENCODE_API_KEY|GATEWAY_KEY)\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1];
  }
  return null;
}

const KEY = loadKey();
if (!KEY) {
  console.error("No API key. Set ZEN_API_KEY, or put it in a gitignored .gateway.env.");
  process.exit(1);
}

const args = process.argv.slice(2);

if (args[0] === "--list") {
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await r.json();
  console.log((j.data || j).map((m) => m.id || m.name).sort().join("\n"));
  process.exit(0);
}

const model = args[0];
let prompt = args.slice(1).join(" ");
if (!model) {
  console.error('Usage: node scripts/zen.mjs <model> "<prompt>"    (--list for models)');
  process.exit(1);
}

// Piped stdin is appended, so `git diff | zen <model> "review"` just works.
if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const piped = Buffer.concat(chunks).toString("utf8");
  if (piped.trim()) prompt += `\n\n${piped}`;
}

if (!prompt.trim()) {
  console.error("Empty prompt.");
  process.exit(1);
}

// STREAMING IS NOT OPTIONAL — it is the fix for a real failure.
//
// Node's global fetch (undici) enforces a ~300s HEADERS timeout. A reasoning
// model given a large diff can take longer than that to produce its first
// byte, and the request dies with UND_ERR_HEADERS_TIMEOUT — an unhandled
// TypeError, not an API error. Short prompts return fast and never hit it, so
// this hides until the first real workload.
//
// A streamed response sends headers immediately and keeps the connection
// alive, so the headers timeout never applies. It also prints as it generates,
// which matters when a review takes minutes.
async function call(attempt = 1) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: true }),
  });

  // Transient capacity, not a dead model — two models 503'd then passed on retry.
  if (res.status >= 500 && attempt < 4) {
    console.error(`[zen] ${model} HTTP ${res.status}, retry ${attempt}/3…`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return call(attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`[zen] ${model} HTTP ${res.status}: ${body.slice(0, 400)}`);
    process.exit(1);
  }

  let buf = "";
  let wrote = 0;
  let usage = null;

  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // keep the partial line for the next chunk

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(payload);
      } catch {
        continue; // partial or keep-alive frame
      }
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta;
      // Some models stream the answer as reasoning_content and leave content empty.
      const piece = d?.content || d?.reasoning_content;
      if (piece) {
        process.stdout.write(piece);
        wrote += piece.length;
      }
    }
  }

  process.stdout.write("\n");
  if (!wrote) {
    console.error(`[zen] ${model} streamed no content — treat this as a FAILED run, not an empty finding.`);
    process.exit(1);
  }
  if (usage) console.error(`[zen] ${model} · ${usage.total_tokens} tokens`);
}

await call();
