#!/bin/bash
# Seed data for V-CONTROL-02-08 tests
#
# This script prepares the environment for testing version-specific behavior
# in the control configuration modal. No backend data is needed as control
# metadata and versions are hardcoded in frontend.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "V-CONTROL-02-08: Control configuration modal tests"
echo "No backend seeding required - control metadata is hardcoded in frontend"
