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

// 5xx from a shared gateway is usually transient capacity, not a dead model —
// two models 503'd and then passed on retry during testing.
async function call(attempt = 1) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });

  if (res.status >= 500 && attempt < 4) {
    console.error(`[zen] ${model} HTTP ${res.status}, retry ${attempt}/3…`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return call(attempt + 1);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`[zen] ${model} HTTP ${res.status}: unparseable response`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  if (!res.ok || json.error) {
    console.error(`[zen] ${model} HTTP ${res.status}: ${json.error?.message ?? text.slice(0, 300)}`);
    process.exit(1);
  }

  const msg = json.choices?.[0]?.message;
  // Some models return the answer in `reasoning_content` and leave `content`
  // empty — print something real instead of "undefined".
  const out = msg?.content || msg?.reasoning_content;
  if (!out) {
    console.error(`[zen] ${model} returned no content. Raw message:`);
    console.error(JSON.stringify(msg).slice(0, 500));
    process.exit(1);
  }
  console.log(out);
  if (json.usage) console.error(`[zen] ${model} · ${json.usage.total_tokens} tokens`);
}

await call();
