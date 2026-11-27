#!/usr/bin/env bash
# Gate 12: a CodeQL scan of the branch's languages; fails on an alert the target branch does not have.
#
# Usage: ./scripts/gate/12-codeql.sh [--all] [--flows] [python] [javascript-typescript] [actions]
#   No language: each language the branch changes, uncommitted and new files included.
#   --flows also prints each alert's path from input to problem.
#   --all reports every alert of the working tree, with no target branch scan; no language means all three.
# Needs the CodeQL CLI on PATH, or CODEQL pointing at it.
#   CODEQL_BASE          target (origin/release/<version> for fix and feature branches, else origin/master)
#   CODEQL_WORK_DIR      scratch space, several GB while a scan runs (default ~/.cache/wave-codeql)
#   CODEQL_RAM           MB of memory CodeQL may use (default 6000)
#   CODEQL_GITHUB_TOKEN  reads code scanning alerts: skips dismissed ones, reads the target's analysis
set -euo pipefail

NUMBER="12"
CHECK="CodeQL"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/12-codeql.log"
CODEQL="${CODEQL:-codeql}"
WORK="${CODEQL_WORK_DIR:-$HOME/.cache/wave-codeql}"
RAM="${CODEQL_RAM:-6000}"
FLOWS=false
ALL=false
LANGS=()
for arg in "$@"; do
  case "$arg" in
    --flows) FLOWS=true ;;
    --all) ALL=true ;;
    python|javascript-typescript|actions) LANGS+=("$arg") ;;
    *) echo "Usage: $0 [--all] [--flows] [python] [javascript-typescript] [actions]" >&2; exit 2 ;;
  esac
done

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
# Any other failed command stops the check, as a setup error.
trap 'result 2 "a command failed at line $LINENO, exit $?"' ERR

command -v "$CODEQL" > /dev/null || result 2 "CodeQL CLI not found: install it and put 'codeql' on PATH, or set CODEQL"
cd "$ROOT" || exit 2

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "HEAD" ] || result 2 "HEAD is detached; check out a branch first"
version="$("$CODEQL" version --format=terse)" || result 2 "the CodeQL CLI could not be run"
base_src=""
if $ALL; then
  echo "CodeQL $version: $branch (working tree), every alert"
else
  if [ -z "${CODEQL_BASE:-}" ]; then
    if [[ "$branch" =~ ^(fix|feature)/([0-9]+\.[0-9]+\.[0-9]+(-[a-z]+[0-9]+)?)- ]]; then
      CODEQL_BASE="origin/release/${BASH_REMATCH[2]}"
    else
      CODEQL_BASE="origin/master"
    fi
  fi
  git fetch --quiet origin || result 2 "git fetch origin failed"
  base_sha="$(git merge-base HEAD "$CODEQL_BASE")" || result 2 "$CODEQL_BASE is not in this clone"
  echo "CodeQL $version: $branch (working tree) against $CODEQL_BASE (${base_sha:0:7})"
  base_src="$WORK/src-base-$base_sha"
fi

