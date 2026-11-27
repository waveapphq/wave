#!/bin/bash
# Gate 08: every backend test and the 100% coverage gate, in the wave-ci image.
#
# Usage: ./scripts/gate/08-backend-tests.sh
# WAVE_IN_CI_CONTAINER=1 runs the tests directly, as inside the wave-ci container.
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
  # Ctrl-C stops the container; bash runs the trap only while it waits, so the run goes in the background.
  CONTAINER="wave-gate-08-$$"
  CODE_FILE=$(mktemp)
  trap 'podman stop -t 2 "$CONTAINER" > /dev/null 2>&1; STOPPED=1' INT TERM
  # keep-id: container files belong to the host user; cat ends with the log tee.
  {
    podman run --rm --name "$CONTAINER" --userns=keep-id -v "$ROOT:/workspace" -w /workspace \
      -e WAVE_IN_CI_CONTAINER=1 -e CI_PYTEST_WORKERS \
      "$IMAGE" bash -c '"$0" 2>&1 | cat; exit "${PIPESTATUS[0]}"' "/workspace/$SCRIPT" 2>&1
    echo "$?" > "$CODE_FILE"
  } | sed -u "s#^Log: /workspace/#Log: $ROOT/#" &
  until wait "$!"; [ -z "$(jobs -r)" ]; do :; done
  code=$(cat "$CODE_FILE")
  rm -f "$CODE_FILE"
  if [ -n "${STOPPED:-}" ]; then
    echo "$NUMBER $CHECK: failed (stopped)"
    exit 130
  fi
  # The container writes /workspace paths; a SonarQube scan on the host reads the clone's paths.
  if [ -f "$ROOT/backend/coverage.xml" ]; then
    sed -i "s#/workspace/backend#$ROOT/backend#g" "$ROOT/backend/coverage.xml"
  fi
  exit "$code"
fi

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

WORKERS="${CI_PYTEST_WORKERS:-16}"

# Turns pytest's rows of dots into "Progress: N%", one line each time the number changes.
show_progress() {
  local line last=""
  while IFS= read -r line; do
    if [[ "$line" =~ \[\ *([0-9]+)%\]$ ]]; then
      [ "${BASH_REMATCH[1]}" = "$last" ] || { last="${BASH_REMATCH[1]}"; echo "Progress: $last%"; }
    else
      printf '%s\n' "$line"
    fi
  done
}

START=$(date +%s)
# Capped workers: past 16, Python startup and IPC cost outgrows the parallelism gain.
"$ROOT/scripts/lib/run-coverage-backend.sh" --fail-fast -n "$WORKERS" 2>&1 | show_progress
TESTS_EXIT=${PIPESTATUS[0]}

echo ""
echo "Tests and coverage: $(( $(date +%s) - START ))s"
if [ "$TESTS_EXIT" -ne 0 ]; then
  echo "$NUMBER $CHECK: failed (tests or coverage, exit $TESTS_EXIT)"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
