#!/usr/bin/env bash
# Run the SonarQube scan for the frontend project and wait for its quality gate.
# Requires SONAR_TOKEN. SONAR_URL is optional and defaults to SonarQube Cloud.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/../frontend"

# shellcheck source=sonar-env.sh
source "$SCRIPT_DIR/sonar-env.sh"

# The scanner reads SONAR_TOKEN from the environment, so the token stays off the command line.
SCAN_ARGS=(-Dsonar.host.url="$SONAR_URL" -Dsonar.qualitygate.wait=true)
if [ -n "$SONAR_BRANCH" ]; then
  SCAN_ARGS+=(-Dsonar.branch.name="$SONAR_BRANCH")
fi

echo "=== Running SonarQube scan for WAVE Frontend ==="
cd "$PROJECT_DIR"
# A scan that fails early must not leave the last scan's task file for the gate lookup.
rm -f .scannerwork/report-task.txt
sonar-scanner "${SCAN_ARGS[@]}"
