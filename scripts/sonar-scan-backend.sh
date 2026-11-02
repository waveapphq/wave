#!/usr/bin/env bash
# Run SonarQube scanner for the backend project.
# Requires SONAR_TOKEN and SONAR_URL environment variables to be set.
set -euo pipefail

if [ -z "${SONAR_TOKEN:-}" ]; then
  echo "ERROR: SONAR_TOKEN environment variable is not set" >&2
  exit 1
fi

if [ -z "${SONAR_URL:-}" ]; then
  echo "ERROR: SONAR_URL environment variable is not set" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/../backend"

echo "=== Running SonarQube scan for WAVE Backend ==="
cd "$PROJECT_DIR"
sonar-scanner \
  -Dsonar.host.url="$SONAR_URL" \
  -Dsonar.token="$SONAR_TOKEN"
