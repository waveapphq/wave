#!/bin/bash
# Local Backend CI validation using Podman
# Uses pre-built wave-ci image with dependencies pre-installed
# Output is also saved to /tmp/ci-backend.log for post-run analysis
#
# Runs ALL checks and reports ALL failures in a single pass.
# SonarQube runs even if linting fails, so you see everything at once.
#
# Usage: ./scripts/ci-backend-local.sh

# No set -e: we track failures manually so all checks run regardless

CI_PYTEST_WORKERS="${CI_PYTEST_WORKERS:-16}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"
LOG_FILE="/tmp/ci-backend.log"
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
  if [ -f "/tmp/ci-backend-host-steps.log" ]; then
    echo "⏱️  Host-side per-step timings:"
    echo "────────────────────────────────────"
    cat "/tmp/ci-backend-host-steps.log"
    echo "────────────────────────────────────"
  fi
  echo "⏱️  Backend CI total duration: $(format_duration "$elapsed")"
}
trap print_duration EXIT

# Tee all output (stdout + stderr) to log file
exec > >(tee "$LOG_FILE") 2>&1

echo "🚀 Running Backend CI checks locally with Podman..."
echo "Project root: $PROJECT_ROOT"
echo "Log file: $LOG_FILE"
echo ""

# Validate prerequisites upfront - these are hard blockers
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

"$SCRIPT_DIR/check-text.sh" || FAILED+=("Text checks")

echo "🔧 Running Backend CI checks in container..."
echo "Image: $IMAGE_NAME (dependencies pre-installed)"
echo "════════════════════════════════════════════"
echo ""

# Host-side per-step timing (SonarQube runs on host, not in container)
HOST_STEP_LOG="/tmp/ci-backend-host-steps.log"
: > "$HOST_STEP_LOG"

# Coverage-ready marker: container touches this file after pytest writes
# coverage.xml; host watcher polls for it and starts SonarQube in parallel
# with mypy/black/ruff. Gain is ~20s on cold mypy cache, ~1s when cached.
COVERAGE_MARKER="$PROJECT_ROOT/.ci-be-coverage-ready"
rm -f "$COVERAGE_MARKER"

SQ_EXIT_FILE=$(mktemp)
echo "SKIPPED" > "$SQ_EXIT_FILE"

(
  # Poll for marker up to 20 minutes (covers worst-case pytest + safety margin)
  for _ in $(seq 1 1200); do
    [ -f "$COVERAGE_MARKER" ] && break
    sleep 1
  done
  if [ ! -f "$COVERAGE_MARKER" ]; then
    echo "SKIPPED" > "$SQ_EXIT_FILE"
    exit 0
  fi

  # Fix coverage.xml source paths: container uses /workspace, host uses
  # actual project root. SonarQube matches paths against the host filesystem.
  COVERAGE_XML="$PROJECT_ROOT/backend/coverage.xml"
  if [ -f "$COVERAGE_XML" ]; then
    sed -i "s|/workspace/backend|$PROJECT_ROOT/backend|g" "$COVERAGE_XML"
  fi

  echo ""
  echo "================================"
  echo "📡 Running SonarQube Analysis (parallel with mypy/black/ruff)"
  echo "================================"
  SQ_EXIT=0
  SQ_START=$(date +%s)
  (set -o pipefail && "$SCRIPT_DIR/sonar-scan-backend.sh" 2>&1 | tail -20) || SQ_EXIT=$?
  printf "%-32s %ds\n" "SonarQube (scan+wait)" "$(( $(date +%s) - SQ_START ))" >> "$HOST_STEP_LOG"
  echo "$SQ_EXIT" > "$SQ_EXIT_FILE"
) &
SQ_WATCHER_PID=$!

# Run backend tests, linting, and type checking in container
# --userns=keep-id maps the host user to ciuser in container for proper permissions
CONTAINER_START=$(date +%s)
podman run --rm \
  --userns=keep-id \
  -v "$PROJECT_ROOT:/workspace" \
  -e CI_PYTEST_WORKERS="$CI_PYTEST_WORKERS" \
  -w /workspace \
  "$IMAGE_NAME" \
  bash -c '
set -e

# Per-step timing helper
STEP_LOG="/tmp/ci-backend-steps.log"
: > "$STEP_LOG"
time_step() {
  local label="$1"
  shift
  local start=$(date +%s)
  "$@"
  local rc=$?
  local elapsed=$(( $(date +%s) - start ))
  printf "%-32s %ds\n" "$label" "$elapsed" >> "$STEP_LOG"
  return $rc
}

# Run coverage script in clean mode (single-invocation fast path).
# -n 16 caps pytest-xdist workers at 16 instead of nproc (= 32 on the CI host).
# Empirical results on 32 cores: n=16 is ~40s faster than n=auto because
# above 16 workers the per-process Python startup + IPC overhead grows
# faster than the parallelism gain. n=16 also happens to match the vitest
# sweet spot on the same hardware.
time_step "pytest suites + coverage" ./scripts/run-coverage-backend.sh --clean --fail-fast -n "$CI_PYTEST_WORKERS"

# Signal the host that coverage.xml is ready; host watcher will start
# SonarQube in parallel with the mypy/black/ruff steps below.
touch /workspace/.ci-be-coverage-ready

cd backend

echo ""
echo "✅ Running mypy type checking..."
time_step "mypy" poetry run mypy wavecore/

echo ""
echo "✅ Running black formatting check..."
time_step "black --check" poetry run black --check wavecore/

echo ""
echo "✅ Running ruff linting..."
time_step "ruff check" poetry run ruff check wavecore/

echo ""
echo "⏱️  Per-step timings (in-container):"
echo "────────────────────────────────────"
cat "$STEP_LOG"
echo "────────────────────────────────────"
'

CONTAINER_EXIT=$?
printf "%-32s %ds\n" "Container total" "$(( $(date +%s) - CONTAINER_START ))" >> "$HOST_STEP_LOG"
if [ $CONTAINER_EXIT -ne 0 ]; then
  FAILED+=("Tests/Linting")
  echo ""
  echo "❌ Backend tests or linting FAILED"
fi

# Collect the SonarQube watcher result (it was started before the container
# and ran in parallel with mypy/black/ruff once coverage.xml appeared).
# Path fixing is handled inside the watcher after the marker appears.
if [ ! -f "$COVERAGE_MARKER" ]; then
  kill "$SQ_WATCHER_PID" 2>/dev/null || true
fi
wait "$SQ_WATCHER_PID" 2>/dev/null || true
SQ_EXIT=$(cat "$SQ_EXIT_FILE" 2>/dev/null || echo "SKIPPED")
rm -f "$SQ_EXIT_FILE" "$COVERAGE_MARKER"

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
  REPORT_TASK="$PROJECT_ROOT/backend/.scannerwork/report-task.txt" python3 -c "
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

# Final summary
echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "════════════════════════════════════════════"
  echo "❌ BACKEND CI FAILED!"
  echo ""
  echo "  Failed checks:"
  for f in "${FAILED[@]}"; do
    echo "    - $f"
  done
  echo "════════════════════════════════════════════"
  exit 1
fi

echo "════════════════════════════════════════════"
echo "✅ ALL BACKEND CI CHECKS PASSED! 🎉"
echo "════════════════════════════════════════════"
