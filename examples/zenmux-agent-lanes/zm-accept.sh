#!/usr/bin/env bash
# zm-accept.sh — deterministic acceptance gate for a ZenMux lane. Costs no model tokens.
# usage: zm-accept.sh -d <dir> -r <base ref> -f "<space-separated allowed path prefixes>" -c "<test command>"
# PASS only if: (1) every changed/new file is under an allowed prefix, (2) tsc is clean, (3) the test command passes.
set -uo pipefail
DIR=""; BASE=""; ALLOW=""; CMD=""
while getopts "d:r:f:c:" o; do case $o in d)DIR=$OPTARG;; r)BASE=$OPTARG;; f)ALLOW=$OPTARG;; c)CMD=$OPTARG;; esac; done
cd "$DIR" || exit 2
BAD=0
CHANGED=$( (git diff --name-only "$BASE"; git ls-files --others --exclude-standard) | sort -u | grep -vE '^(tsconfig\.tsbuildinfo|next-env\.d\.ts|convex/_generated/)')
for f in $CHANGED; do ok=0; for p in $ALLOW; do case "$f" in $p*) ok=1;; esac; done; [ $ok = 1 ] || { echo "OUT-OF-FENCE: $f"; BAD=1; }; done
rm -f tsconfig.tsbuildinfo
npx tsc --noEmit --incremental false -p tsconfig.json >/tmp/zm-tsc.txt 2>&1 && echo "tsc: clean" || { echo "tsc: FAIL"; head -15 /tmp/zm-tsc.txt; BAD=1; }
bash -c "$CMD" >/tmp/zm-test.txt 2>&1 && echo "tests: pass" || { echo "tests: FAIL"; tail -20 /tmp/zm-test.txt; BAD=1; }
[ $BAD = 0 ] && echo "ACCEPT" || echo "REJECT"; exit $BAD
