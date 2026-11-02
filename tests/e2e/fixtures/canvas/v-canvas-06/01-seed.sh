#!/bin/bash
# V-CANVAS-06: Console Expanded with Filtering
# Seeds an environment for testing console filtering
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Create default environment
curl -s -X POST "${BACKEND_URL}/api/v1/environments" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Development",
    "description": "Development environment for testing"
  }' > /dev/null

echo "V-CANVAS-06 fixtures seeded successfully"
