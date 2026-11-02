#!/bin/bash
# V-DASH-04: Updates execution progress/status for progress testing
# Usage: 02-update.sh <id> <progress> <status>
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

[[ $# -lt 3 ]] && { echo "Usage: $0 <id> <progress> <status>"; exit 1; }

_admin_on
trap _admin_off EXIT
_update_exec "$1" "$2" "$3"
echo "Updated $1: progress=$2 status=$3"
