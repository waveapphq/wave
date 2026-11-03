#!/bin/bash
# Automated coverage runner that discovers all test files and runs coverage sequentially
# This script automatically adapts to new test files - no manual updates needed!
#
# Usage:
#   ./run-coverage-backend.sh          # Smart mode: only re-run tests for changed files
#   ./run-coverage-backend.sh --clean  # Force full clean run (like CI)
#   ./run-coverage-backend.sh -n N     # Use N parallel workers (e.g., -n auto, -n 4)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Ensure sonar-scanner is on PATH if installed locally
export PATH="$HOME/bin:$PATH"
COVERAGE_DIR="$BACKEND_DIR/.coverage"
COVERAGE_DATA="$COVERAGE_DIR/.coverage"

# Parse command line arguments
CLEAN_MODE=false
FAIL_FAST=false
PARALLEL_WORKERS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN_MODE=true
            shift
            ;;
        --fail-fast)
            FAIL_FAST=true
            shift
            ;;
        -n)
            PARALLEL_WORKERS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--clean] [--fail-fast] [-n workers]"
            exit 1
            ;;
    esac
done

echo "🔍 WAVE Backend Coverage Runner"
echo "================================"
if [ -n "$PARALLEL_WORKERS" ]; then
    echo "⚡ Parallel mode: $PARALLEL_WORKERS workers"
fi
echo ""

cd "$BACKEND_DIR"

