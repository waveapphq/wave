#!/bin/bash
# Targeted Playwright run - one isolated container, exactly the given specs.
#
# Usage:
#   ./scripts/e2e-targeted-local.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts [more specs...]
#
# Spec paths are relative to tests/e2e/. Reuses the wave-e2e image and
# run-e2e-shard.sh service stack (own backend, frontend preview, HTTPS
# simulator, ephemeral DB), so a targeted run is bit-for-bit the same
# environment as a full ci-playwright-local.sh shard. Paths under visual/ run
# in the dark visual projects, everything else in the functional config; a
# phase with no specs is skipped. The frontend bundle is rebuilt only when
# missing or stale (force with WAVE_E2E_REBUILD=1).
#
# This is the fail-first iteration tool; the merge gate is still the full
# ci-playwright-local.sh run.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
E2E_DIR="$PROJECT_ROOT/tests/e2e"
IMAGE_NAME="wave-e2e:latest"
LOG_FILE="/tmp/ci-playwright-targeted.log"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <spec-path-relative-to-tests/e2e> [more specs...]"
  exit 2
fi

FUNCTIONAL_SPECS=""
VISUAL_SPECS=""
for spec in "$@"; do
  if [ ! -f "$E2E_DIR/$spec" ]; then
    echo "❌ Spec not found: tests/e2e/$spec"
    exit 2
  fi
  case "$spec" in
    visual/*) VISUAL_SPECS="$VISUAL_SPECS $spec" ;;
    *) FUNCTIONAL_SPECS="$FUNCTIONAL_SPECS $spec" ;;
  esac
done

if ! podman image exists "$IMAGE_NAME"; then
  echo "❌ E2E CI image not found: $IMAGE_NAME (build with ./scripts/build-e2e-image.sh)"
  exit 1
fi

cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  echo "📦 Installing frontend npm dependencies..."
  npm ci
fi
cd "$E2E_DIR"
if [ ! -d node_modules ]; then
  echo "📦 Installing E2E npm dependencies..."
  npm ci
fi

# Rebuild the bundle only when missing, older than frontend/src, or not
# stamped as an e2e build (a bundle from another flow lacks the baked
# VITE_API_BASE_URL and silently reroutes the app through the preview proxy).
cd "$FRONTEND_DIR"
E2E_BUILD_STAMP="build/.wave-e2e-build"
if [ "${WAVE_E2E_REBUILD:-0}" = "1" ] || [ ! -d build ] || \
   [ ! -f "$E2E_BUILD_STAMP" ] || \
   [ -n "$(find src -newer build -print -quit 2>/dev/null)" ]; then
  echo "✅ Building frontend bundle..."
  VITE_API_BASE_URL=http://localhost:8000 \
    npx vite build --outDir build --emptyOutDir > /tmp/vite-build-targeted.log 2>&1 || {
      echo "Vite build failed:"
      tail -30 /tmp/vite-build-targeted.log
      exit 1
    }
  touch "$E2E_BUILD_STAMP"
else
  echo "✅ Reusing existing frontend bundle (frontend/build)"
fi

ARTIFACTS_DIR="/tmp/wave-e2e-targeted-artifacts"
rm -rf "$ARTIFACTS_DIR"
mkdir -p "$ARTIFACTS_DIR"

NAME="wave-e2e-targeted"
podman rm -f "$NAME" > /dev/null 2>&1 || true

# Bring up the shared real-service stack (real sshd + interpreters, nested jump
# host, internal HTTP target) and guarantee teardown. Set WAVE_E2E_KEEP_STACK=1
# to leave it running between rapid iterations (a subsequent `up` is a no-op).
echo "✅ Ensuring real-service stack is up..."
"$SCRIPT_DIR/e2e-stack.sh" up --wait
if [ "${WAVE_E2E_KEEP_STACK:-0}" != "1" ]; then
  trap '"$SCRIPT_DIR/e2e-stack.sh" down' EXIT
fi

echo "✅ Running targeted specs in one isolated container:"
printf '   %s\n' "$@"

set +e
# --network slirp4netns:allow_host_loopback=true lets the shard reach the
# host-published stack ports at the slirp gateway (10.0.2.2).
podman run \
  --rm \
  --name "$NAME" \
  --userns=keep-id \
  --network slirp4netns:allow_host_loopback=true \
  --sysctl net.ipv4.ping_group_range="1000 1000" \
  --memory 2g \
  --memory-swap 2g \
  -v "$PROJECT_ROOT:/workspace" \
  -v "$ARTIFACTS_DIR:/artifacts" \
  -e "SHARD_INDEX=1" \
  -e "SHARD_TOTAL=1" \
  -e "ARTIFACTS_DIR=/artifacts" \
  -e "TARGET_SPECS=${FUNCTIONAL_SPECS# }" \
  -e "TARGET_VISUAL_SPECS=${VISUAL_SPECS# }" \
  "$IMAGE_NAME" \
  /workspace/scripts/run-e2e-shard.sh 2>&1 | tee "$LOG_FILE"
EXIT_CODE="${PIPESTATUS[0]}"
set -e

echo ""
echo "Artifacts: $ARTIFACTS_DIR (backend.log, functional-results/, traces)"
echo "Log: $LOG_FILE"
exit "$EXIT_CODE"
