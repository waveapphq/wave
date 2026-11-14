#!/usr/bin/env bash
# CodeQL scan of the working tree with the checks GitHub's default code scanning runs.
# Prints the alerts the target branch does not have and fails when there is one.
#
# Usage: ./scripts/codeql-scan.sh [--flows] [python] [javascript-typescript] [actions]
#   No language: all three. --flows also prints each alert's path from input to problem.
#
# Needs the CodeQL CLI on PATH (`codeql`), or CODEQL pointing at it.
#   CODEQL_BASE      branch to compare with; default: origin/release/<version> for a
#                    fix/<version>-* or feature/<version>-* branch, else origin/master
#   CODEQL_WORK_DIR  scratch space for sources, databases and cached results
#                    (default ~/.cache/wave-codeql; several GB while a scan runs)
#   CODEQL_RAM       MB of memory CodeQL may use (default 6000)
#   CODEQL_GITHUB_TOKEN  a GitHub token that can read code scanning alerts; with it, an
#                    alert dismissed on GitHub for this branch or its pull request is
#                    left out, matched by rule, file and the text of its line
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEQL="${CODEQL:-codeql}"
WORK="${CODEQL_WORK_DIR:-$HOME/.cache/wave-codeql}"
RAM="${CODEQL_RAM:-6000}"
FLOWS=false
LANGS=()
for arg in "$@"; do
  case "$arg" in
    --flows) FLOWS=true ;;
    python|javascript-typescript|actions) LANGS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ ${#LANGS[@]} -gt 0 ] || LANGS=(python javascript-typescript actions)

command -v "$CODEQL" > /dev/null || { echo "CodeQL CLI not found: install it and put 'codeql' on PATH, or set CODEQL" >&2; exit 2; }
cd "$ROOT"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "HEAD" ] || { echo "Detached HEAD: check out a branch first" >&2; exit 2; }
if [ -z "${CODEQL_BASE:-}" ]; then
  if [[ "$branch" =~ ^(fix|feature)/([0-9]+\.[0-9]+\.[0-9]+(-[a-z]+[0-9]+)?)- ]]; then
    CODEQL_BASE="origin/release/${BASH_REMATCH[2]}"
  else
    CODEQL_BASE="origin/master"
  fi
fi
git fetch --quiet origin
base_sha="$(git merge-base HEAD "$CODEQL_BASE")"
version="$("$CODEQL" version --format=terse)"
echo "CodeQL $version: $branch (working tree) against $CODEQL_BASE (${base_sha:0:7})"

mkdir -p "$WORK"
head_src="$WORK/src-head"
base_src="$WORK/src-base-$base_sha"

# The files a push would carry: tracked and new, never ignored build output.
rm -rf "$head_src"; mkdir -p "$head_src"
git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do [ -f "$f" ] && printf '%s\0' "$f"; done \
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

# Alerts dismissed on GitHub, as rule, file and line text, so a moved line still matches.
dismissed="$WORK/dismissed.json"
python3 -I - "$dismissed" "$branch" "$(git remote get-url origin)" <<'PY'
import json, os, re, subprocess, sys, urllib.parse, urllib.request

out, branch, remote = sys.argv[1], sys.argv[2], sys.argv[3]
token = os.environ.get("CODEQL_GITHUB_TOKEN", "")
found = []
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
                    if text is not None:
                        found.append([alert["rule"]["id"], loc["path"], text])
                if len(alerts) < 100:
                    break
                page += 1
        print(f"{len(found)} alerts dismissed on GitHub are left out")
    except Exception as error:  # a failed read leaves nothing out; the scan still reports
        print(f"Could not read the alerts dismissed on GitHub ({error}); none are left out")
        found = []
json.dump(found, open(out, "w"))
PY

status=0
for lang in "${LANGS[@]}"; do
  base_sarif="$WORK/base-$base_sha-$lang-$version.sarif"
  if [ ! -f "$base_sarif" ]; then
    echo "Scanning $CODEQL_BASE for $lang (kept until that branch moves)..."
    if [ ! -d "$base_src" ]; then
      mkdir -p "$base_src"
      git archive "$base_sha" | tar -xf - -C "$base_src"
    fi
    scan "$base_src" "$lang" "$base_sarif.tmp" && mv "$base_sarif.tmp" "$base_sarif"
  fi
  echo "Scanning the working tree for $lang..."
  head_sarif="$WORK/head-$lang.sarif"
  scan "$head_src" "$lang" "$head_sarif"
  python3 -I - "$base_sarif" "$head_sarif" "$lang" "$FLOWS" "$dismissed" "$head_src" <<'PY' || status=1
import json, sys

base_path, head_path, lang, flows = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "true"
dismissed = {tuple(d) for d in json.load(open(sys.argv[5]))}
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

def is_dismissed(result):
    phys = result["locations"][0]["physicalLocation"]
    path, line = phys["artifactLocation"]["uri"], phys.get("region", {}).get("startLine", 0)
    try:
        lines = open(f"{head_src}/{path}", encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return False
    text = lines[line - 1].strip() if 0 < line <= len(lines) else None
    return (result["ruleId"], path, text) in dismissed

_, base = results(base_path)
run, head = results(head_path)
known = {key(r) for r in base}
unknown = [r for r in head if key(r) not in known]
new = [r for r in unknown if not is_dismissed(r)]
skipped = len(unknown) - len(new)
print(f"{lang}: {len(head)} alerts, {len(new)} new against the target branch"
      + (f" ({skipped} more dismissed on GitHub)" if skipped else ""))
for r in sorted(new, key=lambda r: (r["ruleId"], where(r["locations"][0]))):
    print(f'  {r.get("level", "warning"):8} {r["ruleId"]}  {where(r["locations"][0])}')
    print(f'           {r["message"]["text"].splitlines()[0]}')
    if flows:
        for flow in r.get("codeFlows", [])[:1]:
            for step in flow["threadFlows"][0]["locations"]:
                loc = step["location"]
                text = loc.get("message", {}).get("text", "")
                print(f"             -> {where(loc)}  {text}")
sys.exit(1 if new else 0)
PY
done

rm -rf "$head_src" "$base_src"
exit "$status"
