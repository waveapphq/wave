#!/bin/bash
# Gate 08: every backend test and the 100% coverage gate, in the wave-ci image.
#
# Usage: ./scripts/gate/08-backend-tests.sh
# WAVE_IN_CI_CONTAINER=1 runs the tests directly, as inside the wave-ci container.
# WAVE_CI_PROGRESS_SECONDS sets the seconds between progress lines (default 60).
# CI_PYTEST_WORKERS sets the pytest workers (default 16).

NUMBER="08"
CHECK="Backend tests"
SCRIPT="scripts/gate/08-backend-tests.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/08-backend-tests.log"
IMAGE="wave-ci:latest"

[ "$#" -eq 0 ] || { echo "Usage: $0" >&2; exit 2; }

if [ "${WAVE_IN_CI_CONTAINER:-}" != "1" ]; then
  if ! podman image exists "$IMAGE"; then
    echo "CI image not found: $IMAGE. Build it with ./scripts/images/build-ci-image.sh"
    echo "$NUMBER $CHECK: failed (CI image $IMAGE not found)"
    exit 2
  fi
  # --userns=keep-id maps the host user to ciuser, so the container writes files the host user owns.
  podman run --rm --userns=keep-id -v "$ROOT:/workspace" -w /workspace \
    -e WAVE_IN_CI_CONTAINER=1 -e WAVE_CI_PROGRESS_SECONDS -e CI_PYTEST_WORKERS \
    "$IMAGE" "/workspace/$SCRIPT" 2>&1 \
    | sed -u "s#^Log: /workspace/#Log: $ROOT/#"
  code="${PIPESTATUS[0]}"
  # The container writes /workspace paths; a SonarQube scan on the host reads the clone's paths.
  if [ -f "$ROOT/backend/coverage.xml" ]; then
    sed -i "s#/workspace/backend#$ROOT/backend#g" "$ROOT/backend/coverage.xml"
  fi
  exit "$code"
fi

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

PROGRESS_SECONDS="${WAVE_CI_PROGRESS_SECONDS:-60}"
WORKERS="${CI_PYTEST_WORKERS:-16}"

# The last pytest percentage seen, read by the progress loop.
PROGRESS_DIR=$(mktemp -d)
PROGRESS_FILE="$PROGRESS_DIR/percent"
echo 0 > "$PROGRESS_FILE"

# Exits 0 on TERM, so the shell reports no killed job when the loop stops.
progress_loop() {
  local sleeper=""
  trap '[ -z "$sleeper" ] || kill "$sleeper" 2> /dev/null; exit 0' TERM
  while :; do
    sleep "$PROGRESS_SECONDS" &
    sleeper=$!
    wait "$sleeper"
    echo "Progress: $(cat "$PROGRESS_FILE")%"
  done
}
progress_loop &
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

START=$(date +%s)
# Capped workers: past 16, Python startup and IPC cost outgrows the parallelism gain.
"$ROOT/scripts/lib/run-coverage-backend.sh" --clean --fail-fast -n "$WORKERS" 2>&1 | filter_progress
TESTS_EXIT=${PIPESTATUS[0]}

kill "$PROGRESS_PID" 2> /dev/null
wait "$PROGRESS_PID" 2> /dev/null
rm -rf "$PROGRESS_DIR"

echo ""
echo "Tests and coverage: $(( $(date +%s) - START ))s"
if [ "$TESTS_EXIT" -ne 0 ]; then
  echo "$NUMBER $CHECK: failed (tests or coverage, exit $TESTS_EXIT)"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
