#!/bin/bash
# Backend tests and coverage gate in the wave-ci image; the fast checks run in ci-checks-local.sh.
#
# Usage: ./scripts/ci-backend-local.sh
# WAVE_CI_PROGRESS_SECONDS sets the seconds between progress lines (default 60).

# No set -e: we track failures manually

CI_PYTEST_WORKERS="${CI_PYTEST_WORKERS:-16}"
PROGRESS_SECONDS="${WAVE_CI_PROGRESS_SECONDS:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"
OUTPUT_DIR="$PROJECT_ROOT/ci-output"
LOG_FILE="$OUTPUT_DIR/ci-backend.log"
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
  echo "⏱️  Backend CI total duration: $(format_duration "$elapsed")"
  echo "Log: $LOG_FILE"
}
trap print_duration EXIT

# Tee all output (stdout + stderr) to log file
exec > >(tee "$LOG_FILE") 2>&1

echo "🚀 Running Backend CI locally with Podman..."
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

echo "🔧 Running backend tests with coverage in container..."
echo "Image: $IMAGE_NAME (dependencies pre-installed)"
echo "════════════════════════════════════════════"
echo ""

# The last pytest percentage seen, read by the progress loop.
PROGRESS_DIR=$(mktemp -d)
PROGRESS_FILE="$PROGRESS_DIR/percent"
echo 0 > "$PROGRESS_FILE"

(
  while sleep "$PROGRESS_SECONDS"; do
    echo "Progress: $(cat "$PROGRESS_FILE")%"
  done
) &
PROGRESS_PID=$!

# Keeps pytest's progress rows off the screen and records their percentage.
filter_progress() {
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ \[\ *([0-9]+)%\]$ ]]; then
      echo "${BASH_REMATCH[1]}" > "$PROGRESS_FILE"
    else
      printf '%s\n' "$line"
    fi
  done
}

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

# Capped workers: past 16, Python startup and IPC cost outgrows the parallelism gain.
./scripts/run-coverage-backend.sh --clean --fail-fast -n "$CI_PYTEST_WORKERS"
' 2>&1 | filter_progress
CONTAINER_EXIT=${PIPESTATUS[0]}
CONTAINER_ELAPSED=$(( $(date +%s) - CONTAINER_START ))

# The loop's sleep holds the log pipe open, so it stops too.
pkill -P "$PROGRESS_PID" 2>/dev/null
kill "$PROGRESS_PID" 2>/dev/null
wait "$PROGRESS_PID" 2>/dev/null
rm -rf "$PROGRESS_DIR"

echo ""
echo "⏱️  Container total: ${CONTAINER_ELAPSED}s"

# The container writes /workspace paths; a SonarQube scan run on the host reads the clone's paths.
COVERAGE_XML="$PROJECT_ROOT/backend/coverage.xml"
if [ -f "$COVERAGE_XML" ]; then
  sed -i "s|/workspace/backend|$PROJECT_ROOT/backend|g" "$COVERAGE_XML"
fi

if [ "$CONTAINER_EXIT" -ne 0 ]; then
  FAILED+=("Tests/Coverage")
  echo ""
  echo "❌ Backend tests or coverage FAILED"
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
