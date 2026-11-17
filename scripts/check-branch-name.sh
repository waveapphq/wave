#!/bin/bash
# Checks the name of the current branch, or with --pr the head and base branches of a pull request.
#
# Usage: ./scripts/check-branch-name.sh
#        ./scripts/check-branch-name.sh --pr <head> <base>

# Byte ranges, so [a-z] never matches letters outside ASCII.
export LC_ALL=C

repo="$(dirname "${BASH_SOURCE[0]}")"
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

parts() {
  echo "  <version> is three numbers with dots, such as 1.0.0, with an optional suffix such as -alpha62." >&2
  echo "  <name> is lowercase letters, digits and single hyphens, with no hyphen at the start or end." >&2
}

names() {
  echo "Allowed branch names:" >&2
  echo "  master" >&2
  echo "  release/<version>          such as release/1.0.0-alpha62" >&2
  echo "  fix/<version>-<name>       such as fix/1.0.0-alpha62-ssh-timeout" >&2
  echo "  feature/<version>-<name>   such as feature/1.0.0-alpha62-csv-export" >&2
  parts
}

fail() {
  echo "❌ Branch name check failed: $1" >&2
}

check_release() {
  local branch="$1" re v missing=()
  for re in "$suffixed_re" "$plain_re"; do
    [[ "$branch" =~ $re ]] || continue
    v="${BASH_REMATCH[2]}"
    if git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/release/$v" > /dev/null; then
      echo "✅ Branch name check passed: '$branch' belongs to origin/release/$v."
      exit 0
    fi
    missing+=("origin/release/$v")
  done
  if [ "${#missing[@]}" -eq 1 ]; then
    fail "the branch '$branch' needs the release branch ${missing[0]}, which is not in this clone."
  else
    fail "the branch '$branch' needs the release branch ${missing[0]} or ${missing[1]}, and neither is in this clone."
  fi
  echo "  A fix or feature branch has the version of its release branch, such as fix/1.0.0-alpha62-ssh-timeout for release/1.0.0-alpha62." >&2
  echo "  If that release branch should exist, fetch it with: git fetch origin" >&2
  exit 1
}

check_current() {
  local branch
  if ! branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"; then
    fail "the current branch could not be read."
    exit 1
  fi
  if [ "$branch" = "HEAD" ]; then
    fail "HEAD is detached, so there is no branch name to check."
    echo "Check out a branch first, such as with: git switch fix/1.0.0-alpha62-ssh-timeout" >&2
    exit 1
  fi
  if [ "$branch" = "master" ] || [[ "$branch" =~ $release_re ]]; then
    echo "✅ Branch name check passed: '$branch'."
    exit 0
  fi
  [[ "$branch" =~ $change_re ]] && check_release "$branch"
  fail "the branch '$branch' has a name that is not allowed."
  names
  echo "Rename the branch with: git branch -m <new-name>" >&2
  exit 1
}

check_pr() {
  local head="$1" base="$2" v kind prefix
  if [ "$base" = "master" ]; then
    if [[ "$head" =~ $release_re ]]; then
      echo "✅ Branch name check passed: '$head' into '$base'."
      exit 0
    fi
    fail "a pull request into master must come from release/<version>, such as release/1.0.0-alpha62."
    echo "  This pull request comes from '$head'." >&2
    parts
    exit 1
  fi
  if [[ "$base" =~ $release_re ]]; then
    v="${base#release/}"
    for kind in fix feature; do
      prefix="$kind/$v-"
      if [[ "$head" == "$prefix"* && "${head#"$prefix"}" =~ $name_re ]]; then
        echo "✅ Branch name check passed: '$head' into '$base'."
        exit 0
      fi
    done
    fail "a pull request into $base must come from fix/$v-<name> or feature/$v-<name>, with the same version, such as fix/$v-ssh-timeout."
    echo "  This pull request comes from '$head'." >&2
    parts
    exit 1
  fi
  fail "a pull request must go into master or into release/<version>, such as release/1.0.0-alpha62."
  echo "  This pull request goes into '$base'." >&2
  parts
  exit 1
}

case "$#:${1:-}" in
  0:) check_current ;;
  3:--pr) check_pr "$2" "$3" ;;
  *) usage ;;
esac
