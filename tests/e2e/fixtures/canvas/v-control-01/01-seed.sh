#!/bin/bash
# Seed data for V-CONTROL-01 tests
#
# This script prepares the environment for testing the 14 controls
# in the palette panel. No backend data is needed as control definitions
# are hardcoded in frontend (REQ-5.2.1.48).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-CONTROL-01: Control palette test"
echo "No backend seeding required - controls are hardcoded (REQ-5.2.1.48)"
