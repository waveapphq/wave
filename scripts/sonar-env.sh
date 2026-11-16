#!/usr/bin/env bash
# SonarQube settings shared by the scan, results and CI scripts. Source it, do not run it.
# Exports SONAR_URL (default SonarQube Cloud) and SONAR_BRANCH (the branch of a local Cloud scan, else empty).

SONAR_CLOUD_URL="https://sonarcloud.io"

SONAR_URL="${SONAR_URL:-$SONAR_CLOUD_URL}"
SONAR_URL="${SONAR_URL%/}"
export SONAR_URL

if [ -z "${SONAR_TOKEN:-}" ]; then
  echo "ERROR: SONAR_TOKEN environment variable is not set. Set it to your token for $SONAR_URL." >&2
  exit 1
fi

# GitHub Actions: the scanner detects the branch or pull request itself. Other hosts: no branch.
SONAR_BRANCH=""
if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "$SONAR_URL" = "$SONAR_CLOUD_URL" ]; then
  SONAR_BRANCH="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --abbrev-ref HEAD || true)"
  if [ -z "$SONAR_BRANCH" ] || [ "$SONAR_BRANCH" = "HEAD" ]; then
    echo "ERROR: HEAD is detached. SonarQube Cloud analyzes a local scan as the current branch." >&2
    echo "       Check out a branch first: git switch <branch>" >&2
    exit 1
  fi
fi
export SONAR_BRANCH
