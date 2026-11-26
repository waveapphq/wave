#!/bin/bash
# Gate 01: the name of the current branch, or with --pr the head and base branches of a pull request.
#
# Usage: ./scripts/gate/01-branch-name.sh
#        ./scripts/gate/01-branch-name.sh --pr <head> <base>

# Byte ranges, so [a-z] never matches letters outside ASCII.
export LC_ALL=C

NUMBER="01"
CHECK="Branch name"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$ROOT/ci-output/01-branch-name.log"

core='[0-9]+\.[0-9]+\.[0-9]+'
suffix='-[a-z]+[0-9]+'
version="${core}(${suffix})?"
name='[a-z0-9]+(-[a-z0-9]+)*'
release_re="^release/${version}\$"
change_re="^(fix|feature)/${version}-${name}\$"
name_re="^${name}\$"
# The two ways to read the version of a fix or feature branch, longest first.
suffixed_re="^(fix|feature)/(${core}${suffix})-${name}\$"
plain_re="^(fix|feature)/(${core})-${name}\$"

usage() {
  echo "Usage: $0" >&2
  echo "       $0 --pr <head> <base>" >&2
  exit 2
}

case "$#:${1:-}" in
  0:) MODE=current ;;
  3:--pr) MODE=pr ;;
  *) usage ;;
esac

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

parts() {
  echo "  <version> is three numbers with dots, such as 1.0.0, with an optional suffix such as -alpha62."
  echo "  <name> is lowercase letters, digits and single hyphens, with no hyphen at the start or end."
}

names() {
  echo "Allowed branch names:"
  echo "  master"
  echo "  release/<version>          such as release/1.0.0-alpha62"
  echo "  fix/<version>-<name>       such as fix/1.0.0-alpha62-ssh-timeout"
  echo "  feature/<version>-<name>   such as feature/1.0.0-alpha62-csv-export"
  parts
}

check_release() {
  local branch="$1" re v missing=()
  for re in "$suffixed_re" "$plain_re"; do
    [[ "$branch" =~ $re ]] || continue
    v="${BASH_REMATCH[2]}"
    if git -C "$ROOT" rev-parse --verify --quiet "refs/remotes/origin/release/$v" > /dev/null; then
      echo "'$branch' belongs to origin/release/$v."
      result 0
    fi
    missing+=("origin/release/$v")
  done
  echo "  A fix or feature branch has the version of its release branch, such as fix/1.0.0-alpha62-ssh-timeout for release/1.0.0-alpha62."
  echo "  If that release branch should exist, fetch it with: git fetch origin"
  if [ "${#missing[@]}" -eq 1 ]; then
    result 1 "the branch '$branch' needs the release branch ${missing[0]}, which is not in this clone"
  fi
  result 1 "the branch '$branch' needs the release branch ${missing[0]} or ${missing[1]}, and neither is in this clone"
}

check_current() {
  local branch
  if ! branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"; then
    result 1 "the current branch could not be read"
  fi
  if [ "$branch" = "HEAD" ]; then
    echo "Check out a branch first, such as with: git switch fix/1.0.0-alpha62-ssh-timeout"
    result 1 "HEAD is detached, so there is no branch name to check"
  fi
  if [ "$branch" = "master" ] || [[ "$branch" =~ $release_re ]]; then
    echo "'$branch' is an allowed branch name."
    result 0
  fi
  [[ "$branch" =~ $change_re ]] && check_release "$branch"
  names
  echo "Rename the branch with: git branch -m <new-name>"
  result 1 "the branch '$branch' has a name that is not allowed"
}

check_pr() {
  local head="$1" base="$2" v kind prefix
  if [ "$base" = "master" ]; then
    if [[ "$head" =~ $release_re ]]; then
      echo "'$head' into '$base'."
      result 0
    fi
    echo "  This pull request comes from '$head'."
    parts
    result 1 "a pull request into master must come from release/<version>, such as release/1.0.0-alpha62"
  fi
  if [[ "$base" =~ $release_re ]]; then
    v="${base#release/}"
    for kind in fix feature; do
      prefix="$kind/$v-"
      if [[ "$head" == "$prefix"* && "${head#"$prefix"}" =~ $name_re ]]; then
        echo "'$head' into '$base'."
        result 0
      fi
    done
    echo "  This pull request comes from '$head'."
    parts
    result 1 "a pull request into $base must come from fix/$v-<name> or feature/$v-<name>, with the same version, such as fix/$v-ssh-timeout"
  fi
  echo "  This pull request goes into '$base'."
  parts
  result 1 "a pull request must go into master or into release/<version>, such as release/1.0.0-alpha62"
}

if [ "$MODE" = pr ]; then
  check_pr "$2" "$3"
fi
check_current
