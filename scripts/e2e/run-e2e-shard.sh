#!/bin/bash
# One E2E shard in a wave-e2e container: its own backend and frontend, then the functional and visual dark tests.
#
# Callers: scripts/gate/15-playwright.sh and scripts/e2e/e2e-targeted-local.sh.
# Required env vars:
#   SHARD_INDEX          1-based shard number (1..SHARD_TOTAL)
#   SHARD_TOTAL          total number of shards
# Optional:
#   ARTIFACTS_DIR        test results folder inside the container (default /artifacts)
#   WAVE_E2E_SPECS       comma-separated spec paths relative to tests/e2e
#   TARGET_SPECS         space-separated functional spec paths; targeted mode, no type check
#   TARGET_VISUAL_SPECS  space-separated visual spec paths; targeted mode, no type check
#
# Exit code: non-zero if either the functional or visual run failed.

set -u

SHARD_INDEX="${SHARD_INDEX:?SHARD_INDEX required}"
SHARD_TOTAL="${SHARD_TOTAL:?SHARD_TOTAL required}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/artifacts}"

PREFIX="[shard-${SHARD_INDEX}/${SHARD_TOTAL}]"
log() { echo "${PREFIX} $(date +%T.%3N) $*"; }

# The same binaries npx resolves, without an npm parent process per call.
PLAYWRIGHT=(npx playwright)
if [ -x /workspace/tests/e2e/node_modules/.bin/playwright ]; then
  PLAYWRIGHT=(/workspace/tests/e2e/node_modules/.bin/playwright)
fi
VITE=(npx vite)
if [ -x /workspace/frontend/node_modules/.bin/vite ]; then
  VITE=(/workspace/frontend/node_modules/.bin/vite)
fi

log "starting shard"

# One type-check per run: shard 1 owns it, and targeted runs skip it.
if [ "$SHARD_INDEX" = "1" ] && [ -z "${TARGET_SPECS:-}" ] && [ -z "${TARGET_VISUAL_SPECS:-}" ] \
   && [ -z "${WAVE_E2E_SPECS:-}" ]; then
  log "type-checking tests/e2e"
  if ! ( set -o pipefail
         cd /workspace/tests/e2e && npm run --silent type-check 2>&1 | sed "s|^|${PREFIX} |" ); then
    log "type-check failed - fix the errors above (no tsc? run npm ci in tests/e2e)"
    exit 1
  fi
  log "type-check clean"
fi

# helpers/config.ts reads the store at the same path, through os.tmpdir().
DATA_DIR="$(dirname "$(mktemp -u)")/wave-shard-data"
CONFIG_FILE="${DATA_DIR}.config.yaml"
mkdir -p "$DATA_DIR" "$ARTIFACTS_DIR"

# Fixed ports: each shard container has its own network namespace.
BE_PORT=8000
FE_PORT=3000

# The shared compose stack on the host loopback, reached over the slirp gateway.
SSH_TARGET_HOST=10.0.2.2
SSH_MAIN_PORT=9445
SSH_NO_SFTP_PORT=9447
SSH_NO_FWD_PORT=9448

# HTTP-side services on the same gateway; config.ts already defaults HTTP_TARGET_HOST to it.
HTTP_ECHO_PORT=9449
TLS_LAB_PORT=9454
PROXY_PORT=9458
NETCAT_TCP_ECHO_PORT=9470

# ---------------------------------------------------------------------------
# Start backend
# ---------------------------------------------------------------------------
log "starting backend (uvicorn) on 127.0.0.1:${BE_PORT}"
if ! /workspace/scripts/e2e/e2e-config-with-key.sh "$CONFIG_FILE"; then
  log "could not write ${CONFIG_FILE} - see the error above"
  exit 1
