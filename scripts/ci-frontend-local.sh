#!/bin/bash
# Local Frontend CI validation using Podman
# Uses pre-built wave-ci image with dependencies pre-installed
# Output is also saved to /tmp/ci-frontend.log for post-run analysis
#
# Runs ALL checks and reports ALL failures in a single pass.
# SonarQube runs even if linting fails, so you see everything at once.
#
# Usage: ./scripts/ci-frontend-local.sh

# No set -e: we track failures manually so all checks run regardless

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"
LOG_FILE="/tmp/ci-frontend.log"
FAILED=()

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
  if [ -f "/tmp/ci-frontend-host-steps.log" ]; then
    echo "⏱️  Host-side per-step timings:"
    echo "────────────────────────────────────"
    cat "/tmp/ci-frontend-host-steps.log"
    echo "────────────────────────────────────"
  fi
  echo "⏱️  Frontend CI total duration: $(format_duration "$elapsed")"
}
trap print_duration EXIT

# Tee all output (stdout + stderr) to log file
exec > >(tee "$LOG_FILE") 2>&1

echo "🚀 Running Frontend CI checks locally with Podman..."
echo "Project root: $PROJECT_ROOT"
echo "Log file: $LOG_FILE"
echo ""

# Validate prerequisites upfront - these are hard blockers
"$SCRIPT_DIR/check-branch-name.sh" || exit 1

if ! command -v sonar-scanner &> /dev/null; then
  echo "❌ sonar-scanner binary not found in PATH"
  echo "   Install it or add its location to your PATH"
  exit 1
fi

# Checks SONAR_TOKEN and resolves the SonarQube host and the branch to analyze.
# shellcheck source=sonar-env.sh
source "$SCRIPT_DIR/sonar-env.sh"

if ! podman image exists "$IMAGE_NAME"; then
  echo "❌ CI image not found: $IMAGE_NAME"
  echo ""
  echo "Please build the CI image first:"
  echo "  ./scripts/build-ci-image.sh"
  echo ""
  exit 1
fi

# Host-side per-step timing (orphaned check + SonarQube run on host, not in container)
HOST_STEP_LOG="/tmp/ci-frontend-host-steps.log"
: > "$HOST_STEP_LOG"

# Run orphaned file check on host (doesn't need Node.js)
echo "✅ Checking for orphaned files..."
ORPHAN_START=$(date +%s)
if ! "$SCRIPT_DIR/check-orphaned-files.sh"; then
  FAILED+=("Orphaned files check")
fi
printf "%-28s %ds\n" "Orphaned files check" "$(( $(date +%s) - ORPHAN_START ))" >> "$HOST_STEP_LOG"
echo ""

"$SCRIPT_DIR/check-text.sh" || FAILED+=("Text checks")

echo "🔧 Running Frontend CI checks in container..."
echo "Image: $IMAGE_NAME (dependencies pre-installed)"
echo "════════════════════════════════════════════"
echo ""

# Coverage-ready marker: container touches this file after vitest writes
# coverage; host watcher polls for it and starts SonarQube in parallel with
# the container's remaining work (build). Saves ~15s on wall-clock.
COVERAGE_MARKER="$PROJECT_ROOT/.ci-fe-coverage-ready"
rm -f "$COVERAGE_MARKER"

# Start SonarQube watcher in the background. It polls for the marker, then
# runs the frontend scan script on the host. If the marker never appears (container
# failed before writing coverage), the watcher exits with SQ_SKIPPED status.
SQ_EXIT_FILE=$(mktemp)
echo "SKIPPED" > "$SQ_EXIT_FILE"

(
  # Poll for marker up to 20 minutes (covers worst-case vitest + safety margin)
  for _ in $(seq 1 1200); do
    [ -f "$COVERAGE_MARKER" ] && break
    sleep 1
  done
  if [ ! -f "$COVERAGE_MARKER" ]; then
    echo "SKIPPED" > "$SQ_EXIT_FILE"
    exit 0
  fi

  echo ""
  echo "================================"
  echo "📡 Running SonarQube Analysis (parallel with container build)"
  echo "================================"
  SQ_EXIT=0
  SQ_START=$(date +%s)
  (set -o pipefail && "$SCRIPT_DIR/sonar-scan-frontend.sh" 2>&1 | tail -20) || SQ_EXIT=$?
  printf "%-28s %ds\n" "SonarQube (scan+wait)" "$(( $(date +%s) - SQ_START ))" >> "$HOST_STEP_LOG"
  echo "$SQ_EXIT" > "$SQ_EXIT_FILE"
) &
SQ_WATCHER_PID=$!

