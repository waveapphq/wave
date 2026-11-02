#!/bin/bash
# Seed data for V-CANVAS-14 workbench execution tests
#
# Seeds the Development / Staging / Production / QA / Integration environments
# the visual tests search and select by name. IDs are deterministic so reruns
# are idempotent under _reset_all.

set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

_reset_all

echo "V-CANVAS-14: seeding environments..."
_add_environment "ac14e001-0001-0001-0001-000000000001" "Development" "Development environment for testing"
_add_environment "ac14e002-0002-0002-0002-000000000002" "Staging" "Staging environment for testing"
_add_environment "ac14e003-0003-0003-0003-000000000003" "Production" "Production environment for testing"
_add_environment "ac14e004-0004-0004-0004-000000000004" "QA" "QA environment for testing"
_add_environment "ac14e005-0005-0005-0005-000000000005" "Integration" "Integration environment for testing"

echo "V-CANVAS-14: seeded environments for execution testing"
