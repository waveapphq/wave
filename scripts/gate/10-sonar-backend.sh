#!/bin/bash
# Gate 10: the SonarQube scan of the backend with its quality gate, then its results report.
# Fails on a failed gate condition (a coverage condition counts only once backend/coverage.xml
# exists), on an issue or hotspot on a changed line, and on NOT PROVEN (exit 3).
# Changed lines count from the pull request's base; on a GitHub push, from the commit before
# the push (BEFORE_SHA). A push that creates the branch has no changed lines and no NOT PROVEN.
#
# Usage: ./scripts/gate/10-sonar-backend.sh [--pr <number>]
#   --pr <number>  read that pull request's results, as GitHub CI does
# Needs SONAR_TOKEN and sonar-scanner; SONAR_URL is optional (default SonarQube Cloud).

NUMBER="10"
CHECK="SonarQube backend"
PROJECT="backend"
TITLE="WAVE Backend"
COVERAGE_REPORT="backend/coverage.xml"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/10-sonar-backend.log"

usage() {
  echo "Usage: $0 [--pr <number>]" >&2
  exit 2
}
PR_ARGS=()
case "$#:${1:-}" in
  0:) ;;
  2:--pr) [[ "$2" =~ ^[1-9][0-9]*$ ]] || usage; PR_ARGS=(--pr "$2") ;;
  *) usage ;;
esac

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

result() { # result <exit code> [reason]
  if [ "$1" -eq 0 ]; then
    echo "$NUMBER $CHECK: passed"
  else
    echo "$NUMBER $CHECK: failed ($2)"
  fi
  echo "Log: $LOG"
  exit "$1"
}

cd "$ROOT" || exit 2
[ -n "${SONAR_TOKEN:-}" ] || result 2 "SONAR_TOKEN is not set"
command -v sonar-scanner > /dev/null || result 2 "sonar-scanner is not on PATH"
# A branch scan counts only what the branch's commits change.
if [ -n "$(git status --porcelain -- "$PROJECT")" ]; then
  git status --short -- "$PROJECT"
  result 2 "uncommitted work under $PROJECT/; commit it first"
fi
if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "HEAD" ]; then
  result 2 "HEAD is detached; check out a branch first"
fi

# shellcheck source=../lib/sonar-env.sh
source "$ROOT/scripts/lib/sonar-env.sh"

# Changed lines: since the PR base, the pre-push commit, the release branch, origin's own branch, or origin/master.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
NO_BEFORE="0000000000000000000000000000000000000000"
BASE_REF=""
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  BASE_REF="origin/$GITHUB_BASE_REF"
elif [ -n "${BEFORE_SHA:-}" ]; then
  # A push that created the branch has no earlier commit, so no line counts as changed.
  [ "$BEFORE_SHA" = "$NO_BEFORE" ] || BASE_REF="$BEFORE_SHA"
elif [ -n "$SONAR_BRANCH_TARGET" ]; then
  BASE_REF="origin/$SONAR_BRANCH_TARGET"
elif [ "$CURRENT_BRANCH" = "master" ] || [[ "$CURRENT_BRANCH" == release/* ]]; then
  BASE_REF="origin/$CURRENT_BRANCH"
else
  BASE_REF="origin/master"
fi
BASE_SHA=""
if [ -n "$BASE_REF" ]; then
  BASE_SHA="$(git merge-base HEAD "$BASE_REF" 2> /dev/null)" || result 2 "$BASE_REF is not in this clone; run git fetch origin"
fi

# The scanner reads SONAR_TOKEN from the environment, so the token stays off the command line.
SCAN_ARGS=(-Dsonar.host.url="$SONAR_URL" -Dsonar.qualitygate.wait=true)
if [ -n "$SONAR_BRANCH" ]; then
  SCAN_ARGS+=(-Dsonar.branch.name="$SONAR_BRANCH")
fi
if [ -n "$SONAR_BRANCH_TARGET" ]; then
  SCAN_ARGS+=(-Dsonar.branch.target="$SONAR_BRANCH_TARGET")
fi

echo "=== Running SonarQube scan for $TITLE ==="
# A scan that fails early must not leave the last scan's task file for the gate lookup.
rm -f "$PROJECT/.scannerwork/report-task.txt"
(cd "$PROJECT" && sonar-scanner "${SCAN_ARGS[@]}")
SCAN_EXIT=$?

REPORT_DIR=$(mktemp -d)
trap 'rm -rf "$REPORT_DIR"' EXIT
REPORT="$REPORT_DIR/results.txt"
"$ROOT/scripts/report/sonar-results-$PROJECT.sh" "${PR_ARGS[@]}" | tee "$REPORT"
REPORT_EXIT=${PIPESTATUS[0]}
if [ "$REPORT_EXIT" -eq 3 ] && [ -n "$BASE_SHA" ]; then
  result 3 "NOT PROVEN: the scan analyzed 0 lines of changed code"
fi
[ "$REPORT_EXIT" -eq 0 ] || result 1 "the results report failed, exit $REPORT_EXIT"

COVERAGE_ON_DISK=0
[ -f "$COVERAGE_REPORT" ] && COVERAGE_ON_DISK=1
REASON=$(python3 -I - "$REPORT" "$PROJECT" "$BASE_SHA" "$COVERAGE_ON_DISK" "$SCAN_EXIT" <<'PY'
import re, subprocess, sys

report, project, base, coverage_on_disk, scan_exit = sys.argv[1:6]
lines = open(report, encoding="utf-8").read().splitlines()

failed = [m.group(1) for line in lines if (m := re.match(r"^    ERROR\s+(\S+):", line))]
# A coverage condition fails on missing coverage until the tests wrote their report.
counted = [c for c in failed if coverage_on_disk == "1" or "coverage" not in c]

diff = subprocess.run(
    ["git", "diff", "-U0", "--no-renames", base, "HEAD", "--", f"{project}/"],
    capture_output=True, text=True, check=True,
).stdout if base else ""
changed, path = set(), None
for line in diff.splitlines():
    if line.startswith("+++ "):
        path = line[6:] if line.startswith("+++ b/") else None
    elif line.startswith("@@") and path:
        start, _, count = re.match(r"@@ -\S+ \+(\d+)(,(\d+))? @@", line).groups()
        for number in range(int(start), int(start) + int(count or 1)):
            changed.add((path, number))

hits = []
for line in lines:
    found = re.match(r"^  \d+\. \[[^\]]*\] (.+):(\d+)$", line)
    if not found:
        continue
    where, number = found.group(1), int(found.group(2))
    # SonarQube names a file from its project folder or from the clone root.
    if (where, number) in changed or (f"{project}/{where}", number) in changed:
        hits.append(f"{where}:{number}")

reasons = []
if counted:
    reasons.append("quality gate: " + ", ".join(counted))
if hits:
    noun = "issue or hotspot" if len(hits) == 1 else "issues or hotspots"
    reasons.append(f"{len(hits)} {noun} on changed lines: " + ", ".join(hits))
if scan_exit != "0" and not failed:
    reasons.append(f"the scan failed, exit {scan_exit}")
print("; ".join(reasons))
PY
) || result 1 "the results could not be read"
[ -z "$REASON" ] || result 1 "$REASON"
result 0
