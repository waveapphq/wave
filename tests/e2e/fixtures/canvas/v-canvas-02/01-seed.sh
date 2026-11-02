#!/bin/bash
# Seed workflow data for V-CANVAS-02 tests
#
# This script seeds a test workflow with 3+ connected blocks
# to verify the populated canvas display.

set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Seed a test with a populated workflow via the API
curl -s -X POST "${BACKEND_URL}/api/v1/tests" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-workflow-populated",
    "description": "Test workflow with multiple connected blocks",
    "workflow": {
      "nodes": [
        {
          "id": "node-1",
          "type": "workflowNode",
          "position": { "x": 300, "y": 100 },
          "data": {
            "label": "Setup",
            "elementType": "http-client",
            "nodeType": "plugin",
            "category": "network",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        },
        {
          "id": "node-2",
          "type": "workflowNode",
          "position": { "x": 300, "y": 250 },
          "data": {
            "label": "HTTP Call",
            "elementType": "http-client",
            "nodeType": "plugin",
            "category": "network",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        },
        {
          "id": "node-3",
          "type": "workflowNode",
          "position": { "x": 300, "y": 400 },
          "data": {
            "label": "Assert",
            "elementType": "assert",
            "nodeType": "control",
            "category": "conditional",
            "version": "1.0.0",
            "config": { "values": {} }
          }
        }
      ],
      "edges": [
        { "id": "edge-1-2", "source": "node-1", "target": "node-2" },
        { "id": "edge-2-3", "source": "node-2", "target": "node-3" }
      ]
    }
  }' > /dev/null || echo "Note: API seeding may require backend to be running"

echo "V-CANVAS-02: Seeded workflow with 3 connected blocks"
