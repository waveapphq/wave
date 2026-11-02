#!/bin/bash
# Seed data for V-PLUGIN-VARSET-01 tests
#
# This script prepares the environment for testing the Var Setter control
# configuration modal. No backend data is needed as plugin definitions
# and metadata are hardcoded in frontend.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-PLUGIN-VARSET-01: Var Setter control configuration test"
echo "No backend seeding required - control metadata is hardcoded (REQ-3.4.1.14)"
