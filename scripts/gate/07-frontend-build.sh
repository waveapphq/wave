#!/bin/bash
# Gate 07: the Vite build of the frontend, in the wave-ci image.
#
# Usage: ./scripts/gate/07-frontend-build.sh
# WAVE_IN_CI_CONTAINER=1 runs the tools directly, as inside the wave-ci container.

NUMBER="07"
CHECK="Frontend build"
SCRIPT="scripts/gate/07-frontend-build.sh"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/07-frontend-build.log"
IMAGE="wave-ci:latest"

[ "$#" -eq 0 ] || { echo "Usage: $0" >&2; exit 2; }

if [ "${WAVE_IN_CI_CONTAINER:-}" != "1" ]; then
  if ! podman image exists "$IMAGE"; then
    echo "CI image not found: $IMAGE. Build it with ./scripts/images/build-ci-image.sh"
    echo "$NUMBER $CHECK: failed (CI image $IMAGE not found)"
    exit 2
  fi
  # --userns=keep-id maps the host user to ciuser, so the container writes files the host user owns.
  # cat ends only when the script's log tee has written its last line; the container's end kills it.
  podman run --rm --userns=keep-id -v "$ROOT:/workspace" -w /workspace \
    -e WAVE_IN_CI_CONTAINER=1 "$IMAGE" bash -c '"$0" 2>&1 | cat; exit "${PIPESTATUS[0]}"' "/workspace/$SCRIPT" 2>&1 \
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
tool "Vite build" npx vite build

if [ "${#FAILED[@]}" -gt 0 ]; then
  reason=$(printf ', %s' "${FAILED[@]}")
  echo "$NUMBER $CHECK: failed (${reason:2})"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
