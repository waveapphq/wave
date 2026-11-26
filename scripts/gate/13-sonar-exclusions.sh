#!/bin/bash
# Gate 13: SonarQube Cloud's false positive marks
# compared with tests/exclusions/, through scripts/lib/check-exclusions.py --sonarqube.
#
# Usage: ./scripts/gate/13-sonar-exclusions.sh

NUMBER="13"
CHECK="SonarQube exclusions"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/13-sonar-exclusions.log"

[ "$#" -eq 0 ] || { echo "Usage: $0" >&2; exit 2; }

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

cd "$ROOT" || exit 2
python3 scripts/lib/check-exclusions.py --sonarqube
code=$?
if [ "$code" -eq 2 ]; then
  echo "$NUMBER $CHECK: failed (the exclusions check could not run, exit 2)"
  echo "Log: $LOG"
  exit 2
elif [ "$code" -ne 0 ]; then
  echo "$NUMBER $CHECK: failed (the exclusions check found problems, exit $code)"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
