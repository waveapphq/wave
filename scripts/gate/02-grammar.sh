#!/bin/bash
# Gate 02: spelling that typos.toml does not allow, em or en dashes, and process markers in source comments.
#
# Usage: ./scripts/gate/02-grammar.sh

NUMBER="02"
CHECK="Grammar and Comments"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/02-grammar.log"

[ "$#" -eq 0 ] || { echo "Usage: $0" >&2; exit 2; }

mkdir -p "$ROOT/ci-output"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

cd "$ROOT" || exit 2
FAILED=()

echo "Checking spelling with typos (poetry install in backend/ installs it)..."
git -c core.quotepath=off grep -Il --untracked '' | poetry -P backend run typos --force-exclude --file-list - || FAILED+=(spelling)

echo "Checking for em and en dashes..."
if LC_ALL=C git grep -InF --untracked -e $'\xe2\x80\x93' -e $'\xe2\x80\x94'; then
  FAILED+=(dashes)
fi

# Planning references fail; REQ-*, design IDs and COV-* stay.
echo "Checking source comments for process markers..."
lead='(^|[\s{])(#|//|/\*|\*|<!--|-- )'
marker='(?i:\broadmap\b|\bsession [0-9]|\bbatch [a-h]\b|\bphase[ -]?[0-9]|\bphase: *[0-9]|\.tmp/|\buser[- ](reported|ruling|ruled|clarified)\b|\b(issue|ticket) #[0-9]|\bblueprint|\bapproved (mockup|render|variant)|\bper (the )?user'\''?s? (spec|request|clarified)\b|\bby ruling\b|\bthe ruled\b|\bre(work|worked|design|designed)\b|\bfuture phase\b|\bitem [0-9]+ -|\b(fails|red) until\b|\bRED proof\b|\bTDD tests? for\b)|§|\b(DD|PS5|GAP)-[0-9]+|\b1[0-2]\.[0-9]+(\.[0-9]+)*[ /](#|batch|group|session|[A-H]\b)'
if LC_ALL=C git grep -InP --untracked "$lead.*($marker)" -- ':!*.md' ':!*.json' ':!*.lock' ':!scripts/gate/02-grammar.sh'; then
  markers=1
fi

# Python docstring lines and inner block comment lines, which the line pattern above cannot see.
if ! git -c core.quotepath=off ls-files -co --exclude-standard -z \
    -- '*.py' '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' ':!scripts/gate/02-grammar.sh' \
    | CHECK_LEAD="$lead" CHECK_MARKER="$marker" python3 -c '
import os, re, sys

lead_hit = re.compile(os.environ["CHECK_LEAD"] + ".*(" + os.environ["CHECK_MARKER"] + ")")
marker = re.compile(os.environ["CHECK_MARKER"])
docstring_open = re.compile(r"^\s*[rRuU]?(\"\"\"|\x27\x27\x27)")
block_open = re.compile(r"(^|[\s{;])/\*")


def lines_to_read(path, lines):
    if path.endswith(".py"):
        quote = None
        for number, line in enumerate(lines, 1):
            if quote is None:
                opened = docstring_open.match(line)
                if not opened:
                    continue
                quote = opened.group(1)
                yield number, line
                if line.count(quote) >= 2:
                    quote = None
            else:
                yield number, line
                if quote in line:
                    quote = None
    else:
        inside = False
        for number, line in enumerate(lines, 1):
            if inside:
                yield number, line
                inside = "*/" not in line
            else:
                opened = block_open.search(line)
                inside = bool(opened) and "*/" not in line[opened.end():]


found = False
for path in sys.stdin.read().split("\0"):
    if not path or not os.path.isfile(path):
        continue
    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()
    for number, line in lines_to_read(path, lines):
        if marker.search(line) and not lead_hit.search(line):
            print(f"{path}:{number}:{line}")
            found = True
sys.exit(1 if found else 0)
'; then
  markers=1
fi

[ -z "${markers:-}" ] || FAILED+=("process markers")
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "❌ Text checks failed. Fix each line listed above."
  reason=$(printf ', %s' "${FAILED[@]}")
  echo "$NUMBER $CHECK: failed (${reason:2})"
  echo "Log: $LOG"
  exit 1
fi
echo "$NUMBER $CHECK: passed"
echo "Log: $LOG"
