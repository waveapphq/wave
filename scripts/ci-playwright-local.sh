#!/bin/bash
# Local Playwright CI validation - container-sharded edition.
#
# Runs the entire Playwright suite (functional + visual dark) across N
# isolated podman containers. Each container has:
#   - Its own uvicorn + vite preview + HTTPS simulator (network-namespaced)
#   - Its own memory cgroup (--memory limit)
#   - Its own ephemeral DB directory
#   - Optionally its own CPU cgroup slice (--cpuset-cpus) if the user
#     slice has cpuset delegation enabled (most rootless Ubuntu setups
#     don't - see CPU_PIN_AVAILABLE below)
# and runs Playwright with `--shard=K/N --workers=1` so exactly one
# Playwright worker ever talks to any given backend.
#
# This is the architecture that finally delivers both parallelism and
# determinism: the earlier host-side N-stack layout flaked because
# no-data workers and fixture workers shared backends (seed races) and
# because N>1 put the 32-core host under scheduling contention. Per-shard
# containers give each slice its own backend state and its own process
# tree, which eliminates the seed races outright. CPU contention is
# reduced by running more shards than the old stack count, so each
# chromium still has plenty of scheduler headroom on a 32-core host.
#
# Override with env vars:
#   WAVE_E2E_N_SHARDS           default: 8
#   WAVE_E2E_CORES_PER_SHARD    default: nproc / N_SHARDS (only used when pinning)
#   WAVE_E2E_MEM_PER_SHARD      default: 2g
#   WAVE_E2E_SHOW_SHARD_TIMINGS default: 0 (hidden). Set to 1 to echo the
#                               per-shard functional+visual timing block at
#                               the end of the run; useful when diagnosing
#                               a slow shard. The file is always written to
#                               $ARTIFACTS_ROOT/shard-summaries.txt regardless.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
E2E_DIR="$PROJECT_ROOT/tests/e2e"
LOG_FILE="/tmp/ci-playwright.log"
IMAGE_NAME="wave-e2e:latest"

# Container runtime tunables - sized for a 32-core host by default.
TOTAL_CORES=$(nproc)
WAVE_E2E_N_SHARDS="${WAVE_E2E_N_SHARDS:-8}"
# Integer floor: each shard would get TOTAL_CORES / N_SHARDS cores if CPU
# pinning is available. Ubuntu 22.04 rootless podman only delegates
# memory+pids to user slices by default, so --cpuset-cpus errors with
# "cgroup controller cpuset is not available" and we skip it unless the
# user has enabled CPU delegation.
WAVE_E2E_CORES_PER_SHARD="${WAVE_E2E_CORES_PER_SHARD:-$((TOTAL_CORES / WAVE_E2E_N_SHARDS))}"
if [ "$WAVE_E2E_CORES_PER_SHARD" -lt 1 ]; then
  WAVE_E2E_CORES_PER_SHARD=1
fi
WAVE_E2E_MEM_PER_SHARD="${WAVE_E2E_MEM_PER_SHARD:-2g}"

# Detect whether cpuset/cpu cgroup controllers are delegated to this user.
# If yes, we pin each container to a dedicated CPU slice; if no, the OS
# scheduler balances chromium across all cores (process isolation alone
# is still enough to clear the seed races that flaked host-mode N>1).
USER_CG_CONTROLLERS=""
if [ -r /sys/fs/cgroup/user.slice/user-"$(id -u)".slice/user@"$(id -u)".service/cgroup.controllers ]; then
  USER_CG_CONTROLLERS=$(cat /sys/fs/cgroup/user.slice/user-"$(id -u)".slice/user@"$(id -u)".service/cgroup.controllers 2>/dev/null || true)
fi
CPU_PIN_AVAILABLE=false
case " $USER_CG_CONTROLLERS " in
  *" cpuset "*) CPU_PIN_AVAILABLE=true ;;
esac

# Artifacts root - each shard gets a subdir to prevent collisions.
ARTIFACTS_ROOT="/tmp/wave-e2e-artifacts"
rm -rf "$ARTIFACTS_ROOT"
mkdir -p "$ARTIFACTS_ROOT"

exec > >(tee "$LOG_FILE") 2>&1

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

STEP_LOG="/tmp/ci-playwright-steps.log"
: > "$STEP_LOG"
time_step() {
  local label="$1"
  shift
  local start=$(date +%s)
  "$@"
  local rc=$?
  local elapsed=$(( $(date +%s) - start ))
  printf "%-32s %ds\n" "$label" "$elapsed" >> "$STEP_LOG"
  return $rc
}

# Make sure any still-running shard container is torn down on exit. Using
# `podman ps -q --filter name=...` catches both running and exited copies
# so a crash mid-run doesn't leak containers.
cleanup_containers() {
  local ids
  ids=$(podman ps -aq --filter "name=wave-e2e-shard-" 2>/dev/null || true)
  if [ -n "$ids" ]; then
    echo "🧹 Removing leftover shard containers..."
    # shellcheck disable=SC2086
    podman rm -f $ids > /dev/null 2>&1 || true
  fi
}

cleanup_build_dir() {
  # Single shared bundle - the container-sharded layout no longer uses
  # frontend/build-<i>. Clean those up too in case of a config revert.
  rm -rf "$FRONTEND_DIR"/build-* 2>/dev/null || true
}

