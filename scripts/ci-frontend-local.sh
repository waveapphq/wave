#!/bin/bash
# Frontend tests and coverage gate in the wave-ci image; the fast checks run in ci-checks-local.sh.
#
# Usage: ./scripts/ci-frontend-local.sh
# WAVE_CI_PROGRESS_SECONDS sets the seconds between progress lines (default 60).

# No set -e: we track failures manually

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"
OUTPUT_DIR="$PROJECT_ROOT/ci-output"
LOG_FILE="$OUTPUT_DIR/ci-frontend.log"
FAILED=()

mkdir -p "$OUTPUT_DIR"

CI_START_EPOCH=$(date +%s)
format_duration() {
  local total=$1
  local h=$((total / 3600))
  local m=$(((total % 3600) / 60))
  local s=$((total % 60))
  if [ "$h" -gt 0 ]; then
    printf '%dh %dm %ds (%ds total)' "$h" "$m" "$s" "$total"
  else
    printf '%dm %ds (%ds total)' "$m" "$s" "$total"
  fi
}
print_duration() {
  local end_epoch=$(date +%s)
  local elapsed=$((end_epoch - CI_START_EPOCH))
  echo ""
  echo "⏱️  Frontend CI total duration: $(format_duration "$elapsed")"
  echo "Log: $LOG_FILE"
}
trap print_duration EXIT

# Tee all output (stdout + stderr) to log file
exec > >(tee "$LOG_FILE") 2>&1

echo "🚀 Running Frontend CI locally with Podman..."
echo "Project root: $PROJECT_ROOT"
echo "Log: $LOG_FILE"
echo ""

if ! podman image exists "$IMAGE_NAME"; then
  echo "❌ CI image not found: $IMAGE_NAME"
  echo ""
  echo "Please build the CI image first:"
  echo "  ./scripts/build-ci-image.sh"
  echo ""
  exit 1
fi

echo "🔧 Running frontend tests with coverage in container..."
echo "Image: $IMAGE_NAME (dependencies pre-installed)"
echo "════════════════════════════════════════════"
echo ""

# The clone is mounted here, so this uses the node_modules from npm ci on the host
# --userns=keep-id maps the host user to ciuser in container for proper permissions
CONTAINER_START=$(date +%s)
podman run --rm \
  --userns=keep-id \
  -v "$PROJECT_ROOT:/workspace" \
  -e WAVE_CI_PROGRESS_SECONDS="${WAVE_CI_PROGRESS_SECONDS:-60}" \
  -w /workspace/frontend \
  "$IMAGE_NAME" \
  bash -c '
# Capture stderr to detect warnings that vitest does not fail on
# --bail stops on first test failure for fast feedback
STDERR_FILE=$(mktemp)
echo "✅ Running tests with coverage..."
TESTS_START=$(date +%s)
npm run test:coverage -- --run --reporter=./scripts/vitest-progress-reporter.mjs --bail 1 2> >(tee "$STDERR_FILE" >&2)
TEST_EXIT=$?
echo "⏱️  Vitest + v8 coverage: $(( $(date +%s) - TESTS_START ))s"

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ Tests failed with exit code $TEST_EXIT"
  rm -f "$STDERR_FILE"
  exit 1
fi

# Unexpected stderr fails CI; npm notices, Node experimental warnings and React Flow act() notices are benign.
FILTERED_STDERR=$(grep -v -E "^(npm WARN|npm notice|ExperimentalWarning)|FlowRenderer|not wrapped in act|fire events that update state|assert on the output|testing the behavior the user|react.dev/link/wrap-tests-with-act|stderr \|" "$STDERR_FILE" 2>/dev/null || true)
# Remove empty lines left after filtering
FILTERED_STDERR=$(echo "$FILTERED_STDERR" | grep -v -E "^\s*$" 2>/dev/null || true)
rm -f "$STDERR_FILE"

if [ -n "$FILTERED_STDERR" ]; then
  echo ""
  echo "❌ Tests produced unexpected stderr output:"
  echo "────────────────────────────────────────────"
  echo "$FILTERED_STDERR"
  echo "────────────────────────────────────────────"
  echo "CI fails on stderr to catch React warnings, hydration errors, etc."
  echo "Fix the warnings above or add to the filter if benign."
  exit 1
fi

echo "✅ No unexpected stderr output"
'
CONTAINER_EXIT=$?
echo ""
echo "⏱️  Container total: $(( $(date +%s) - CONTAINER_START ))s"

if [ $CONTAINER_EXIT -ne 0 ]; then
  FAILED+=("Tests/Coverage")
  echo ""
  echo "❌ Frontend tests or coverage FAILED"
fi

# Final summary
echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "════════════════════════════════════════════"
  echo "❌ FRONTEND CI FAILED!"
  echo ""
  echo "  Failed checks:"
  for f in "${FAILED[@]}"; do
    echo "    - $f"
  done
  echo "════════════════════════════════════════════"
  exit 1
fi

echo "════════════════════════════════════════════"
echo "✅ ALL FRONTEND CI CHECKS PASSED! 🎉"
echo "════════════════════════════════════════════"
