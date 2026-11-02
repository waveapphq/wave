#!/bin/bash
# Seed data for V-PLUGIN-DEF-01 tests
#
# This script prepares the environment for testing the 40 plugins
# in the palette panel. No backend data is needed as plugin definitions
# are hardcoded in frontend (REQ-3.4.4.1, REQ-3.4.1.17).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-PLUGIN-DEF-01: Plugin palette test"
echo "No backend seeding required - plugins are hardcoded (REQ-3.4.4.1, REQ-3.4.1.17)"