print_summary() {
  local end_epoch=$(date +%s)
  local elapsed=$((end_epoch - CI_START_EPOCH))
  cleanup_containers
  "$SCRIPT_DIR/e2e-stack.sh" down || true
  cleanup_build_dir
  echo ""
  if [ -f "$STEP_LOG" ]; then
    echo "⏱️  Per-step timings:"
    echo "────────────────────────────────────"
    cat "$STEP_LOG"
    echo "────────────────────────────────────"
  fi
  # Per-shard phase timings - always written to disk so they're available
  # after the fact, but only echoed to the main log when the debug toggle
  # is set. Default is off because the summary bloats a green-run log.
  # Enable with: WAVE_E2E_SHOW_SHARD_TIMINGS=1 ./scripts/ci-playwright-local.sh
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
  # Total Playwright test count across all shards (functional + visual),
  # summed from each shard's JSON report.
  local total_tests=0
  for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
    for report in "$ARTIFACTS_ROOT/shard-$i/functional-report.json" \
                  "$ARTIFACTS_ROOT/shard-$i/visual-report.json"; do
      [ -f "$report" ] || continue
      local n
      n=$(jq '[.stats.expected, .stats.unexpected, .stats.flaky, .stats.skipped] | map(. // 0) | add' "$report" 2>/dev/null || echo 0)
      total_tests=$(( total_tests + n ))
    done
  done
  echo "🧪 Total Playwright tests run: $total_tests (across $WAVE_E2E_N_SHARDS shards)"
  echo "⏱️  Playwright CI total duration: $(format_duration "$elapsed")"
}
trap print_summary EXIT

echo "🎭 Running Playwright CI checks (container-sharded)..."
echo "Project root: $PROJECT_ROOT"
if [ "$CPU_PIN_AVAILABLE" = true ]; then
  echo "Shards: $WAVE_E2E_N_SHARDS × pinned-${WAVE_E2E_CORES_PER_SHARD}-cores / ${WAVE_E2E_MEM_PER_SHARD} RAM"
else
  echo "Shards: $WAVE_E2E_N_SHARDS × ${WAVE_E2E_MEM_PER_SHARD} RAM (CPU shared, cpuset cgroup not delegated)"
fi
echo ""

if [ ! -f "$E2E_DIR/package.json" ]; then
  echo "❌ E2E directory not found: $E2E_DIR"
  exit 1
fi

if ! podman image exists "$IMAGE_NAME"; then
  echo "❌ E2E CI image not found: $IMAGE_NAME"
  echo ""
  echo "Build it with:"
  echo "  ./scripts/build-e2e-image.sh"
  echo ""
  exit 1
fi

# Ensure host-side npm deps exist (containers mount project RW, so the
# node_modules directories the shard runner reaches for must live on disk).
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  echo "📦 Installing frontend npm dependencies..."
  npm ci
fi
cd "$E2E_DIR"
if [ ! -d "node_modules" ]; then
  echo "📦 Installing E2E npm dependencies..."
  npm ci
fi

cleanup_containers

# ---------------------------------------------------------------------------
# Step 1: Build the single shared frontend bundle.
#
# The container-sharded layout has every container's browser pointing at
# its own 127.0.0.1:8000, so VITE_API_BASE_URL is the same for every shard
# and we only need one build. (Vite inlines VITE_API_BASE_URL at build
# time - that's why the old host-mode needed one build per stack.)
# ---------------------------------------------------------------------------
echo "✅ Building frontend bundle (shared by all shards)..."
cd "$FRONTEND_DIR"
rm -rf build
time_step "Vite build (shared)" bash -c '
set -e
VITE_API_BASE_URL=http://localhost:8000 \
  npx vite build --outDir build --emptyOutDir > /tmp/vite-build.log 2>&1 || {
    echo "Vite build failed:"
    tail -30 /tmp/vite-build.log
    exit 1
  }
echo "Built $(du -sh build | cut -f1) bundle at frontend/build"
'
echo ""

echo "✅ Bringing up real-service stack..."
"$SCRIPT_DIR/e2e-stack.sh" up --wait || exit 1

# ---------------------------------------------------------------------------
# Step 2: Launch N containers in parallel. Each container:
#   - pins itself to a unique CPU range via --cpuset-cpus
#   - caps memory via --memory
#   - mounts the project RW + a per-shard artifacts dir RW
#   - runs run-e2e-shard.sh, which starts services then runs Playwright
#     (functional + visual dark) with --shard=K/N --workers=1
# Container output is streamed to per-shard log files on the host so the
# final log shows interleaved progress without a tangled mess.
# ---------------------------------------------------------------------------
echo "✅ Launching $WAVE_E2E_N_SHARDS shard container(s)..."

shard_pids=()
for i in $(seq 1 "$WAVE_E2E_N_SHARDS"); do
  shard_artifacts="$ARTIFACTS_ROOT/shard-$i"
  mkdir -p "$shard_artifacts"
  shard_log="$ARTIFACTS_ROOT/shard-$i.log"
  name="wave-e2e-shard-$i"

  # Build the podman run command. --cpuset-cpus is conditional because
  # rootless podman without delegated cpuset cgroup rejects the flag.
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
      /workspace/scripts/run-e2e-shard.sh \
      > "$shard_log" 2>&1
  ) &
  shard_pids+=($!)
done

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

echo ""
echo "════════════════════════════════════════════"
if [ "${#failed_shards[@]}" -eq 0 ]; then
  echo "✅ ALL PLAYWRIGHT CI CHECKS PASSED! 🎉"
  echo "════════════════════════════════════════════"
  exit 0
fi

echo "❌ Playwright CI FAILED in ${#failed_shards[@]} shard(s): ${failed_shards[*]}"
echo ""
# Print the full error block (from the first failure marker to end of log)
# plus any remaining tail lines up to 800. Playwright's list reporter
# prints received/expected/stack right after the ✘ marker, so anchoring
# on that gives us the diagnostic detail without being drowned out by
# the visual suite's 100+ passing dots.
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
exit 1