# Run frontend tests in container
# Note: The clone is mounted here, so this uses the node_modules from npm ci on the host
# --userns=keep-id maps the host user to ciuser in container for proper permissions
CONTAINER_START=$(date +%s)
podman run --rm \
  --userns=keep-id \
  -v "$PROJECT_ROOT:/workspace" \
  -w /workspace/frontend \
  "$IMAGE_NAME" \
  bash -c '
# No set -e: we run lint + typecheck in background and need to wait/check
# their exit codes explicitly rather than have set -e kill the shell early.

# Per-step timing helper
STEP_LOG="/tmp/ci-frontend-steps.log"
: > "$STEP_LOG"
time_step() {
  local label="$1"
  shift
  local start=$(date +%s)
  "$@"
  local rc=$?
  local elapsed=$(( $(date +%s) - start ))
  printf "%-28s %ds\n" "$label" "$elapsed" >> "$STEP_LOG"
  return $rc
}

# Kick off ESLint and TypeScript in parallel with vitest.
# Vitest uses maxWorkers=16 on the 32-core host, leaving ~16 cores free
# for lint and tsc to run without stealing from vitest.
LINT_LOG=$(mktemp)
TSC_LOG=$(mktemp)

echo "✅ Starting ESLint + TypeScript in parallel with tests..."

LINT_START=$(date +%s)
( npm run lint > "$LINT_LOG" 2>&1 ) &
LINT_PID=$!

TSC_START=$(date +%s)
( npm run type-check > "$TSC_LOG" 2>&1 ) &
TSC_PID=$!

echo ""
echo "✅ Running tests with coverage..."
# Capture stderr to detect warnings that vitest does not fail on
# --bail stops on first test failure for fast feedback
STDERR_FILE=$(mktemp)
TESTS_START=$(date +%s)
npm run test:coverage -- --run --reporter=dot --bail 1 2> >(tee "$STDERR_FILE" >&2)
TEST_EXIT=$?
printf "%-28s %ds\n" "Vitest + v8 coverage" "$(( $(date +%s) - TESTS_START ))" >> "$STEP_LOG"

# Signal the host that coverage is ready. The host has been polling for this
# marker and will start SonarQube in parallel with the remaining container
# work (wait for lint/tsc + build). Only signal on success - otherwise SQ
# would run against stale or empty coverage.
if [ $TEST_EXIT -eq 0 ]; then
  touch /workspace/.ci-fe-coverage-ready
fi

# Wait for lint and tsc (typically already done by now - they are far faster
# than vitest). Capture their exit codes and elapsed times.
wait $LINT_PID
LINT_EXIT=$?
LINT_ELAPSED=$(( $(date +%s) - LINT_START ))
printf "%-28s %ds (parallel)\n" "ESLint" "$LINT_ELAPSED" >> "$STEP_LOG"

wait $TSC_PID
TSC_EXIT=$?
TSC_ELAPSED=$(( $(date +%s) - TSC_START ))
printf "%-28s %ds (parallel)\n" "TypeScript (tsc --noEmit)" "$TSC_ELAPSED" >> "$STEP_LOG"

# Report lint/tsc results (output was captured to files to avoid mixing
# with vitest dots reporter).
echo ""
if [ $LINT_EXIT -eq 0 ]; then
  echo "✅ ESLint passed (${LINT_ELAPSED}s)"
else
  echo "❌ ESLint FAILED (exit $LINT_EXIT):"
  echo "────────────────────────────────────────────"
  cat "$LINT_LOG"
  echo "────────────────────────────────────────────"
fi

if [ $TSC_EXIT -eq 0 ]; then
  echo "✅ TypeScript passed (${TSC_ELAPSED}s)"
else
  echo "❌ TypeScript FAILED (exit $TSC_EXIT):"
  echo "────────────────────────────────────────────"
  cat "$TSC_LOG"
  echo "────────────────────────────────────────────"
fi

rm -f "$LINT_LOG" "$TSC_LOG"

# Check for test failures
if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ Tests failed with exit code $TEST_EXIT"
  rm -f "$STDERR_FILE"
  exit 1
fi

# Fail if lint or typecheck failed
if [ $LINT_EXIT -ne 0 ] || [ $TSC_EXIT -ne 0 ]; then
  rm -f "$STDERR_FILE"
  exit 1
fi

