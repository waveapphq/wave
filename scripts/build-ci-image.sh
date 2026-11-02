#!/bin/bash
# Build the WAVE CI container image
# Run this once, or when dependencies need updating

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="wave-ci:latest"

echo "🔨 Building WAVE CI container image..."
echo "Image name: $IMAGE_NAME"
echo "Project root: $PROJECT_ROOT"
echo ""

# Build from project root so we can COPY backend/ and frontend/ directories
cd "$PROJECT_ROOT"

# CI runs mount the project root over /workspace, so the host's wheel cache is the one tests read
./scripts/fetch-remote-wheels.sh

podman build \
  -t "$IMAGE_NAME" \
  -f scripts/Containerfile \
  .

echo ""
echo "✅ CI image built successfully!"
echo ""
echo "Image details:"
podman images "$IMAGE_NAME"

echo ""
echo "📝 Dependencies pre-installed:"
echo "  - Python packages from backend/pyproject.toml"
echo "  - Remote-host wheels from backend/vendor/wheels.lock, fetched into backend/vendor/wheels/"
echo ""
echo "To rebuild this image (e.g., after updating dependencies):"
echo "  ./scripts/build-ci-image.sh"
