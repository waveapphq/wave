#!/bin/bash
# Runs every backend test in one pytest run with coverage, writes coverage.xml for SonarQube and
# fails below 100% coverage.
#
# Usage: ./scripts/lib/run-coverage-backend.sh -n <workers> [--fail-fast]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
COVERAGE_DIR="$BACKEND_DIR/.coverage"

usage() {
    echo "Usage: $0 -n <workers> [--fail-fast]" >&2
    exit 2
}

FAIL_FAST=false
PARALLEL_WORKERS=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --fail-fast)
            FAIL_FAST=true
            shift
            ;;
        -n)
            [ "$#" -ge 2 ] || usage
            PARALLEL_WORKERS="$2"
            shift 2
            ;;
        *) usage ;;
    esac
done
[ -n "$PARALLEL_WORKERS" ] || usage

cd "$BACKEND_DIR"
rm -rf "$COVERAGE_DIR"
mkdir -p "$COVERAGE_DIR"

TOTAL_TEST_FILES=$(find tests -name "test_*.py" -type f | wc -l)
echo "Running $TOTAL_TEST_FILES test files with $PARALLEL_WORKERS workers"
echo ""

# pytest's ERRORS or FAILURES sections, without the warnings, then its short summary.
print_failure_report() {
    local report
    # awk reads all of its input, so no reader exits early and breaks the pipe.
    report=$(printf '%s\n' "$1" | awk '
        /^=+ (ERRORS|FAILURES) =+$/ {on = 1}
        on && /^=+ (warnings summary|short test summary)/ {on = 0}
        on && traced++ < 60
        /^=+ short test summary/ {summary = 1}
        summary && summed++ < 50')
    if [ -n "$report" ]; then
        printf '%s\n' "$report"
    else
        printf '%s\n' "$1" | tail -30
    fi
}

# --dist=loadfile keeps each file's tests on one worker, in their order, as some tests rely on it.
PYTEST_ARGS=(tests/ --cov=wavecore --cov-report= --tb=short -n "$PARALLEL_WORKERS" --dist=loadfile --durations=20)
if [ "$FAIL_FAST" = true ]; then
    PYTEST_ARGS+=(-x)
fi

# pytest's output streams to a log file; only its progress rows reach the screen.
PYTEST_LOG=$(mktemp)
START=$(date +%s)
set +e
PYTHONUNBUFFERED=1 poetry run pytest "${PYTEST_ARGS[@]}" 2>&1 | tee "$PYTEST_LOG" | grep --line-buffered -E '\[ *[0-9]+%\]$'
EXIT_CODE=${PIPESTATUS[0]}
DURATION=$(( $(date +%s) - START ))
set -e
OUTPUT=$(<"$PYTEST_LOG")
rm -f "$PYTEST_LOG"

PASSED=$(echo "$OUTPUT" | grep -oP "\d+(?= passed)" | tail -1 || echo "0")
FAILED=$(echo "$OUTPUT" | grep -oP "\d+(?= failed)" | tail -1 || echo "0")
SKIPPED=$(echo "$OUTPUT" | grep -oP "\d+(?= skipped)" | tail -1 || echo "0")

# Marks the lines of pytest's slowest-durations block.
DURATIONS_BLOCK='/ slowest [0-9]+ durations / {in_block = 1} /^=/ && !/ slowest / {in_block = 0}'

if [ "$EXIT_CODE" -ne 0 ]; then
    echo "Failed (${FAILED:-0} tests failed, ${DURATION}s)"
    echo ""
    print_failure_report "$(echo "$OUTPUT" | awk "$DURATIONS_BLOCK !in_block")"
    exit 1
fi

echo "Passed (${PASSED:-0} tests, ${SKIPPED:-0} skipped, ${DURATION}s)"
# The worker count and the slowest tests show where the time goes.
echo "$OUTPUT" | grep -E "^[0-9]+ workers? \[" || true
echo "$OUTPUT" | awk "$DURATIONS_BLOCK in_block"
echo ""

poetry run coverage xml -o coverage.xml
echo ""
if ! poetry run coverage report --precision=2 --show-missing --fail-under=100; then
    echo "Coverage below 100%"
    exit 1
fi
echo "Coverage threshold met: 100%"
