#!/bin/bash
# Gate 06: the TypeScript type check of tests/e2e, in the wave-ci image.
#
# Usage: ./scripts/gate/06-e2e-types.sh
# WAVE_IN_CI_CONTAINER=1 runs the tools directly, as inside the wave-ci container.

NUMBER="06"
CHECK="E2E types"
SCRIPT="scripts/gate/06-e2e-types.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/06-e2e-types.log"
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
    -e WAVE_IN_CI_CONTAINER=1 "$IMAGE" "/workspace/$SCRIPT" 2>&1 \
    | sed -u "s#^Log: /workspace/#Log: $ROOT/#"
  exit "${PIPESTATUS[0]}"
fi

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

cd "$ROOT/tests/e2e" || exit 2
FAILED=()
tool() { # tool <name> <command>...
  local name="$1"
  shift
  echo "Running $name..."
  "$@" || FAILED+=("$name")
  echo ""
}
tool "E2E type check" npm run type-check

if [ "${#FAILED[@]}" -gt 0 ]; then
  reason=$(printf ', %s' "${FAILED[@]}")
  echo "$NUMBER $CHECK: failed (${reason:2})"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
