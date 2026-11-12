#!/usr/bin/env bash
# The release gate, run from anywhere: game tests, minis tests, then (with --full) the balance report and a stall hunt.
#   tests/run_gate.sh           quick: the game and minis tests (a minute or two)
#   tests/run_gate.sh --full    everything a release has to pass: adds balance, a stall hunt, the browser tests and four short
#                               runs of the play bot (a few minutes; these need Playwright: npm i -D playwright && npx playwright install chromium)
#   For a longer look with the play bot: node tools/playbot.js --runs 8 (and --campaign for the house and the back room)
# Needs Node 18 or later.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in index.html sw.js msdd_materials.js sim.js simz.js pack-core.js modes.js campaign.js motion.js sound.js mitznsimz_minis.js view/core.js view/board.js view/events.js view/draw.js view/motes.js view/floors.js view/plaques.js view/hud.js view/tavern.js view/app.js; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
done
for f in *.js view/*.js tests/*.js tools/*.js; do node --check "$f"; done
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
  echo; echo "== Browser tests =="
  node tests/browser.test.js "${@:2}"   # skipped if Playwright isn't installed; pass --require to make that a failure
  if node -e "require('playwright')" 2>/dev/null; then
    echo; echo "== Play bot =="
    node tools/playbot.js --runs 4 --ticks 450 --jobs 4 --quiet  # two busy players and two steady ones --out "${TMPDIR:-/tmp}/htl-playbot"
  fi
fi

echo; echo "Gate passed."
