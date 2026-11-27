#!/bin/bash
# Refresh tests/e2e/shard-weights.json from the most recent
# scripts/gate/15-playwright.sh run.
#
# Each shard of a CI run writes functional-report.json / visual-report.json
# into ci-output/e2e-artifacts/shard-N/. This harvests their per-file
# durations into the committed weights profile that e2e-shard-plan.mjs uses
# to balance shards by time. Run it after any green full CI run; balance
# degrades gracefully between refreshes (new files are weighed by test count).
#
# Usage: ./scripts/e2e/generate-shard-weights.sh [ARTIFACTS_ROOT]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACTS_ROOT="${1:-$PROJECT_ROOT/ci-output/e2e-artifacts}"
OUT="$PROJECT_ROOT/tests/e2e/shard-weights.json"

if ! ls "$ARTIFACTS_ROOT"/shard-*/functional-report.json >/dev/null 2>&1 \
  && ! ls "$ARTIFACTS_ROOT"/shard-*/visual-report.json >/dev/null 2>&1; then
  echo "❌ No Playwright JSON reports under $ARTIFACTS_ROOT"
  echo "   Run ./scripts/gate/15-playwright.sh full first, then re-run this script."
  exit 1
fi

node "$SCRIPT_DIR/e2e-shard-weights.mjs" \
  --artifacts "$ARTIFACTS_ROOT" \
  --out "$OUT" \
  --stamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "✅ Shard weights refreshed. Next scripts/gate/15-playwright.sh run will balance by duration."