fi
cd /workspace/backend
WAVE_CONFIG_FILE="$CONFIG_FILE" \
WAVE_ADMIN_ALLOWED=true \
WAVE_STORAGE_BASE_PATH="$DATA_DIR" \
WAVE_SECURITY_CORS_ORIGINS="http://localhost:${FE_PORT},http://127.0.0.1:${FE_PORT}" \
WAVE_LOG_LEVEL=WARN \
  poetry run uvicorn wavecore.api.app:app \
    --host 127.0.0.1 --port "$BE_PORT" \
    --log-level warning \
    > "$ARTIFACTS_DIR/backend.log" 2>&1 &
BE_PID=$!

# ---------------------------------------------------------------------------
# Start frontend (vite preview) of the bundle built on the host and mounted.
# ---------------------------------------------------------------------------
log "starting frontend (vite preview) on 127.0.0.1:${FE_PORT}"
cd /workspace/frontend
"${VITE[@]}" preview --outDir build --port "$FE_PORT" --strictPort --host 127.0.0.1 \
  > "$ARTIFACTS_DIR/frontend.log" 2>&1 &
FE_PID=$!

# ---------------------------------------------------------------------------
# Clean shutdown on exit, even on failure.
# ---------------------------------------------------------------------------
cleanup() {
  log "cleaning up services"
  for pid in "$FE_PID" "$BE_PID"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Up to 1 s for both to exit, then force.
  local tries=0
  while [ "$tries" -lt 20 ]; do
    kill -0 "$FE_PID" 2>/dev/null || kill -0 "$BE_PID" 2>/dev/null || break
    sleep 0.05
    tries=$(( tries + 1 ))
  done
  for pid in "$FE_PID" "$BE_PID"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Health checks - poll until each service responds or hit a 60s timeout.
# ---------------------------------------------------------------------------
wait_for_url() {
  local name="$1"
  local url="$2"
  local deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -sf -o /dev/null "$url"; then
      log "${name} ready"
      return 0
    fi
    sleep 0.2
  done
  log "${name} did not become ready in 60s"
  case "$name" in
    backend) tail -50 "$ARTIFACTS_DIR/backend.log" | sed "s|^|${PREFIX} |" ;;
    frontend) tail -50 "$ARTIFACTS_DIR/frontend.log" | sed "s|^|${PREFIX} |" ;;
  esac
  return 1
}

# Reachability over the slirp gateway of a compose port that has no HTTP health check.
wait_for_tcp() {
  local name="$1" host="$2" port="$3"
  local deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
      exec 3>&- 2>/dev/null || true
      log "${name} reachable (${host}:${port})"
      return 0
    fi
    sleep 0.2
  done
  log "${name} not reachable at ${host}:${port} in 60s (is the compose stack up?)"
  return 1
}

wait_for_url backend "http://127.0.0.1:${BE_PORT}/health" || exit 1
wait_for_url frontend "http://127.0.0.1:${FE_PORT}/" || exit 1
wait_for_tcp ssh-stack "$SSH_TARGET_HOST" "$SSH_MAIN_PORT" || exit 1
wait_for_tcp ssh-stack-no-sftp "$SSH_TARGET_HOST" "$SSH_NO_SFTP_PORT" || exit 1
wait_for_tcp ssh-stack-no-fwd "$SSH_TARGET_HOST" "$SSH_NO_FWD_PORT" || exit 1
wait_for_tcp http-echo "$SSH_TARGET_HOST" "$HTTP_ECHO_PORT" || exit 1
wait_for_tcp tls-lab "$SSH_TARGET_HOST" "$TLS_LAB_PORT" || exit 1
wait_for_tcp http-proxy "$SSH_TARGET_HOST" "$PROXY_PORT" || exit 1
wait_for_tcp netcat-echo "$SSH_TARGET_HOST" "$NETCAT_TCP_ECHO_PORT" || exit 1

log "all services ready"

# ---------------------------------------------------------------------------
# Test config env for every Playwright run.
# ---------------------------------------------------------------------------
cd /workspace/tests/e2e
export WAVE_E2E_BACKEND_PORT="$BE_PORT"
export WAVE_E2E_FRONTEND_PORT="$FE_PORT"
export SSH_TARGET_HOST="$SSH_TARGET_HOST"
export CI=1

