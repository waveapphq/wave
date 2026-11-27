#!/bin/bash
# Gate 09: every frontend test and the coverage gate, in the wave-ci image. Any stderr line fails
# it, except vitest's "stderr |" labels, "npm notice" lines and blank lines.
#
# Usage: ./scripts/gate/09-frontend-tests.sh
# WAVE_IN_CI_CONTAINER=1 runs the tests directly, as inside the wave-ci container.
# WAVE_CI_PROGRESS_SECONDS sets the seconds between progress lines (default 60).

NUMBER="09"
CHECK="Frontend tests"
SCRIPT="scripts/gate/09-frontend-tests.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/09-frontend-tests.log"
IMAGE="wave-ci:latest"

[ "$#" -eq 0 ] || { echo "Usage: $0" >&2; exit 2; }

if [ "${WAVE_IN_CI_CONTAINER:-}" != "1" ]; then
  if ! podman image exists "$IMAGE"; then
    echo "CI image not found: $IMAGE. Build it with ./scripts/images/build-ci-image.sh"
    echo "$NUMBER $CHECK: failed (CI image $IMAGE not found)"
    exit 2
  fi
  # keep-id lets the container user read and write the host's mounted node_modules.
  # cat ends only when the script's log tee has written its last line; the container's end kills it.
  podman run --rm --userns=keep-id -v "$ROOT:/workspace" -w /workspace \
    -e WAVE_IN_CI_CONTAINER=1 -e WAVE_CI_PROGRESS_SECONDS \
    "$IMAGE" bash -c '"$0" 2>&1 | cat; exit "${PIPESTATUS[0]}"' "/workspace/$SCRIPT" 2>&1 \
    | sed -u "s#^Log: /workspace/#Log: $ROOT/#"
  exit "${PIPESTATUS[0]}"
fi

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

cd "$ROOT/frontend" || exit 2
export WAVE_CI_PROGRESS_SECONDS="${WAVE_CI_PROGRESS_SECONDS:-60}"

# Holds the run's stderr, to catch warnings vitest does not fail on.
STDERR_DIR=$(mktemp -d)
STDERR_FILE="$STDERR_DIR/stderr"
START=$(date +%s)
# stdout goes on as it is; stderr is shown and kept in the file as well.
{ npm run test:coverage -- --run --reporter=./scripts/vitest-progress-reporter.mjs --bail 1 \
    2>&1 1>&3 3>&- | tee "$STDERR_FILE" >&2; } 3>&1
TEST_EXIT=${PIPESTATUS[0]}
echo "Vitest and v8 coverage: $(( $(date +%s) - START ))s"

if [ "$TEST_EXIT" -ne 0 ]; then
  rm -rf "$STDERR_DIR"
  echo "$NUMBER $CHECK: failed (tests or coverage, exit $TEST_EXIT)"
  echo "Log: $LOG"
  exit 1
fi

FILTERED_STDERR=$(grep -v -E "^(stderr \||npm notice)|^\s*$" "$STDERR_FILE" || true)
rm -rf "$STDERR_DIR"

if [ -n "$FILTERED_STDERR" ]; then
  echo ""
  echo "Tests produced unexpected stderr output:"
  echo "────────────────────────────────────────────"
  echo "$FILTERED_STDERR"
  echo "────────────────────────────────────────────"
  echo "CI fails on stderr to catch React warnings, hydration errors, etc."
  echo "Fix the warnings above."
  echo "$NUMBER $CHECK: failed (unexpected stderr output)"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