if [ ${#LANGS[@]} -eq 0 ] && $ALL; then
  LANGS=(python javascript-typescript actions)
elif [ ${#LANGS[@]} -eq 0 ]; then
  # The changed files: commits since the base, uncommitted changes and new files.
  changed="$( { git diff --name-only "$base_sha"; git ls-files --others --exclude-standard; } | sort -u)"
  grep -qE '^backend/|^scripts/.*\.py$' <<< "$changed" && LANGS+=(python)
  grep -qE '^(frontend|tests/e2e|\.github/scripts)/|^scripts/.*\.mjs$' <<< "$changed" && LANGS+=(javascript-typescript)
  grep -qE '^\.github/workflows/' <<< "$changed" && LANGS+=(actions)
  if [ ${#LANGS[@]} -eq 0 ]; then
    echo "The branch changes no file of a language CodeQL scans."
    result 0
  fi
fi
echo "Languages: ${LANGS[*]}"

mkdir -p "$WORK"
head_src="$WORK/src-head"

# The files a push would carry: tracked and new, never ignored build output.
rm -rf "$head_src"; mkdir -p "$head_src"
git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do if [ -f "$f" ]; then printf '%s\0' "$f"; fi; done \
  | tar --null -T - -cf - | tar -xf - -C "$head_src"

scan() { # scan <source dir> <language> <sarif out>; CodeQL's own output goes to a log beside the result
  local db="$WORK/db-$2"
  local pack="${2%%-*}"
  local log="${3%.tmp}"; log="${log%.sarif}.log"
  if ! { "$CODEQL" database create "$db" --language="$2" --source-root="$1" --overwrite \
           --threads=0 --ram="$RAM" \
         && "$CODEQL" database analyze "$db" "codeql/$pack-queries:codeql-suites/$pack-code-scanning.qls" \
           --format=sarif-latest --output="$3" --threads=0 --ram="$RAM"; } > "$log" 2>&1; then
    echo "CodeQL failed for $2; the end of $log:" >&2
    tail -n 20 "$log" >&2
    return 1
  fi
  rm -rf "$db"
}

# Alerts dismissed on GitHub, as rule, file, line text and line, so a moved line still matches.
dismissed="$WORK/dismissed.json"
python3 -I - "$dismissed" "$branch" "$(git remote get-url origin)" <<'PY'
import json, os, re, subprocess, sys, urllib.parse, urllib.request

out, branch, remote = sys.argv[1], sys.argv[2], sys.argv[3]
token = os.environ.get("CODEQL_GITHUB_TOKEN", "")
found = {}
if not token:
    print("CODEQL_GITHUB_TOKEN not set: alerts dismissed on GitHub are not left out")
else:
    repo = re.search(r"github\.com[:/](.+?)(\.git)?$", remote).group(1)

    def api(path):
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/{path}")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", "application/vnd.github+json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)

    shown_files = {}

    def line_text(sha, path, line):
        if (sha, path) not in shown_files:
            show = ["git", "show", f"{sha}:{path}"]
            shown = subprocess.run(show, capture_output=True, text=True)
            if shown.returncode != 0:  # a commit only GitHub has, such as a pull request merge
                subprocess.run(["git", "fetch", "--quiet", "origin", sha], capture_output=True)
                shown = subprocess.run(show, capture_output=True, text=True)
            shown_files[sha, path] = shown.stdout.splitlines() if shown.returncode == 0 else []
        lines = shown_files[sha, path]
        return lines[line - 1].strip() if 0 < line <= len(lines) else None

    try:
        owner = repo.split("/")[0]
        pulls = api(f"pulls?state=open&head={urllib.parse.quote(owner + ':' + branch)}")
        refs = [f"refs/heads/{branch}"] + [f"refs/pull/{p['number']}/head" for p in pulls]
        for ref in refs:
            page = 1
            while True:
                alerts = api(f"code-scanning/alerts?state=dismissed&per_page=100&page={page}&ref={urllib.parse.quote(ref)}")
                for alert in alerts:
                    inst = alert["most_recent_instance"]
                    loc = inst["location"]
                    text = line_text(inst["commit_sha"], loc["path"], loc["start_line"])
                    if text is not None:  # by number: a branch and its pull request list the same alert
                        found[alert["number"]] = [alert["rule"]["id"], loc["path"], text, loc["start_line"]]
                if len(alerts) < 100:
                    break
                page += 1
        print(f"{len(found)} alerts dismissed on GitHub are left out")
    except Exception as error:  # a failed read leaves nothing out; the scan still reports
        print(f"Could not read the alerts dismissed on GitHub ({error}); none are left out")
        found = {}
json.dump(list(found.values()), open(out, "w"))
PY

github_base() { # github_base <sha> <language> <sarif out>: GitHub's CodeQL analysis of that commit, if it has one
  [ -n "${CODEQL_GITHUB_TOKEN:-}" ] || return 1
  python3 -I - "$1" "$2" "$3" "$(git remote get-url origin)" "${CODEQL_BASE#origin/}" <<'PY'
import json, os, re, sys, urllib.parse, urllib.request

sha, lang, out, remote, base = sys.argv[1:6]
repo = re.search(r"github\.com[:/](.+?)(\.git)?$", remote).group(1)

def api(path, accept="application/vnd.github+json"):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/{path}")
    req.add_header("Authorization", f"Bearer {os.environ['CODEQL_GITHUB_TOKEN']}")
    req.add_header("Accept", accept)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

try:
    ref = urllib.parse.quote(f"refs/heads/{base}")
    for page in range(1, 6):
        analyses = api(f"code-scanning/analyses?ref={ref}&per_page=100&page={page}")
        hit = next((a for a in analyses if a["tool"]["name"] == "CodeQL" and a["commit_sha"] == sha
                    and a.get("category", "").strip("/") == f"language:{lang}"), None)
        if hit or len(analyses) < 100:
            break
    if not hit:
        print(f"GitHub has no CodeQL analysis of {sha[:7]} for {lang}")
        sys.exit(1)
    sarif = api(f"code-scanning/analyses/{hit['id']}", "application/sarif+json")
except Exception as error:
    print(f"Could not read GitHub's CodeQL analysis of {sha[:7]} for {lang} ({error})")
    sys.exit(1)
json.dump(sarif, open(out, "w"))
print(f"Target branch for {lang}: GitHub's analysis of {sha[:7]} (CodeQL {hit['tool']['version']})")
PY
}

failed_langs=()
for lang in "${LANGS[@]}"; do
  base_sarif=""
  $ALL || base_sarif="$WORK/base-$base_sha-$lang-$version.sarif"
  if [ -n "$base_sarif" ] && [ ! -f "$base_sarif" ]; then
    gh_sarif="$WORK/base-$base_sha-$lang-github.sarif"
    if [ -f "$gh_sarif" ] || github_base "$base_sha" "$lang" "$gh_sarif"; then
      base_sarif="$gh_sarif"
    fi
  fi
  if [ -n "$base_sarif" ] && [ ! -f "$base_sarif" ]; then
    echo "Scanning $CODEQL_BASE for $lang (kept until that branch moves)..."
    if [ ! -d "$base_src" ]; then
      mkdir -p "$base_src"
      git archive "$base_sha" | tar -xf - -C "$base_src"
    fi
    if ! scan "$base_src" "$lang" "$base_sarif.tmp"; then
      failed_langs+=("$lang: the target branch scan failed")
      continue
    fi
    mv "$base_sarif.tmp" "$base_sarif"
  fi
  echo "Scanning the working tree for $lang..."
  head_sarif="$WORK/head-$lang.sarif"
  if ! scan "$head_src" "$lang" "$head_sarif"; then
    failed_langs+=("$lang: the scan failed")
    continue
  fi
  python3 -I - "$base_sarif" "$head_sarif" "$lang" "$FLOWS" "$dismissed" "$head_src" <<'PY' || failed_langs+=("$lang: new alerts")
import json, sys

base_path, head_path, lang, flows = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "true"
dismissed = json.load(open(sys.argv[5]))
head_src = sys.argv[6]

def results(path):
    run = json.load(open(path))["runs"][0]
    return run, run.get("results", [])

def key(result):
    loc = result["locations"][0]["physicalLocation"]
    fingerprint = result.get("partialFingerprints", {}).get("primaryLocationLineHash", "")
    return result["ruleId"], loc["artifactLocation"]["uri"], fingerprint

def where(location):
    phys = location["physicalLocation"]
    return f'{phys["artifactLocation"]["uri"]}:{phys.get("region", {}).get("startLine", "?")}'

def spot(result):
    phys = result["locations"][0]["physicalLocation"]
    path, line = phys["artifactLocation"]["uri"], phys.get("region", {}).get("startLine", 0)
    try:
        lines = open(f"{head_src}/{path}", encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return None, line
    text = lines[line - 1].strip() if 0 < line <= len(lines) else None
    return (result["ruleId"], path, text), line

run, head = results(head_path)
spots = [spot(r) for r in head]
gone = set()
for rule, path, text, line in dismissed:  # one result per dismissed alert, so a twin line stays listed
    hits = [i for i, (k, _) in enumerate(spots) if k == (rule, path, text) and i not in gone]
    if hits:
        gone.add(min(hits, key=lambda i: abs(spots[i][1] - line)))
unknown = range(len(head))
if base_path:  # empty with --all: every alert counts
    known = {key(r) for r in results(base_path)[1]}
    unknown = [i for i in unknown if key(head[i]) not in known]
listed = [head[i] for i in unknown if i not in gone]
skipped = len(unknown) - len(listed)
print(f"{lang}: {len(head)} alerts, {len(listed)} " + ("new against the target branch" if base_path else "listed")
      + (f" ({skipped} more dismissed on GitHub)" if skipped else ""))
for r in sorted(listed, key=lambda r: (r["ruleId"], where(r["locations"][0]))):
    print(f'  {r.get("level", "warning"):8} {r["ruleId"]}  {where(r["locations"][0])}')
    print(f'           {r["message"]["text"].splitlines()[0]}')
    if flows:
        for flow in r.get("codeFlows", [])[:1]:
            for step in flow["threadFlows"][0]["locations"]:
                loc = step["location"]
                text = loc.get("message", {}).get("text", "")
                print(f"             -> {where(loc)}  {text}")
sys.exit(1 if listed else 0)
PY
done

rm -rf "$head_src" "$base_src"
if [ ${#failed_langs[@]} -gt 0 ]; then
  reason=$(printf ', %s' "${failed_langs[@]}")
  result 1 "${reason:2}"
fi
result 0
