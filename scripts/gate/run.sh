#!/bin/bash
# The gate runner: runs the gate scripts a change needs, in number order, and stops at the first
# failure. The container checks, 04 to 09, run inside one wave-ci container. It ends with the
# proof table of the scripts it covered and exits 0 only when every needed script passed.
#
# Usage: ./scripts/gate/run.sh [backend] [frontend] [e2e] [scripts] [--playwright full|<spec> ...]
#   No area: the changed files pick the scripts: the diff against the merge base of HEAD and
#   origin/release/<version> for a fix or feature branch, else origin/master, plus uncommitted
#   and untracked files. Named areas pick them instead, with 01, 02 and 03 always and 12 for
#   the areas' languages. Playwright runs only with --playwright, after every other script.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_DIR="$ROOT/scripts/gate"
IMAGE="wave-ci:latest"
CONTAINER_GATES=(4 5 6 7 8 9)

usage() {
  echo "Usage: $0 [backend] [frontend] [e2e] [scripts] [--playwright full|<spec> ...]" >&2
  exit 2
}

AREAS=()
PLAYWRIGHT=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    backend|frontend|e2e|scripts) AREAS+=("$1") ;;
    --playwright)
      shift
      [ "$#" -gt 0 ] || usage
      PLAYWRIGHT=("$@")
      break
      ;;
    *) usage ;;
  esac
  shift
done

declare -A NAME=(
  [1]="Branch name" [2]="Grammar and Comments" [3]="Orphaned files and exclusion IDs"
  [4]="Backend static" [5]="Frontend static" [6]="E2E types" [7]="Frontend build"
  [8]="Backend tests" [9]="Frontend tests" [10]="SonarQube backend" [11]="SonarQube frontend"
  [12]="CodeQL" [13]="SonarQube exclusions" [14]="CodeQL exclusions" [15]="Playwright"
)
declare -A FILE
for path in "$GATE_DIR"/[0-9][0-9]-*.sh; do
  base="${path##*/}"
  FILE[$((10#${base:0:2}))]="$base"
done
declare -A NEED RESULT NUMBERS
LANGS=()

need() {
  local n
  for n in "$@"; do
    NEED[$n]=1
  done
}
lang() {
  local l
  for l in "${LANGS[@]}"; do
    [ "$l" = "$1" ] && return
  done
  LANGS+=("$1")
}

cd "$ROOT" || exit 2
need 1
if [ "${#AREAS[@]}" -gt 0 ]; then
  need 2 3
  for area in "${AREAS[@]}"; do
    case "$area" in
      backend) need 4 8 10; lang python ;;
      frontend) need 5 7 9 11; lang javascript-typescript ;;
      e2e) need 6; lang javascript-typescript ;;
      scripts) need 8; lang python; lang javascript-typescript ;;
    esac
  done
