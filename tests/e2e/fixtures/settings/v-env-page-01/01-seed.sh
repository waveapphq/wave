#!/bin/bash
# V-ENV-PAGE-01: Seeds environments for the Environments-page functional test.
# Three environments with distinct names so the table assertions are stable.
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data (also clears any stale environments from prior runs)
_reset_all

ENV_PROD="f0f00001-f001-f001-f001-f00000000001"
ENV_STAGING="f0f00002-f002-f002-f002-f00000000002"
ENV_DEV="f0f00003-f003-f003-f003-f00000000003"

_add_environment "$ENV_PROD" "EnvPageProd" "Prod env for env-page test"
_add_environment "$ENV_STAGING" "EnvPageStaging" "Staging env for env-page test"
_add_environment "$ENV_DEV" "EnvPageDev" "Dev env for env-page test"

echo "V-ENV-PAGE-01 seeded: 3 environments"
