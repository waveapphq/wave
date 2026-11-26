#!/bin/bash
# Gate 15: the Playwright suite across podman containers, each with its own backend and one
# Playwright worker: a list of spec files split across up to 8 shards, or the full suite.
#
# Usage: ./scripts/gate/15-playwright.sh <spec path relative to tests/e2e> ...
#        ./scripts/gate/15-playwright.sh full
#
# Override with env vars:
#   WAVE_E2E_N_SHARDS           default: 8
#   WAVE_CI_PROGRESS_SECONDS    default: 60, seconds between progress lines
#   WAVE_E2E_CORES_PER_SHARD    default: nproc / N_SHARDS (only used when pinning)
#   WAVE_E2E_MEM_PER_SHARD      default: 2g
#   WAVE_E2E_SHOW_SHARD_TIMINGS default: 0; 1 also prints $ARTIFACTS_ROOT/shard-summaries.txt at the end

NUMBER="15"
CHECK="Playwright"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_SCRIPTS="$PROJECT_ROOT/scripts/e2e"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
E2E_DIR="$PROJECT_ROOT/tests/e2e"
OUTPUT_DIR="$PROJECT_ROOT/ci-output"
LOG_FILE="$OUTPUT_DIR/15-playwright.log"
ARTIFACTS_ROOT="$OUTPUT_DIR/e2e-artifacts"
IMAGE_NAME="wave-e2e:latest"
PROGRESS_SECONDS="${WAVE_CI_PROGRESS_SECONDS:-60}"

usage() {
  echo "Usage: $0 <spec path relative to tests/e2e> ..." >&2
  echo "       $0 full" >&2
  exit 2
}
[ "$#" -gt 0 ] || usage
for arg in "$@"; do
  [[ "$arg" != -* ]] || usage
done
if [ "$1" = "full" ]; then
  [ "$#" -eq 1 ] || usage
  set --
fi

# Spec paths relative to tests/e2e; the planner and the shards read them comma separated.
GIVEN_SPECS=("$@")
SPECS=()
for spec in "$@"; do
  SPECS+=("${spec#./}")
done
SPEC_LIST=$(IFS=,; echo "${SPECS[*]}")
GIVEN_LIST=$(IFS=,; echo "${GIVEN_SPECS[*]}")

mkdir -p "$OUTPUT_DIR"
exec > >(tee "$LOG_FILE") 2>&1
echo "Log: $LOG_FILE"

result() { # result <exit code> [reason]
  if [ "$1" -eq 0 ]; then
    echo "$NUMBER $CHECK: passed"
  else
    echo "$NUMBER $CHECK: failed ($2)"
  fi
  echo "Log: $LOG_FILE"
  exit "$1"
}

# Every listed spec is checked before anything is deleted, so a bad list keeps the last run.
MISSING=()
for i in "${!SPECS[@]}"; do
  if [ ! -f "$E2E_DIR/${SPECS[$i]}" ]; then
    echo "Spec not found: ${GIVEN_SPECS[$i]}"
    MISSING+=("${GIVEN_SPECS[$i]}")
  fi
done
[ "${#MISSING[@]}" -eq 0 ] || result 2 "spec not found: ${MISSING[*]}"

# Container runtime tunables - sized for a 32-core host by default.
TOTAL_CORES=$(nproc)
WAVE_E2E_N_SHARDS="${WAVE_E2E_N_SHARDS:-8}"
if [ "${#SPECS[@]}" -gt 0 ] && [ "${#SPECS[@]}" -lt "$WAVE_E2E_N_SHARDS" ]; then
  WAVE_E2E_N_SHARDS="${#SPECS[@]}"
fi
# Cores per shard, used only when CPU pinning is available.
WAVE_E2E_CORES_PER_SHARD="${WAVE_E2E_CORES_PER_SHARD:-$((TOTAL_CORES / WAVE_E2E_N_SHARDS))}"
if [ "$WAVE_E2E_CORES_PER_SHARD" -lt 1 ]; then
  WAVE_E2E_CORES_PER_SHARD=1
fi
WAVE_E2E_MEM_PER_SHARD="${WAVE_E2E_MEM_PER_SHARD:-2g}"

