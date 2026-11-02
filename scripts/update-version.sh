#!/usr/bin/env bash
# Reads the version from the single source of truth (VERSION file)
# and stamps it into all project files that need it.
#
# Usage: ./scripts/update-version.sh
#
# After changing the VERSION file, run this script to propagate
# the version to pyproject.toml, package.json, and SonarQube properties.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/VERSION"

if [[ ! -f "$VERSION_FILE" ]]; then
    echo "ERROR: VERSION file not found at $VERSION_FILE"
    exit 1
fi

VERSION=$(grep '^ver=' "$VERSION_FILE" | cut -d'=' -f2 | tr -d '[:space:]')

if [[ -z "$VERSION" ]]; then
    echo "ERROR: No 'ver=' line found in VERSION file"
    exit 1
fi

# Validate semver: MAJOR.MINOR.PATCH with optional pre-release and build metadata
# Examples: 1.0.0, 1.0.0-alpha1, 1.0.0-rc.1, 1.0.0-beta.2+build.123
SEMVER_REGEX='^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?(\+[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$'
if [[ ! "$VERSION" =~ $SEMVER_REGEX ]]; then
    echo "ERROR: '$VERSION' is not valid semver (expected MAJOR.MINOR.PATCH[-prerelease][+build])"
    exit 1
fi

echo "Updating all version references to: $VERSION"

# Backend pyproject.toml (canonical Poetry command; handles both the
# [project] and [tool.poetry] tables correctly and is idempotent on
# same-version re-runs. poetry.lock is dependency-derived and does not
# mirror the project's own version, so it needs no update here.)
(cd "$REPO_ROOT/backend" && poetry version "$VERSION" > /dev/null)
echo "  - backend/pyproject.toml"

# Frontend package.json + package-lock.json (both get bumped atomically by
# `npm version`; --no-git-tag-version suppresses the commit/tag side effects,
# --allow-same-version makes the script idempotent). This does NOT resolve
# or modify any dependency - it only rewrites the project's own version
# field in both files.
(cd "$REPO_ROOT/frontend" && npm version --no-git-tag-version --allow-same-version "$VERSION" > /dev/null)
echo "  - frontend/package.json"
echo "  - frontend/package-lock.json"

# Backend sonar-project.properties
sed -i "s/^sonar.projectVersion=.*/sonar.projectVersion=$VERSION/" "$REPO_ROOT/backend/sonar-project.properties"
echo "  - backend/sonar-project.properties"

# Frontend sonar-project.properties
sed -i "s/^sonar.projectVersion=.*/sonar.projectVersion=$VERSION/" "$REPO_ROOT/frontend/sonar-project.properties"
echo "  - frontend/sonar-project.properties"

# README.md shields.io badge (escape single dashes as double dashes per shields.io syntax)
BADGE_VERSION="${VERSION//-/--}"
sed -i "s|badge/version-[^)]*-blue|badge/version-${BADGE_VERSION}-blue|" "$REPO_ROOT/README.md"
echo "  - README.md"

echo "Done. All files updated to $VERSION"