else
  branch="$(git rev-parse --abbrev-ref HEAD 2> /dev/null)"
  base_ref="origin/master"
  for re in '^(fix|feature)/([0-9]+\.[0-9]+\.[0-9]+-[a-z]+[0-9]+)-' '^(fix|feature)/([0-9]+\.[0-9]+\.[0-9]+)-'; do
    if [[ "$branch" =~ $re ]] && git rev-parse --verify --quiet "refs/remotes/origin/release/${BASH_REMATCH[2]}" > /dev/null; then
      base_ref="origin/release/${BASH_REMATCH[2]}"
      break
    fi
  done
  if ! base_sha="$(git merge-base HEAD "$base_ref" 2> /dev/null)"; then
    echo "Cannot compare with $base_ref: it is not in this clone. Run git fetch origin, or name the areas." >&2
    exit 2
  fi
  echo "Changes against $base_ref (${base_sha:0:7}), with uncommitted and untracked files"
  mapfile -t CHANGED < <( { git diff --name-only "$base_sha"; git ls-files --others --exclude-standard; } | sort -u)
  for f in "${CHANGED[@]}"; do
    [ -f "$f" ] && grep -Iq '' "$f" && need 2
    case "$f" in
      frontend/src/*|backend/wavecore/*|tests/exclusions/*) need 3 ;;
    esac
    case "$f" in
      backend/*) need 4 8 10; lang python ;;
      frontend/*) need 5 7 9 11; lang javascript-typescript ;;
      tests/e2e/*) need 6; lang javascript-typescript ;;
      .github/scripts/*) lang javascript-typescript ;;
      .github/workflows/*) lang actions ;;
    esac
    case "$f" in
      scripts/*) need 8 ;;
    esac
    case "$f" in
      scripts/*.py) lang python ;;
      scripts/*.mjs) lang javascript-typescript ;;
    esac
  done
fi
[ "${#LANGS[@]}" -eq 0 ] || need 12
if [ -n "${NEED[10]:-}" ] || [ -n "${NEED[11]:-}" ]; then
  need 13
fi
[ -z "${NEED[12]:-}" ] || need 14
[ "${#PLAYWRIGHT[@]}" -eq 0 ] || need 15

OUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUT_DIR"' EXIT

# The script's result line, as `passed` or `failed (<reason>)`, or the exit code it ended with.
read_result() { # read_result <number> <output file> <exit code>
  local n="$1" line prefix
  prefix="$(printf '%02d' "$n") ${NAME[$n]}: "
  line="$(grep -F "$prefix" "$2" | tail -n 1)"
  if [ -n "$line" ]; then
    RESULT[$n]="${line#"$prefix"}"
  elif [ "$3" -eq 0 ]; then
    RESULT[$n]="passed"
  else
    RESULT[$n]="failed (exit $3)"
  fi
  if [ "$3" -ne 0 ] && [[ "${RESULT[$n]}" == passed ]]; then
    RESULT[$n]="failed (exit $3)"
  fi
}

run_host() { # run_host <number> [arg]...
  local n="$1" start code
  shift
  start=$(date +%s)
  "$GATE_DIR/${FILE[$n]}" "$@" 2>&1 | tee "$OUT_DIR/$n"
  code=${PIPESTATUS[0]}
  NUMBERS[$n]="$(( $(date +%s) - start )) s"
  read_result "$n" "$OUT_DIR/$n" "$code"
  return "$code"
}

run_container() { # run_container <number>...: the needed container checks in one wave-ci container
  local scripts=() n start code
  for n in "$@"; do
    scripts+=("${FILE[$n]}")
  done
  start=$(date +%s)
  if ! podman image exists "$IMAGE"; then
    echo "CI image not found: $IMAGE. Build it with ./scripts/images/build-ci-image.sh"
    RESULT[$1]="failed (CI image $IMAGE not found)"
    return 1
  fi
  # keep-id maps the host user to ciuser, so the container writes files the host user owns.
  podman run --rm --userns=keep-id -v "$ROOT:/workspace" -w /workspace \
    -e WAVE_IN_CI_CONTAINER=1 -e WAVE_CI_PROGRESS_SECONDS -e CI_PYTEST_WORKERS "$IMAGE" \
    bash -c 'for script in "$@"; do /workspace/scripts/gate/"$script" || exit; done' gates "${scripts[@]}" 2>&1 \
    | sed -u "s#^Log: /workspace/#Log: $ROOT/#" | tee "$OUT_DIR/container"
  code=${PIPESTATUS[0]}
  # The container writes /workspace paths; a SonarQube scan on the host reads the clone's paths.
  if [ -f "$ROOT/backend/coverage.xml" ]; then
    sed -i "s#/workspace/backend#$ROOT/backend#g" "$ROOT/backend/coverage.xml"
  fi
  for n in "$@"; do
    NUMBERS[$n]="$(( $(date +%s) - start )) s, one container for 04 to 09"
    if grep -qF "$(printf '%02d' "$n") ${NAME[$n]}: " "$OUT_DIR/container"; then
      read_result "$n" "$OUT_DIR/container" 0
    elif [ "$code" -ne 0 ] && [ -z "${RESULT[$n]:-}" ] && [ -z "$failed_seen" ]; then
      RESULT[$n]="failed (exit $code)"
    fi
    [[ "${RESULT[$n]:-}" != failed* ]] || failed_seen=1
  done
  return "$code"
}

failed_seen=""
container_done=""
for n in $(seq 1 15); do
  [ -n "${NEED[$n]:-}" ] || continue
  [ -z "$failed_seen" ] || break
  case "$n" in
    4|5|6|7|8|9)
      [ -z "$container_done" ] || continue
      container_done=1
      needed=()
      for c in "${CONTAINER_GATES[@]}"; do
        [ -z "${NEED[$c]:-}" ] || needed+=("$c")
      done
      run_container "${needed[@]}" || failed_seen=1
      ;;
    12) run_host 12 "${LANGS[@]}" || failed_seen=1 ;;
    15) run_host 15 "${PLAYWRIGHT[@]}" || failed_seen=1 ;;
    *) run_host "$n" || failed_seen=1 ;;
  esac
done

if [ -n "${RESULT[15]:-}" ]; then
  total="$(grep -oE 'Total Playwright tests run: [0-9]+ \(across [0-9]+ shards\)' "$OUT_DIR/15" | tail -n 1)"
  if [[ "$total" =~ ([0-9]+)\ \(across\ ([0-9]+) ]]; then
    seconds="${NUMBERS[15]% s}"
    NUMBERS[15]="${BASH_REMATCH[1]} tests on ${BASH_REMATCH[2]} shards in $(( (seconds + 59) / 60 )) min"
  fi
fi

echo ""
echo "| # | Gate check | Script | Result | Numbers |"
echo "|---|---|---|---|---|"
status=0
for n in $(seq 1 15); do
  name="${NAME[$n]}"
  if [ "$n" -eq 15 ] && [ "${PLAYWRIGHT[*]}" = "full" ]; then
    name="Playwright, full"
  fi
  if [ -z "${NEED[$n]:-}" ]; then
    cell="skipped: not needed"
  elif [ -n "${RESULT[$n]:-}" ]; then
    cell="${RESULT[$n]}"
    [ "$cell" = "passed" ] || status=1
  else
    cell="not run: an earlier check failed"
    status=1
  fi
  printf '| %02d | %s | %s | %s | %s |\n' "$n" "$name" "${FILE[$n]:-}" "$cell" "${NUMBERS[$n]:-}"
done
exit "$status"