# The test count of each shard's bin, for the progress line. The shards plan the same bins.
WEIGHTS_FILE="$E2E_DIR/shard-weights.json"
PLAN_DIR=$(mktemp -d)
trap 'rm -rf "$PLAN_DIR"' EXIT
if [ -f "$WEIGHTS_FILE" ]; then
  plan_args=(--shards "$WAVE_E2E_N_SHARDS" --artifacts "$PLAN_DIR" --weights "$WEIGHTS_FILE" --e2e-dir "$E2E_DIR")
  if [ "${#SPECS[@]}" -gt 0 ]; then
    plan_args+=(--specs "$GIVEN_LIST")
  fi
  plan_rc=0
  node "$E2E_SCRIPTS/e2e-shard-plan.mjs" "${plan_args[@]}" || plan_rc=$?
  if [ "$plan_rc" -eq 2 ]; then
    result 2 "a listed file is in no Playwright config"
  elif [ "$plan_rc" -ne 0 ]; then
    result 1 "the shard plan failed, exit $plan_rc"
  fi
elif [ "${#SPECS[@]}" -gt 0 ]; then
  result 1 "a spec list needs tests/e2e/shard-weights.json; run ./scripts/e2e/generate-shard-weights.sh"
fi

# Artifacts root - each shard gets a subdir to prevent collisions.
rm -rf "$ARTIFACTS_ROOT"
mkdir -p "$ARTIFACTS_ROOT"
cp -R "$PLAN_DIR/." "$ARTIFACTS_ROOT/"
SHARD_TESTS=()
for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
  SHARD_TESTS+=("$(cat "$ARTIFACTS_ROOT/shard-$i/plan-tests.txt" 2> /dev/null || echo 0)")
done

# Pin each container to its own CPUs only when the cpuset controller is delegated to this user.
USER_CG_CONTROLLERS=""
if [ -r /sys/fs/cgroup/user.slice/user-"$(id -u)".slice/user@"$(id -u)".service/cgroup.controllers ]; then
  USER_CG_CONTROLLERS=$(cat /sys/fs/cgroup/user.slice/user-"$(id -u)".slice/user@"$(id -u)".service/cgroup.controllers 2> /dev/null || true)
fi
CPU_PIN_AVAILABLE=false
case " $USER_CG_CONTROLLERS " in
  *" cpuset "*) CPU_PIN_AVAILABLE=true ;;
esac

CI_START_EPOCH=$(date +%s)
format_duration() {
  local total=$1
  local h=$((total / 3600))
  local m=$(((total % 3600) / 60))
  local s=$((total % 60))
  if [ "$h" -gt 0 ]; then
    printf '%dh %dm %ds (%ds total)' "$h" "$m" "$s" "$total"
  else
    printf '%dm %ds (%ds total)' "$m" "$s" "$total"
  fi
}

STEP_LOG="$ARTIFACTS_ROOT/steps.log"
: > "$STEP_LOG"
time_step() {
  local label="$1"
  shift
  local start
  start=$(date +%s)
  "$@"
  local rc=$?
  local elapsed=$(( $(date +%s) - start ))
  printf "%-32s %ds\n" "$label" "$elapsed" >> "$STEP_LOG"
  return $rc
}

# Removes running and exited shard containers, so a crash leaks none.
cleanup_containers() {
  local ids=()
  mapfile -t ids < <(podman ps -aq --filter "name=wave-e2e-shard-" 2> /dev/null || true)
  if [ "${#ids[@]}" -gt 0 ]; then
    echo "🧹 Removing leftover shard containers..."
    podman rm -f "${ids[@]}" > /dev/null 2>&1 || true
  fi
}

PROGRESS_PID=""
stop_progress() {
  if [ -n "$PROGRESS_PID" ]; then
    kill "$PROGRESS_PID" 2> /dev/null || true
    wait "$PROGRESS_PID" 2> /dev/null || true
    PROGRESS_PID=""
  fi
}

RESULT_CODE=1
RESULT_REASON="the run stopped early"
print_summary() {
  local end_epoch elapsed
  end_epoch=$(date +%s)
  elapsed=$((end_epoch - CI_START_EPOCH))
  stop_progress
  cleanup_containers
  "$E2E_SCRIPTS/e2e-stack.sh" down || true
  rm -rf "$PLAN_DIR"
  echo ""
  if [ -f "$STEP_LOG" ]; then
    echo "⏱️  Per-step timings:"
    echo "────────────────────────────────────"
    cat "$STEP_LOG"
    echo "────────────────────────────────────"
  fi
  # Per-shard timings always go to disk; WAVE_E2E_SHOW_SHARD_TIMINGS=1 also prints them.
  local shard_sum="$ARTIFACTS_ROOT/shard-summaries.txt"
  : > "$shard_sum"
  for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
    local f="$ARTIFACTS_ROOT/shard-$i/summary.txt"
    if [ -f "$f" ]; then
      {
        echo "--- shard $i/$WAVE_E2E_N_SHARDS ---"
        cat "$f"
      } >> "$shard_sum"
    fi
  done
  if [ -s "$shard_sum" ] && [ "${WAVE_E2E_SHOW_SHARD_TIMINGS:-0}" = "1" ]; then
    echo ""
    echo "⏱️  Per-shard timings (functional + visual each):"
    echo "────────────────────────────────────"
    cat "$shard_sum"
    echo "────────────────────────────────────"
  fi
  # Total test count, summed from every shard's JSON reports.
  local total_tests=0
  for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
    for report in "$ARTIFACTS_ROOT/shard-$i/functional-report.json" \
                  "$ARTIFACTS_ROOT/shard-$i/visual-report.json"; do
      [ -f "$report" ] || continue
      local n
      n=$(jq '[.stats.expected, .stats.unexpected, .stats.flaky, .stats.skipped] | map(. // 0) | add' "$report" 2> /dev/null || echo 0)
      total_tests=$(( total_tests + n ))
    done
  done
  echo "🧪 Total Playwright tests run: $total_tests (across $WAVE_E2E_N_SHARDS shards)"
  echo "⏱️  Playwright total duration: $(format_duration "$elapsed")"
  trap - EXIT
  result "$RESULT_CODE" "$RESULT_REASON"
}
trap print_summary EXIT

