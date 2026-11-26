#!/bin/bash
# Local fast checks: text, exclusion IDs, lint, format, type checks and the Vite build.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"
OUTPUT_DIR="$PROJECT_ROOT/ci-output"
LOG_FILE="$OUTPUT_DIR/ci-checks.log"
CHECK_NAMES=(
  "Branch name" "Text" "Orphaned files and exclusion IDs"
  "mypy" "black" "ruff" "ESLint" "TypeScript" "E2E TypeScript" "Build"
)

mkdir -p "$OUTPUT_DIR"
exec > >(tee "$LOG_FILE") 2>&1

echo "🚀 Running the fast checks..."
echo "Project root: $PROJECT_ROOT"
echo "Log: $LOG_FILE"
echo ""

# The container writes the names of its failed checks here, one per line.
RESULTS_DIR=$(mktemp -d)
trap 'rm -rf "$RESULTS_DIR"' EXIT
FAILED_FILE="$RESULTS_DIR/failed"
: > "$FAILED_FILE"

host_check() {
  local name="$1"
  shift
  echo "✅ $name..."
  "$@" || echo "$name" >> "$FAILED_FILE"
  echo ""
}

host_check "Branch name" "$SCRIPT_DIR/check-branch-name.sh"
host_check "Text" "$SCRIPT_DIR/check-text.sh"
host_check "Orphaned files and exclusion IDs" "$SCRIPT_DIR/check-orphaned-files.sh"

CONTAINER_CHECKS=("mypy" "black" "ruff" "ESLint" "TypeScript" "E2E TypeScript" "Build")
if podman image exists "$IMAGE_NAME"; then
  # --userns=keep-id maps the host user to ciuser in container for proper permissions
  podman run --rm \
    --userns=keep-id \
    -v "$PROJECT_ROOT:/workspace" \
    -v "$RESULTS_DIR:/results" \
    -w /workspace \
    "$IMAGE_NAME" \
    bash -c '
check() {
  local name="$1" folder="$2"
  shift 2
  echo "✅ $name..."
  ( cd "$folder" && "$@" ) || echo "$name" >> /results/failed
  echo ""
}
check "mypy" /workspace/backend poetry run mypy wavecore/
check "black" /workspace/backend poetry run black --check wavecore/ tests/
check "ruff" /workspace/backend poetry run ruff check wavecore/ tests/
check "ESLint" /workspace/frontend npm run lint
check "TypeScript" /workspace/frontend npm run type-check
check "E2E TypeScript" /workspace/tests/e2e npm run type-check
check "Build" /workspace/frontend npx vite build
'
else
  echo "❌ CI image not found: $IMAGE_NAME"
  echo "Please build the CI image first:"
  echo "  ./scripts/build-ci-image.sh"
  printf '%s\n' "${CONTAINER_CHECKS[@]}" >> "$FAILED_FILE"
fi

FAILED=()
for name in "${CHECK_NAMES[@]}"; do
  if grep -qxF "$name" "$FAILED_FILE"; then
    FAILED+=("$name")
  fi
done

echo "Log: $LOG_FILE"
if [ ${#FAILED[@]} -gt 0 ]; then
  joined=$(printf ', %s' "${FAILED[@]}")
  echo "Fast checks failed: ${joined:2}."
  exit 1
fi
echo "Fast checks passed."