# Check stderr for warnings/errors that should fail CI
# Filter out known benign messages:
# - npm WARN/notice: npm timing and deprecation notices we cannot control
# - ExperimentalWarning: Node.js experimental feature notices
# - FlowRenderer act(): React Flow internal state updates during coverage runs (timing-dependent, benign)
FILTERED_STDERR=$(grep -v -E "^(npm WARN|npm notice|ExperimentalWarning)|FlowRenderer|not wrapped in act|fire events that update state|assert on the output|testing the behavior the user|react.dev/link/wrap-tests-with-act|stderr \|" "$STDERR_FILE" 2>/dev/null || true)
# Remove empty lines left after filtering
FILTERED_STDERR=$(echo "$FILTERED_STDERR" | grep -v -E "^\s*$" 2>/dev/null || true)

if [ -n "$FILTERED_STDERR" ]; then
  echo ""
  echo "❌ Tests produced unexpected stderr output:"
  echo "────────────────────────────────────────────"
  echo "$FILTERED_STDERR"
  echo "────────────────────────────────────────────"
  echo "CI fails on stderr to catch React warnings, hydration errors, etc."
  echo "Fix the warnings above or add to the filter if benign."
  rm -f "$STDERR_FILE"
  exit 1
fi

rm -f "$STDERR_FILE"
echo "✅ No unexpected stderr output"

echo ""
echo "✅ Running build..."
time_step "Vite build" npm run build

echo ""
echo "🎉 Frontend CI checks PASSED!"

echo ""
echo "⏱️  Per-step timings (in-container):"
echo "────────────────────────────────────"
cat "$STEP_LOG"
echo "────────────────────────────────────"
'

CONTAINER_EXIT=$?
printf "%-28s %ds\n" "Container total" "$(( $(date +%s) - CONTAINER_START ))" >> "$HOST_STEP_LOG"
if [ $CONTAINER_EXIT -ne 0 ]; then
  FAILED+=("Tests/Build")
  echo ""
  echo "❌ Frontend tests or build FAILED"
fi

# Collect the SonarQube watcher result (it was started before the container
# and ran in parallel with the container's build step once coverage appeared).
# If the container failed before writing the marker, stop the watcher instead of waiting for its timeout.
if [ ! -f "$COVERAGE_MARKER" ]; then
  kill "$SQ_WATCHER_PID" 2>/dev/null || true
fi
wait "$SQ_WATCHER_PID" 2>/dev/null || true
SQ_EXIT=$(cat "$SQ_EXIT_FILE" 2>/dev/null || echo "SKIPPED")

if [ "$SQ_EXIT" = "SKIPPED" ]; then
  FAILED+=("SonarQube Quality Gate (did not run)")
  echo ""
  echo "❌ SonarQube did not run (no coverage marker). A gate that does not run is not a pass."
elif [ "$SQ_EXIT" != "0" ]; then
  FAILED+=("SonarQube Quality Gate")
  echo ""
  echo "❌ SonarQube Quality Gate FAILED!"
  echo ""
  echo "Quality Gate details:"
  # The gate of this scan's analysis, found through the task id the scanner wrote.
  REPORT_TASK="$PROJECT_ROOT/frontend/.scannerwork/report-task.txt" python3 -c "
import urllib.request, urllib.parse, json, os, base64
token = os.environ['SONAR_TOKEN']
sq_url = os.environ['SONAR_URL']
auth = 'Basic ' + base64.b64encode(f'{token}:'.encode()).decode()
def api(path, params):
    req = urllib.request.Request(f'{sq_url}{path}?{urllib.parse.urlencode(params)}')
    req.add_header('Authorization', auth)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)
with open(os.environ['REPORT_TASK'], encoding='utf-8') as f:
    task = dict(line.rstrip('\n').split('=', 1) for line in f if '=' in line)
analysis_id = api('/api/ce/task', {'id': task['ceTaskId']})['task']['analysisId']
d = api('/api/qualitygates/project_status', {'analysisId': analysis_id})
status = d['projectStatus']['status']
print(f'  Status: {status}')
for c in d['projectStatus'].get('conditions', []):
    icon = '❌' if c['status'] == 'ERROR' else '✅'
    print(f'  {icon} {c[\"metricKey\"]}: {c.get(\"actualValue\", \"?\")} (threshold: {c.get(\"errorThreshold\", \"?\")})')
" 2>/dev/null || true
else
  echo "✅ SonarQube Quality Gate passed"
fi
rm -f "$SQ_EXIT_FILE" "$COVERAGE_MARKER"

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