echo "🎭 Running Playwright (container-sharded)..."
echo "Project root: $PROJECT_ROOT"
if [ "${#SPECS[@]}" -gt 0 ]; then
  echo "Specs: ${SPECS[*]}"
else
  echo "Specs: the full suite"
fi
if [ "$CPU_PIN_AVAILABLE" = true ]; then
  echo "Shards: $WAVE_E2E_N_SHARDS × pinned-${WAVE_E2E_CORES_PER_SHARD}-cores / ${WAVE_E2E_MEM_PER_SHARD} RAM"
else
  echo "Shards: $WAVE_E2E_N_SHARDS × ${WAVE_E2E_MEM_PER_SHARD} RAM (CPU shared, cpuset cgroup not delegated)"
fi
echo ""

if [ ! -f "$E2E_DIR/package.json" ]; then
  RESULT_CODE=2
  RESULT_REASON="E2E directory not found: $E2E_DIR"
  exit 2
fi

if ! podman image exists "$IMAGE_NAME"; then
  echo "Build the E2E CI image with: ./scripts/images/build-e2e-image.sh"
  RESULT_CODE=2
  RESULT_REASON="E2E CI image not found: $IMAGE_NAME"
  exit 2
fi

# The containers mount the project, so the shards use the host's node_modules.
cd "$FRONTEND_DIR" || exit 2
if [ ! -d "node_modules" ]; then
  echo "📦 Installing frontend npm dependencies..."
  npm ci || exit 1
fi
cd "$E2E_DIR" || exit 2
if [ ! -d "node_modules" ]; then
  echo "📦 Installing E2E npm dependencies..."
  npm ci || exit 1
fi

cleanup_containers

# ---------------------------------------------------------------------------
# Step 1: one frontend build, since every shard's browser reaches its own 127.0.0.1:8000.
# ---------------------------------------------------------------------------
echo "✅ Building frontend bundle (shared by all shards)..."
cd "$FRONTEND_DIR" || exit 2
rm -rf build
if ! VITE_LOG="$ARTIFACTS_ROOT/vite-build.log" time_step "Vite build (shared)" bash -c '
set -e
VITE_API_BASE_URL=http://localhost:8000 \
  npx vite build --outDir build --emptyOutDir > "$VITE_LOG" 2>&1 || {
    echo "Vite build failed:"
    tail -30 "$VITE_LOG"
    exit 1
  }
echo "Built $(du -sh build | cut -f1) bundle at frontend/build"
'; then
  RESULT_REASON="the frontend build failed"
  exit 1
fi
echo ""

echo "✅ Bringing up real-service stack..."
if ! "$E2E_SCRIPTS/e2e-stack.sh" up --wait; then
  RESULT_REASON="the service stack did not start"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: launch the shard containers in parallel, each writing its own log file.
# ---------------------------------------------------------------------------
echo "✅ Launching $WAVE_E2E_N_SHARDS shard container(s)..."

