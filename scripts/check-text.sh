#!/bin/bash
# Fails on spelling that typos.toml does not allow, em or en dashes, and process markers in source comments.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
status=0

echo "Checking spelling with typos (poetry install in backend/ installs it)..."
git -c core.quotepath=off grep -Il --untracked '' | poetry -P backend run typos --force-exclude --file-list - || status=1

echo "Checking for em and en dashes..."
if LC_ALL=C git grep -InF --untracked -e $'\xe2\x80\x93' -e $'\xe2\x80\x94'; then
  status=1
fi

# Planning references fail; REQ-*, design IDs and COV-* stay.
echo "Checking source comments for process markers..."
lead='(^|[\s{])(#|//|/\*|\*|<!--|-- )'
marker='(?i:\b(roadmap|handoff)\b|\bsession [0-9]|\bbatch [a-h]\b|\bphase[ -]?[0-9]|\bphase: *[0-9]|\.tmp/|\buser[- ](reported|ruling|ruled|clarified)\b|\b(issue|ticket) #[0-9])|§|\b(DD|PS5|GAP)-[0-9]+|\b1[0-2]\.[0-9]+(\.[0-9]+)*[ /](#|batch|group|session|[A-H]\b)'
if LC_ALL=C git grep -InP --untracked "$lead.*($marker)" -- ':!*.md' ':!*.json' ':!*.lock' ':!scripts/check-text.sh'; then
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "❌ Text checks failed. Fix each line listed above."
fi
exit "$status"
