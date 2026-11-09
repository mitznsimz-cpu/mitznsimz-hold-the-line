#!/usr/bin/env bash
# The release gate, run from anywhere: game tests, minis tests, then (with --full) the balance report and a stall hunt.
#   tests/run_gate.sh           quick: the game and minis tests (a minute or two)
#   tests/run_gate.sh --full    everything a release has to pass (a good while longer)
# Needs Node 18 or later. The playthroughs on a phone and a desktop are done by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in index.html game.js sim.js pack-core.js modes.js campaign.js motion.js sound.js mitznsimz_minis.js; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
done
for f in *.js tests/*.js; do node --check "$f"; done
echo "Syntax OK"

echo; echo "== Game tests =="
node tests/hold-the-line.test.js

echo; echo "== Minis tests =="
node tests/minis.test.js

if [ "${1:-}" = "--full" ]; then
  echo; echo "== Balance =="
  node tests/balance.js all 10
  echo; echo "== Stall hunt =="
  node tests/stalls.js 40
fi

echo; echo "Gate passed."