FUNC_OUTPUT="$ARTIFACTS_DIR/functional-results"
VISUAL_OUTPUT="$ARTIFACTS_DIR/visual-results"
mkdir -p "$FUNC_OUTPUT" "$VISUAL_OUTPUT"

# Plan mode: targeted (given files), planned (this shard's bin of the profile), fallback (no profile: --shard).
WEIGHTS_FILE="/workspace/tests/e2e/shard-weights.json"
PLAN_MODE="fallback"
rm -f "$ARTIFACTS_DIR"/plan-*.txt
if [ -n "${TARGET_SPECS:-}" ] || [ -n "${TARGET_VISUAL_SPECS:-}" ]; then
  PLAN_MODE="targeted"
  log "targeted mode: functional='${TARGET_SPECS:-}' visual='${TARGET_VISUAL_SPECS:-}'"
  # The lists are space separated, one spec per word.
  read -r -a target_functional <<< "${TARGET_SPECS:-}"
  read -r -a target_visual <<< "${TARGET_VISUAL_SPECS:-}"
  printf '%s\n' "${target_functional[@]}" > "$ARTIFACTS_DIR/plan-functional.txt"
  printf '%s\n' "${target_visual[@]}" > "$ARTIFACTS_DIR/plan-visual.txt"
elif [ -f "$WEIGHTS_FILE" ]; then
  PLAN_MODE="planned"
  log "planning shard ${SHARD_INDEX}/${SHARD_TOTAL} from shard-weights.json"
  PLAN_ARGS=(--shards "$SHARD_TOTAL" --shard-index "$SHARD_INDEX" --weights "$WEIGHTS_FILE"
             --e2e-dir /workspace/tests/e2e --out-dir "$ARTIFACTS_DIR")
  if [ -n "${WAVE_E2E_SPECS:-}" ]; then
    PLAN_ARGS+=(--specs "$WAVE_E2E_SPECS")
  fi
  # Never fall back to --shard here: the other shards run planned bins, so a count-based slice would drop files.
  if ! ( set -o pipefail
         node /workspace/scripts/e2e/e2e-shard-plan.mjs "${PLAN_ARGS[@]}" 2>&1 | sed "s|^|${PREFIX} |" ); then
    log "planner failed - stopping this shard so no planned file is skipped (see the planner output above)"
    exit 1
  fi
  for plan in plan-functional.txt plan-visual.txt plan-empty-db.txt; do
    if [ ! -f "$ARTIFACTS_DIR/$plan" ]; then
      log "planner wrote no ${plan} - stopping this shard"
      exit 1
    fi
  done
elif [ -n "${WAVE_E2E_SPECS:-}" ]; then
  log "a spec list needs shard-weights.json - stopping this shard"
  exit 1
fi

FUNC_EXIT=0
VISUAL_EXIT=0

# Run one phase: the files of plan_file, every test of the selectors (plan_file "all"), or --shard=K/N.
run_phase() {
  local label="$1" plan_file="$2" json_out="$3" out_dir="$4"
  shift 4

  local mode_args=()
  if [ "$plan_file" = "all" ]; then
    log "running ${label} shard ${SHARD_INDEX}/${SHARD_TOTAL} (all tests of: $*)"
    mode_args=("$@")
  elif [ -f "$plan_file" ]; then
    local files=()
    mapfile -t files < <(grep -v '^[[:space:]]*$' "$plan_file" || true)
    if [ "${#files[@]}" -eq 0 ]; then
      log "${label}: empty plan for this shard - skipping"
      return 0
    fi
    log "running ${label} shard ${SHARD_INDEX}/${SHARD_TOTAL} (planned ${#files[@]} files)"
    mode_args=("$@" "${files[@]}")
  else
    log "running ${label} shard ${SHARD_INDEX}/${SHARD_TOTAL} (--shard fallback)"
    mode_args=("$@" --shard="${SHARD_INDEX}/${SHARD_TOTAL}")
  fi

  PLAYWRIGHT_JSON_OUTPUT_NAME="$json_out" \
    "${PLAYWRIGHT[@]}" test \
      "${mode_args[@]}" \
      --workers=1 \
      --output="$out_dir" \
      --reporter=line,json 2>&1 | sed "s|^|${PREFIX} |"
  return "${PIPESTATUS[0]}"
}

