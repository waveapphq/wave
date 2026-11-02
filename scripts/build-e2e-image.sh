#!/bin/bash
# Build the WAVE E2E CI container image.
# Extends wave-ci:latest with Playwright chromium + system deps.
# Run once, or when @playwright/test version changes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_IMAGE="wave-ci:latest"
IMAGE_NAME="wave-e2e:latest"

echo "🔨 Building WAVE E2E CI container image..."
echo "Base image: $BASE_IMAGE"
echo "Image name: $IMAGE_NAME"
echo "Project root: $PROJECT_ROOT"
echo ""

if ! podman image exists "$BASE_IMAGE"; then
  echo "❌ Base image not found: $BASE_IMAGE"
  echo ""
  echo "Please build the base CI image first:"
  echo "  ./scripts/build-ci-image.sh"
  echo ""
  exit 1
fi

cd "$PROJECT_ROOT"
podman build \
  -t "$IMAGE_NAME" \
  -f scripts/Containerfile.e2e \
  .

echo ""
echo "✅ E2E CI image built successfully!"
echo ""
podman images "$IMAGE_NAME"
echo ""
echo "To rebuild after a Playwright upgrade:"
echo "  ./scripts/build-e2e-image.sh"
