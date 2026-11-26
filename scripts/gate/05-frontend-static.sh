#!/bin/bash
# Gate 05: ESLint over src/ and tests/ and the TypeScript type check of the frontend, in the wave-ci image.
# Both tools run, and the result names each one that failed. Nothing is fixed.
#
# Usage: ./scripts/gate/05-frontend-static.sh
# WAVE_IN_CI_CONTAINER=1 runs the tools directly, as inside the wave-ci container.

NUMBER="05"
CHECK="Frontend static"
SCRIPT="scripts/gate/05-frontend-static.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/05-frontend-static.log"
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

cd "$ROOT/frontend" || exit 2
FAILED=()
tool() { # tool <name> <command>...
  local name="$1"
  shift
  echo "Running $name..."
  "$@" || FAILED+=("$name")
  echo ""
}
tool ESLint npm run lint
tool "TypeScript type check" npm run type-check

if [ "${#FAILED[@]}" -gt 0 ]; then
  reason=$(printf ', %s' "${FAILED[@]}")
  echo "$NUMBER $CHECK: failed (${reason:2})"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