shard_pids=()
for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
  shard_artifacts="$ARTIFACTS_ROOT/shard-$i"
  mkdir -p "$shard_artifacts"
  shard_log="$ARTIFACTS_ROOT/shard-$i.log"
  name="wave-e2e-shard-$i"

  # --cpuset-cpus only with pinning; rootless podman without a delegated cpuset rejects it.
  run_args=(
    --sysctl "net.ipv4.ping_group_range=1000 1000"
    --rm
    --name "$name"
    --userns=keep-id
    --network slirp4netns:allow_host_loopback=true
    --memory "$WAVE_E2E_MEM_PER_SHARD"
    --memory-swap "$WAVE_E2E_MEM_PER_SHARD"
    -v "$PROJECT_ROOT:/workspace"
    -v "$shard_artifacts:/artifacts"
    -e "SHARD_INDEX=$i"
    -e "SHARD_TOTAL=$WAVE_E2E_N_SHARDS"
    -e "ARTIFACTS_DIR=/artifacts"
  )
  if [ "${#SPECS[@]}" -gt 0 ]; then
    run_args+=( -e "WAVE_E2E_SPECS=$SPEC_LIST" )
  fi
  if [ "$CPU_PIN_AVAILABLE" = true ]; then
    cpu_start=$(( (i - 1) * WAVE_E2E_CORES_PER_SHARD ))
    cpu_end=$(( i * WAVE_E2E_CORES_PER_SHARD - 1 ))
    run_args+=( --cpuset-cpus "${cpu_start}-${cpu_end}" )
    echo "  shard $i/$WAVE_E2E_N_SHARDS pinned to CPUs ${cpu_start}-${cpu_end}, log: ${shard_log}"
  else
    echo "  shard $i/$WAVE_E2E_N_SHARDS (CPU shared), log: ${shard_log}"
  fi

  (
    podman run "${run_args[@]}" \
      "$IMAGE_NAME" \
      /workspace/scripts/e2e/run-e2e-shard.sh \
      > "$shard_log" 2>&1
  ) &
  shard_pids+=($!)
done

# One line with every shard's share: tests started in its log against its bin's test count.
shard_percent() {
  local i="$1" total="${SHARD_TESTS[$(( $1 - 1 ))]:-0}" started
  started=$(grep -cE '\[[0-9]+/[0-9]+\]( \(retries\))? ' "$ARTIFACTS_ROOT/shard-$i.log" 2> /dev/null || true)
  started="${started:-0}"
  if [ "$total" -le 0 ]; then
    echo 0
  elif [ "$started" -ge "$total" ]; then
    echo 100
  else
    echo $(( started * 100 / total ))
  fi
}
# Exits 0 on TERM, so the shell reports no killed job when the loop stops.
progress_loop() {
  local sleeper="" line i
  trap '[ -z "$sleeper" ] || kill "$sleeper" 2> /dev/null; exit 0' TERM
  while :; do
    sleep "$PROGRESS_SECONDS" &
    sleeper=$!
    wait "$sleeper"
    line="Progress:"
    for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
      [ "$i" -gt 1 ] && line+=","
      line+=" shard $i/$WAVE_E2E_N_SHARDS $(shard_percent "$i")%"
    done
    echo "$line"
  done
}
progress_loop &
PROGRESS_PID=$!

# ---------------------------------------------------------------------------
# Step 3: Wait for all shards and collect exit codes.
# ---------------------------------------------------------------------------
echo ""
echo "⏳ Waiting for shards to finish..."
echo ""

SHARD_RUN_START=$(date +%s)
failed_shards=()
for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
  idx=$((i - 1))
  pid="${shard_pids[$idx]}"
  if wait "$pid"; then
    elapsed=$(( $(date +%s) - SHARD_RUN_START ))
    echo "  ✅ shard $i/$WAVE_E2E_N_SHARDS passed (cumulative ${elapsed}s)"
  else
    elapsed=$(( $(date +%s) - SHARD_RUN_START ))
    echo "  ❌ shard $i/$WAVE_E2E_N_SHARDS FAILED (cumulative ${elapsed}s)"
    failed_shards+=("$i")
  fi
done
printf "%-32s %ds\n" "All shards (wall clock)" "$(( $(date +%s) - SHARD_RUN_START ))" >> "$STEP_LOG"
stop_progress

echo ""
echo "════════════════════════════════════════════"
if [ "${#failed_shards[@]}" -eq 0 ]; then
  echo "✅ Every shard passed."
  echo "════════════════════════════════════════════"
  RESULT_CODE=0
  exit 0
fi

echo "❌ ${#failed_shards[@]} shard(s) failed: ${failed_shards[*]}"
echo ""
# Failure detail from the first failure marker on, then the log's tail for context.
for i in "${failed_shards[@]}"; do
  log_file="$ARTIFACTS_ROOT/shard-$i.log"
  if [ -f "$log_file" ]; then
    echo ""
    echo "--- shard $i ($log_file) - failure detail ---"
    awk '/✘|Error:|expect\(|[0-9]+ failed/{found=1} found{print}' "$log_file" | tail -400
    echo ""
    echo "--- shard $i - last 80 lines for context ---"
    tail -80 "$log_file"
  fi
done
echo "════════════════════════════════════════════"
RESULT_REASON="shards failed: ${failed_shards[*]}"
exit 1
