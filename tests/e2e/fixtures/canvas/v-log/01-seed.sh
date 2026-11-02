#!/bin/bash
# Seed data for V-LOG tests
#
# This script prepares the environment for testing the Log plugin
# configuration modal. No backend data is needed as plugin definitions
# and metadata are hardcoded in frontend (REQ-3.4.1.17).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-LOG: Log plugin configuration test"
echo "No backend seeding required - plugin metadata is hardcoded (REQ-3.4.1.17)"
