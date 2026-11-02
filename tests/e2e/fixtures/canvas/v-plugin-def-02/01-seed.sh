#!/bin/bash
# Seed data for V-PLUGIN-DEF-02 tests
#
# This script prepares the environment for testing plugin icons
# from the centralized icon registry. No backend data is needed
# as plugin icons are hardcoded in frontend (REQ-3.4.4.2).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-PLUGIN-DEF-02: Plugin icon registry test"
echo "No backend seeding required - icons are hardcoded (REQ-3.4.4.2)"