# Step 1: Functional tests (own globalSetup resets the BE first).
FUNC_START=$(date +%s)
run_phase "functional" \
  "$ARTIFACTS_DIR/plan-functional.txt" \
  "$ARTIFACTS_DIR/functional-report.json" \
  "$FUNC_OUTPUT" \
  --config=playwright.functional.config.ts
FUNC_EXIT=$?
FUNC_ELAPSED=$(( $(date +%s) - FUNC_START ))
log "functional finished in ${FUNC_ELAPSED}s (exit ${FUNC_EXIT})"

# Step 2: Visual dark tests (own globalSetup resets the BE again); a planned run runs empty-db-dark on its owner only.
VISUAL_PLAN="$ARTIFACTS_DIR/plan-visual.txt"
VISUAL_ARGS=(--project=empty-db-dark --project=no-data-dark --project=fixture-dark)
if [ "$PLAN_MODE" = "planned" ] && [ -n "${WAVE_E2E_SPECS:-}" ]; then
  # A spec list runs only its listed empty-db-dark files, so no project pulls in the whole of it.
  if [ -s "$ARTIFACTS_DIR/plan-empty-db.txt" ]; then
    log "visual dark: this shard runs the listed empty-db-dark files"
    VISUAL_PLAN="$ARTIFACTS_DIR/plan-visual-listed.txt"
    cat "$ARTIFACTS_DIR/plan-empty-db.txt" "$ARTIFACTS_DIR/plan-visual.txt" > "$VISUAL_PLAN"
  fi
  VISUAL_ARGS+=(--no-deps)
elif [ "$PLAN_MODE" = "planned" ]; then
  if [ -s "$ARTIFACTS_DIR/plan-empty-db.txt" ]; then
    log "visual dark: this shard runs empty-db-dark for the whole run"
    if ! grep -q '[^[:space:]]' "$VISUAL_PLAN"; then
      VISUAL_PLAN="all"
      VISUAL_ARGS=(--project=empty-db-dark)
    fi
  else
    VISUAL_ARGS=(--project=no-data-dark --project=fixture-dark --no-deps)
  fi
fi
VISUAL_START=$(date +%s)
run_phase "visual dark" \
  "$VISUAL_PLAN" \
  "$ARTIFACTS_DIR/visual-report.json" \
  "$VISUAL_OUTPUT" \
  "${VISUAL_ARGS[@]}"
VISUAL_EXIT=$?
VISUAL_ELAPSED=$(( $(date +%s) - VISUAL_START ))
log "visual finished in ${VISUAL_ELAPSED}s (exit ${VISUAL_EXIT})"

# Persist per-shard timing summary for the host aggregator.
{
  echo "shard=${SHARD_INDEX}/${SHARD_TOTAL}"
  echo "functional_seconds=${FUNC_ELAPSED}"
  echo "functional_exit=${FUNC_EXIT}"
  echo "visual_seconds=${VISUAL_ELAPSED}"
  echo "visual_exit=${VISUAL_EXIT}"
} > "$ARTIFACTS_DIR/summary.txt"

if [ "$FUNC_EXIT" -ne 0 ] || [ "$VISUAL_EXIT" -ne 0 ]; then
  log "shard failed (functional=${FUNC_EXIT}, visual=${VISUAL_EXIT})"
  exit 1
fi

log "shard passed"
exit 0