# Detect changed files for smart caching
if [ "$CLEAN_MODE" = false ]; then
    echo "🔍 Detecting changed files (git status)..."

    # Get list of changed files (both staged and unstaged, relative to backend/)
    CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null | grep "^backend/" | sed 's|^backend/||' || true)
    CHANGED_FILES+=$'\n'$(git diff --cached --name-only HEAD 2>/dev/null | grep "^backend/" | sed 's|^backend/||' || true)
    CHANGED_FILES+=$'\n'$(git ls-files --others --exclude-standard 2>/dev/null | grep "^backend/" | sed 's|^backend/||' || true)

    # Remove empty lines and duplicates
    CHANGED_FILES=$(echo "$CHANGED_FILES" | grep -v "^$" | sort -u || true)

    if [ -n "$CHANGED_FILES" ]; then
        echo "📝 Changed files detected:"
        echo "$CHANGED_FILES" | sed 's/^/  - /'
        echo ""

        # Determine which test files need to be re-run
        AFFECTED_TESTS=()
        while IFS= read -r file; do
            # If it's a test file (anywhere in tests/), add it if it exists
            if [[ "$file" == tests/*test_*.py ]] || [[ "$file" == tests/test_*.py ]]; then
                # Only add if file actually exists (git diff shows deleted files too)
                if [ -f "$file" ]; then
                    AFFECTED_TESTS+=("$file")
                fi
            # If it's a source file, find corresponding test files in suite structure
            elif [[ "$file" == wavecore/*.py ]]; then
                # Extract module name from path (e.g., wavecore/plugins/bash_executor.py -> bash_executor)
                module=$(basename "$file" .py)
                source_dir=$(dirname "$file")

                # Determine which domain directory to search based on source location
                if [[ "$source_dir" == wavecore/plugins ]]; then
                    # Search in plugins suites
                    search_dirs="tests/plugins/*/"
                elif [[ "$source_dir" == wavecore/connectivity ]]; then
                    search_dirs="tests/connectivity/"
                elif [[ "$source_dir" == wavecore/core ]]; then
                    search_dirs="tests/core/"
                elif [[ "$source_dir" == wavecore/logging ]]; then
                    search_dirs="tests/logging/"
                elif [[ "$source_dir" == wavecore/storage ]]; then
                    search_dirs="tests/storage/"
                else
                    # Fallback: search in tests/core
                    search_dirs="tests/core/"
                fi

                # Find test files that might test this module
                for dir in $search_dirs; do
                    for test_file in "$dir"test_*.py "$dir"*/test_*.py; do
                        if [ -f "$test_file" ]; then
                            # Check if filename contains the module name
                            if [[ "$(basename "$test_file")" == *"$module"* ]] || [[ "$dir" == *"$module"* ]]; then
                                AFFECTED_TESTS+=("$test_file")
                            fi
                        fi
                    done
                done
            fi
        done <<< "$CHANGED_FILES"

        # Remove duplicates from affected tests
        AFFECTED_TESTS=($(printf "%s\n" "${AFFECTED_TESTS[@]}" | sort -u))

        if [ ${#AFFECTED_TESTS[@]} -gt 0 ]; then
            echo "🎯 Will re-run ${#AFFECTED_TESTS[@]} affected test file(s):"
            printf "  - %s\n" "${AFFECTED_TESTS[@]}"
            echo ""
            echo "💡 Tip: Use --clean flag to force full coverage re-run"
        else
            echo "✨ No test files affected by changes"
            echo "💡 Tip: Use --clean flag to force full coverage re-run"
        fi
        echo ""
    else
        echo "✨ No changed files detected (working tree clean)"
        echo "💡 Tip: Use --clean flag to force full coverage re-run"
        echo ""
    fi
fi

# Clean up old coverage data
if [ "$CLEAN_MODE" = true ]; then
    echo "🧹 Cleaning ALL coverage data (--clean mode)..."
    rm -rf "$COVERAGE_DIR"
    mkdir -p "$COVERAGE_DIR"
    rm -f "$BACKEND_DIR/.coverage.*"
    rm -rf "$BACKEND_DIR/htmlcov"
else
    # Smart mode: only clean cache for affected test files
    if [ -n "$CHANGED_FILES" ] && [ ${#AFFECTED_TESTS[@]} -gt 0 ]; then
        echo "🧹 Cleaning cache for affected test files only..."
        for test_file in "${AFFECTED_TESTS[@]}"; do
            # Remove specific coverage data for this test file if it exists
            rm -f "$BACKEND_DIR/.coverage.$(echo $test_file | tr '/' '.')" 2>/dev/null || true
        done
        # Keep htmlcov and main .coverage file for incremental updates
    else
        echo "🧹 Keeping existing coverage cache (no changes detected)..."
    fi
    mkdir -p "$COVERAGE_DIR"
fi
echo ""

# Discover all test suites (directories containing test_*.py files, excluding conftest.py)
echo "🔎 Discovering test suites..."

# Find all directories containing test files (each dir with test_*.py is a suite)
ALL_SUITES=()
while IFS= read -r test_file; do
    # Skip conftest.py
    if [[ "$(basename "$test_file")" == "conftest.py" ]]; then
        continue
    fi

    suite_dir=$(dirname "$test_file")
    # Add suite dir if not already in array
    if [[ ! " ${ALL_SUITES[@]} " =~ " ${suite_dir} " ]]; then
        ALL_SUITES+=("$suite_dir")
    fi
done < <(find tests -name "test_*.py" -o -name "conftest.py" | grep -E "(test_.*\.py|conftest\.py)$" | sort)

if [ ${#ALL_SUITES[@]} -eq 0 ]; then
    echo "❌ No test suites found!"
    exit 1
fi

# Count total test files for reporting (excluding conftest.py)
TOTAL_TEST_FILES=$(find tests -name "test_*.py" -type f | wc -l)

# Determine which suites to run
if [ "$CLEAN_MODE" = false ] && [ -n "$CHANGED_FILES" ] && [ ${#AFFECTED_TESTS[@]} -gt 0 ]; then
    # Smart mode with changes: determine affected suites
    AFFECTED_SUITES=()
    for test_file in "${AFFECTED_TESTS[@]}"; do
        suite_dir=$(dirname "$test_file")
        if [[ ! " ${AFFECTED_SUITES[@]} " =~ " ${suite_dir} " ]]; then
            AFFECTED_SUITES+=("$suite_dir")
        fi
    done

    TEST_SUITES=("${AFFECTED_SUITES[@]}")
    echo "🎯 Running ${#TEST_SUITES[@]} affected test suite(s) (smart mode)"
    echo "💡 Use --clean to run all ${#ALL_SUITES[@]} suites ($TOTAL_TEST_FILES test files)"
else
    # Clean mode or no changes: run all suites
    TEST_SUITES=("${ALL_SUITES[@]}")

    if [ "$CLEAN_MODE" = true ]; then
        echo "📋 Running all ${#TEST_SUITES[@]} test suites ($TOTAL_TEST_FILES test files) (--clean mode)"
    else
        echo "📋 Running all ${#TEST_SUITES[@]} test suites ($TOTAL_TEST_FILES test files) (no changes detected)"
    fi
fi

TOTAL_SUITES=${#TEST_SUITES[@]}
echo ""

# Function to map test suite (directory) to source modules for targeted coverage
get_coverage_targets() {
    local suite_dir="$1"
    local mode="$2"

    # In clean mode, cover everything
    if [ "$mode" = "clean" ] || [ ${#TEST_SUITES[@]} -eq ${#ALL_SUITES[@]} ]; then
        echo "--cov=wavecore"
        return
    fi

    # In smart mode, dynamically discover coverage targets from test directory structure
    # No more hardcoded mappings - fully automatic!

    # Determine source module from test directory pattern
    if [[ "$suite_dir" == "tests" ]]; then
        # Root tests (test_setup.py, etc.)
        echo "--cov=wavecore"
    elif [[ "$suite_dir" == tests/connectivity* ]]; then
        # Connectivity domain
        echo "--cov=wavecore/connectivity/"
    elif [[ "$suite_dir" == tests/core* ]]; then
        # Core domain
        echo "--cov=wavecore/core/"
    elif [[ "$suite_dir" == tests/logging* ]]; then
        # Logging domain (+ python plugin for integration tests)
        echo "--cov=wavecore/logging/ --cov=wavecore/plugins/python.py"
    elif [[ "$suite_dir" == tests/storage* ]]; then
        # Storage domain
        echo "--cov=wavecore/storage/"
    elif [[ "$suite_dir" == tests/plugins/* ]]; then
        # Plugin tests - dynamically infer source file(s)
        local plugin_suite=$(basename "$suite_dir")

        # Special cases for multi-file plugins
        case "$plugin_suite" in
            ssh)
                # SSH has 6 source files
                echo "--cov=wavecore/plugins/ssh_tunnel_open.py --cov=wavecore/plugins/ssh_tunnel_close.py --cov=wavecore/plugins/ssh_session_open.py --cov=wavecore/plugins/ssh_session_close.py --cov=wavecore/plugins/ssh_session_exec.py --cov=wavecore/plugins/ssh_command.py"
                ;;
            python)
                # Python has the plugin and the bridge
                echo "--cov=wavecore/plugins/python.py --cov=wavecore/plugins/_python_bridge.py"
                ;;
            base)
                # Base plugin
                echo "--cov=wavecore/plugins/base.py"
                ;;
            *)
                # Single-file plugin: try common naming patterns
                # Pattern: tests/plugins/FOO/ -> wavecore/plugins/FOO*.py
                local found_files=$(find wavecore/plugins/ -maxdepth 1 -type f -name "${plugin_suite}*.py" 2>/dev/null)

                if [ -n "$found_files" ]; then
                    # Found matching file(s) - cover them
                    local cov_args=""
                    for file in $found_files; do
                        cov_args="$cov_args --cov=$file"
                    done
                    echo "$cov_args"
                else
                    # No match found - fall back to covering all plugins
                    echo "--cov=wavecore/plugins/"
                fi
                ;;
        esac
    else
        # Unknown pattern - cover everything
        echo "--cov=wavecore"
    fi
}

# Initialize aggregate counters used by both fast-path and suite-loop paths
FAILED_RUNS=()
declare -A FAILED_OUTPUT  # Store error output for failed suites
PASSED_SUITES=0
TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
FAST_PATH_DONE=false

# Determine coverage mode
if [ "$CLEAN_MODE" = true ]; then
    COV_MODE="clean"
else
    COV_MODE="smart"
fi

# =============================================================================
# FAST PATH: single pytest invocation for clean full-suite runs
# =============================================================================
# In --clean mode every suite uses --cov=wavecore anyway, so the per-suite
# loop is pure overhead (~2-4s of pytest-xdist startup per suite × 25 suites).
# One `pytest tests/` invocation collects identical coverage with a single
# worker-pool startup.
# =============================================================================
if [ "$CLEAN_MODE" = true ] && [ -n "$PARALLEL_WORKERS" ]; then
    echo "🚀 Running all ${TOTAL_SUITES} suites in single pytest invocation (clean-mode fast path)..."
    echo ""

    # Build the pytest args. --cov-report= suppresses per-run report; the
    # reporting phase below handles html/json/xml.
    # --dist=loadfile groups tests by source file so pytest-xdist sends
    # all tests in one file to the same worker. This preserves class/function
    # declaration order within a file, which some existing tests rely on for
    # implicit setup (e.g., a class that accumulates shared in-memory state
    # across its test methods). The previous suite-by-suite approach
    # incidentally preserved this ordering; the single-invocation fast path
    # would break it under the default --dist=load mode.
    FAST_PYTEST_ARGS=(tests/ --cov=wavecore --cov-report= --tb=short -q -n "$PARALLEL_WORKERS" --dist=loadfile --durations=20)
    if [ "$FAIL_FAST" = true ]; then
        FAST_PYTEST_ARGS+=(-x)
    fi

    FAST_START=$(date +%s)
    set +e
    OUTPUT=$(poetry run pytest "${FAST_PYTEST_ARGS[@]}" 2>&1)
    EXIT_CODE=$?
    FAST_DURATION=$(( $(date +%s) - FAST_START ))
    set -e

    # Parse pytest summary
    PASSED=$(echo "$OUTPUT" | grep -oP "\d+(?= passed)" | tail -1 || echo "0")
    FAILED=$(echo "$OUTPUT" | grep -oP "\d+(?= failed)" | tail -1 || echo "0")
    SKIPPED=$(echo "$OUTPUT" | grep -oP "\d+(?= skipped)" | tail -1 || echo "0")

    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))

    # Marks the lines of pytest's slowest-durations block.
    DURATIONS_BLOCK='/ slowest [0-9]+ durations / {in_block = 1} /^=/ && !/ slowest / {in_block = 0}'

    if [ $EXIT_CODE -eq 0 ]; then
        PASSED_SUITES=$TOTAL_SUITES
        echo "  ✅ Passed ($TOTAL_PASSED tests, ${FAST_DURATION}s)"
        # The worker count and the slowest tests show where the time goes.
        echo "$OUTPUT" | grep -E "^[0-9]+ workers? \[" | sed 's/^/  /' || true
        echo "$OUTPUT" | awk "$DURATIONS_BLOCK in_block" | sed 's/^/  /'
    else
        FAILURE_TEXT=$(echo "$OUTPUT" | awk "$DURATIONS_BLOCK !in_block")
        # Record as a single aggregate "suite failure" so the existing
        # reporting code can render failure output.
        FAILED_RUNS+=("(fast-path aggregate)")
        FAILED_OUTPUT["(fast-path aggregate)"]="$FAILURE_TEXT"
        echo "  ❌ Failed ($FAILED tests failed, ${FAST_DURATION}s)"
        if [ "$FAIL_FAST" = true ]; then
            echo ""
            echo "❌ FAIL FAST: pytest stopped on first failure"
            echo ""
            # The traceback keeps the assertion message that the summary line cuts off.
            TRACEBACK=$(echo "$FAILURE_TEXT" | awk '/^=+ (ERRORS|FAILURES) =+$/ {on = 1} on && /^=+ (warnings summary|short test summary)/ {on = 0} on' | head -60)
            SUMMARY=$(echo "$FAILURE_TEXT" | sed -n '/=* short test summary/,$p' | head -50)
            if [ -n "$TRACEBACK$SUMMARY" ]; then
                printf '%s\n%s\n' "$TRACEBACK" "$SUMMARY"
            else
                echo "$FAILURE_TEXT" | tail -30
            fi
            exit 1
        fi
    fi
    echo ""

    FAST_PATH_DONE=true
fi

# =============================================================================
# SUITE LOOP: per-suite pytest invocations (smart mode, or clean without -n)
# =============================================================================
if [ "$FAST_PATH_DONE" = false ]; then
    echo "🧪 Running test suites with coverage (one suite at a time)..."
fi

for i in "${!TEST_SUITES[@]}"; do
    # Skip per-suite loop if fast path already ran the full suite in one shot
    if [ "$FAST_PATH_DONE" = true ]; then
        break
    fi
    SUITE_DIR="${TEST_SUITES[$i]}"
    SUITE_NUM=$((i + 1))
    SUITE_NAME=$(basename "$SUITE_DIR")

    # Count test files in this suite
    SUITE_FILE_COUNT=$(find "$SUITE_DIR" -maxdepth 1 -name "test_*.py" -type f | wc -l)

    echo "[$SUITE_NUM/$TOTAL_SUITES] Running suite: $SUITE_DIR ($SUITE_FILE_COUNT file(s))"

    # Get targeted coverage arguments
    COV_TARGETS=$(get_coverage_targets "$SUITE_DIR" "$COV_MODE")

    # Run only test files at this directory level (non-recursive)
    # This allows tests in any directory without running subdirectory tests multiple times
    mapfile -t SUITE_TEST_FILES < <(find "$SUITE_DIR" -maxdepth 1 -name "test_*.py" -type f)

    if [ ${#SUITE_TEST_FILES[@]} -eq 0 ]; then
        echo "  ⚠️  No test files found (skipped)"
        continue
    fi

    # Build pytest command with optional parallel flag using array
    PYTEST_ARGS=("${SUITE_TEST_FILES[@]}")

    # Add coverage targets (need to split the string into array elements)
    for target in $COV_TARGETS; do
        PYTEST_ARGS+=("$target")
    done

    # Add common options
    PYTEST_ARGS+=(--cov-append --cov-report= --tb=short -q)

    # Add parallel execution if requested
    if [ -n "$PARALLEL_WORKERS" ]; then
        PYTEST_ARGS+=(-n "$PARALLEL_WORKERS")
    fi

    # Run pytest and capture output + exit code + wall-clock duration
    # Use || true to prevent set -e from terminating the script on test failures
    set +e  # Temporarily disable exit-on-error
    SUITE_START=$(date +%s)
    OUTPUT=$(poetry run pytest "${PYTEST_ARGS[@]}" 2>&1)
    EXIT_CODE=$?
    SUITE_DURATION=$(( $(date +%s) - SUITE_START ))
    set -e  # Re-enable exit-on-error

    # Parse test counts from pytest output (e.g., "59 passed in 4.20s" or "24 failed, 569 passed")
    PASSED=$(echo "$OUTPUT" | grep -oP "\d+(?= passed)" | tail -1 || echo "0")
    FAILED=$(echo "$OUTPUT" | grep -oP "\d+(?= failed)" | tail -1 || echo "0")
    SKIPPED=$(echo "$OUTPUT" | grep -oP "\d+(?= skipped)" | tail -1 || echo "0")

    TOTAL_PASSED=$((TOTAL_PASSED + PASSED))
    TOTAL_FAILED=$((TOTAL_FAILED + FAILED))
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))

    if [ $EXIT_CODE -eq 0 ]; then
        PASSED_SUITES=$((PASSED_SUITES + 1))
        echo "  ✅ Passed ($PASSED tests, ${SUITE_DURATION}s)"
    else
        FAILED_RUNS+=("$SUITE_DIR")
        FAILED_OUTPUT["$SUITE_DIR"]="$OUTPUT"
        echo "  ❌ Failed ($FAILED tests failed, ${SUITE_DURATION}s)"
        if [ "$FAIL_FAST" = true ]; then
            echo ""
            echo "❌ FAIL FAST: Stopping after first failure in suite: $SUITE_DIR"
            echo ""
            # Show failure details immediately
            FAILURE_SECTION=$(echo "$OUTPUT" | sed -n '/=* short test summary/,$p' | head -50)
            if [ -z "$FAILURE_SECTION" ]; then
                FAILURE_SECTION=$(echo "$OUTPUT" | tail -30)
            fi
            echo "$FAILURE_SECTION"
            exit 1
        fi
    fi
    echo ""
done

echo "================================"
echo "📊 Test Summary"
echo "================================"
echo "Suites:  $PASSED_SUITES/$TOTAL_SUITES passed"
echo "Tests:   $TOTAL_PASSED passed, $TOTAL_FAILED failed, $TOTAL_SKIPPED skipped"
echo "Total:   $((TOTAL_PASSED + TOTAL_FAILED + TOTAL_SKIPPED)) tests"
echo ""

echo "================================"
echo "📊 Generating Coverage Report"
echo "================================"
echo ""

# In smart mode with subset of suites, show focused coverage report
if [ "$COV_MODE" = "smart" ] && [ ${#TEST_SUITES[@]} -lt ${#ALL_SUITES[@]} ]; then
    echo "📍 Focused coverage (smart mode - only showing tested modules)"
    echo ""

    # Build list of specific modules to report on
    INCLUDE_MODULES=""
    for suite_dir in "${TEST_SUITES[@]}"; do
        COV_TARGETS=$(get_coverage_targets "$suite_dir" "$COV_MODE")
        # Extract module paths from --cov flags
        for target in $COV_TARGETS; do
            if [[ "$target" =~ --cov=(.+) ]]; then
                module_path="${BASH_REMATCH[1]}"
                # Add to include list
                if [ -n "$INCLUDE_MODULES" ]; then
                    INCLUDE_MODULES="$INCLUDE_MODULES,$module_path"
                else
                    INCLUDE_MODULES="$module_path"
                fi
            fi
        done
    done

    echo "Generating HTML report (focused)..."
    poetry run coverage html --include="$INCLUDE_MODULES"

    echo "Generating terminal report (focused)..."
    poetry run coverage report --precision=2 --show-missing --include="$INCLUDE_MODULES"

    echo ""
    echo "💡 This is a focused report showing only tested modules"
    echo "💡 Run with --clean to see full project coverage"
else
    # Full coverage report for clean mode or all tests
    echo "Generating HTML report..."
    poetry run coverage html

    echo "Generating terminal report..."
    poetry run coverage report --precision=2 --show-missing

    # Generate JSON report for programmatic access
    echo ""
    echo "Generating JSON report..."
    poetry run coverage json

    # Generate XML report for SonarQube
    echo "Generating XML report (SonarQube)..."
    poetry run coverage xml -o coverage.xml
fi

if [ ${#FAILED_RUNS[@]} -gt 0 ]; then
    echo ""
    echo "════════════════════════════════════════════"
    echo "⚠️  FAILED TEST SUITES"
    echo "════════════════════════════════════════════"
    for failed in "${FAILED_RUNS[@]}"; do
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📁 $failed"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        # Extract and display just the failures section from pytest output
        # Look for FAILURES section or short test summary
        FAILURE_SECTION=$(echo "${FAILED_OUTPUT[$failed]}" | sed -n '/=* FAILURES =*/,/=* short test summary/p' | head -100)
        if [ -z "$FAILURE_SECTION" ]; then
            # Try extracting from short test summary to end
            FAILURE_SECTION=$(echo "${FAILED_OUTPUT[$failed]}" | sed -n '/=* short test summary/,$p' | head -50)
        fi
        if [ -z "$FAILURE_SECTION" ]; then
            # Fallback: show last 30 lines of output
            FAILURE_SECTION=$(echo "${FAILED_OUTPUT[$failed]}" | tail -30)
        fi
        echo "$FAILURE_SECTION"
    done
    echo ""
    echo "════════════════════════════════════════════"
    echo "❌ Some tests failed. Coverage report may be incomplete."
    echo "════════════════════════════════════════════"
    exit 1
fi

echo ""
echo "================================"
echo "✅ Coverage Analysis Complete"
echo "================================"

echo ""
echo "📁 Reports generated:"
echo "  - HTML: htmlcov/index.html"
if [ "$COV_MODE" = "clean" ] || [ ${#TEST_SUITES[@]} -eq ${#ALL_SUITES[@]} ]; then
    echo "  - JSON: coverage.json"
fi
echo ""

# Run SonarQube scan if sonar-scanner is available (always, even if thresholds failed)
if command -v sonar-scanner &> /dev/null && [ -f "sonar-project.properties" ]; then
    echo ""
    echo "================================"
    echo "📡 Running SonarQube Analysis"
    echo "================================"
    sonar-scanner 2>&1 | tail -5
fi

# Check coverage threshold (only in clean mode or when running all tests)
if [ "$COV_MODE" = "smart" ] && [ ${#TEST_SUITES[@]} -lt ${#ALL_SUITES[@]} ]; then
    echo "✅ Focused coverage complete"
    echo "💡 Run with --clean to validate 100% coverage across all modules"
    exit 0
else
    echo "🎯 Checking coverage threshold..."
    if poetry run coverage report --fail-under=100 > /dev/null 2>&1; then
        echo "✅ Coverage threshold met: 100%"
        exit 0
    else
        echo "⚠️  Coverage below 100%"
        echo ""
        echo "Run 'open htmlcov/index.html' to see detailed coverage report"
        exit 1
    fi
fi
