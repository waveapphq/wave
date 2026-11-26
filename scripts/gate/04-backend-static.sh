#!/bin/bash
# Gate 04: mypy over wavecore/, black and ruff over wavecore/ and tests/, in the wave-ci image.
# Every tool runs, and the result names each one that failed. Nothing is fixed.
#
# Usage: ./scripts/gate/04-backend-static.sh
# WAVE_IN_CI_CONTAINER=1 runs the tools directly, as inside the wave-ci container.

NUMBER="04"
CHECK="Backend static"
SCRIPT="scripts/gate/04-backend-static.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/04-backend-static.log"
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

cd "$ROOT/backend" || exit 2
FAILED=()
tool() { # tool <name> <command>...
  local name="$1"
  shift
  echo "Running $name..."
  "$@" || FAILED+=("$name")
  echo ""
}
tool mypy poetry run mypy wavecore/
tool black poetry run black --check wavecore/ tests/
tool ruff poetry run ruff check wavecore/ tests/

if [ "${#FAILED[@]}" -gt 0 ]; then
  reason=$(printf ', %s' "${FAILED[@]}")
  echo "$NUMBER $CHECK: failed (${reason:2})"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
