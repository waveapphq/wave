#!/bin/bash
# Detect orphaned frontend files - files in src/ with zero imports from other src/ files - and
# coverage exclusion IDs that are registered but unused, or used but unregistered.
# Runs as a CI gate to prevent accumulation of dead code.
#
# Exit codes:
#   0 - No orphaned files found (or all orphans are in the known allowlist)
#   1 - New orphaned files detected, or a KNOWN_ORPHANS entry exempted nothing (CI should fail)
#
# Exclusions (files that legitimately have zero imports from src/):
#   - Entry points: main.tsx (referenced by index.html)
#   - Barrel files: **/index.ts, **/index.tsx (re-export aggregators)
#   - Type declarations: *.d.ts (referenced by tsconfig)
#   - Stylesheets: *.css
#
# Detection approach:
#   For each file, search for its basename (without extension) in import/export/require
#   statements across all src/ files. Matches static imports, re-exports, and dynamic imports.
#
# Allowlist:
#   KNOWN_ORPHANS exempts named files from the gate. An entry that exempts nothing on a
#   run is a false claim about the codebase, so it is reported and fails the run.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_SRC="$PROJECT_ROOT/frontend/src"

if [ ! -d "$FRONTEND_SRC" ]; then
  echo "Error: frontend/src/ directory not found at $FRONTEND_SRC"
  exit 1
fi

# Files that are legitimately unimported, exempted from the gate.
# DO NOT add new entries without explicit justification.
# When a file gets integrated (imported by production code), remove it from this list.
# Entries that exempt nothing are reported at the end of the run and fail it.
KNOWN_ORPHANS=()

ORPHANED_FILES=()
KNOWN_FOUND=()
CHECKED=0
EXCLUDED=0

# Collect all .ts/.tsx files in src/
while IFS= read -r -d '' file; do
  # Get path relative to frontend/src/
  rel_path="${file#"$FRONTEND_SRC/"}"

  # --- Exclusions ---

  # Entry point (referenced by index.html, not by src/ files)
  if [ "$rel_path" = "app/main.tsx" ]; then
    EXCLUDED=$((EXCLUDED + 1))
    continue
  fi

  # Barrel/index files (re-export aggregators)
  basename_file="$(basename "$file")"
  if [[ "$basename_file" == "index.ts" || "$basename_file" == "index.tsx" ]]; then
    EXCLUDED=$((EXCLUDED + 1))
    continue
  fi

  # Type declaration files (referenced by tsconfig, not imported)
  if [[ "$file" == *.d.ts ]]; then
    EXCLUDED=$((EXCLUDED + 1))
    continue
  fi

  # CSS files (imported via bundler, not standard TS imports)
  if [[ "$file" == *.css ]]; then
    EXCLUDED=$((EXCLUDED + 1))
    continue
  fi

  CHECKED=$((CHECKED + 1))

  # Extract basename without extension for import matching.
  basename_no_ext="${basename_file%.tsx}"
  basename_no_ext="${basename_no_ext%.ts}"

  # Search for the basename in import/export/require statements.
  # Matches: from '.../<name>', import('.../<name>'), require('.../<name>')
  import_count=$(grep -r --include='*.ts' --include='*.tsx' -l \
    -E "(from\s+['\"]|import\s*\(\s*['\"]|require\(\s*['\"])[^'\"]*/${basename_no_ext}['\"]" \
    "$FRONTEND_SRC" 2>/dev/null \
    | grep -v "^${file}$" \
    | wc -l)

  if [ "$import_count" -eq 0 ]; then
    # Check if this file is in the known orphans list
    is_known=false
    for known in "${KNOWN_ORPHANS[@]}"; do
      if [ "$rel_path" = "$known" ]; then
        is_known=true
        KNOWN_FOUND+=("$rel_path")
        break
      fi
    done

    if [ "$is_known" = false ]; then
      ORPHANED_FILES+=("$rel_path")
    fi
  fi

done < <(find "$FRONTEND_SRC" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print0 | sort -z)

echo "Orphaned file check: scanned $CHECKED files, excluded $EXCLUDED"

if [ ${#KNOWN_FOUND[@]} -gt 0 ]; then
  echo "Known orphans (tracked): ${#KNOWN_FOUND[@]}"
fi

# An allowlist entry that exempted nothing is stale and fails the run.
UNUSED_ALLOWLIST=()
for known in "${KNOWN_ORPHANS[@]}"; do
  used=false
  for found in "${KNOWN_FOUND[@]}"; do
    if [ "$known" = "$found" ]; then
      used=true
      break
    fi
  done
  if [ "$used" = false ]; then
    UNUSED_ALLOWLIST+=("$known")
  fi
done

if [ ${#ORPHANED_FILES[@]} -eq 0 ]; then
  echo "No new orphaned files found."
else
  echo ""
  echo "ERROR: ${#ORPHANED_FILES[@]} NEW orphaned file(s) detected in frontend/src/:"
  echo "────────────────────────────────────────────"
  for f in "${ORPHANED_FILES[@]}"; do
    echo "  $f"
  done
  echo "────────────────────────────────────────────"
  echo ""
  echo "Every file in src/ must be imported by at least one other src/ file."
  echo "Options:"
  echo "  1. Import the file from production code (preferred)"
  echo "  2. Delete the file if it's not needed"
  echo "  3. Add to KNOWN_ORPHANS in this script with justification (last resort)"
fi

if [ ${#UNUSED_ALLOWLIST[@]} -gt 0 ]; then
  echo ""
  echo "ERROR: this check failed because ${#UNUSED_ALLOWLIST[@]} KNOWN_ORPHANS entry(ies) exempted nothing this run:"
  for k in "${UNUSED_ALLOWLIST[@]}"; do
    echo "  $k"
  done
  echo "Each of these files now has an importer, or no longer exists."
  echo "Remove the entry from KNOWN_ORPHANS in this script."
fi

# Coverage exclusion registry: every registered COV ID is used in src/, and every ID src/ uses is registered.
REGISTRY="$PROJECT_ROOT/frontend/coverage-exclusions.md"
# An ID's family can have more than one word, such as COV-V8-FUNC-003.
COV_ID='COV-[A-Z0-9]+(-[A-Z][A-Z0-9]*)*-[0-9]+'
REGISTERED_IDS=$(grep -oE "^### $COV_ID" "$REGISTRY" | sed 's/^### //' | sort -u || true)
SOURCE_IDS=$(grep -rhoE "$COV_ID" "$FRONTEND_SRC" | sort -u || true)
ORPHANED_IDS=$(comm -23 <(printf '%s\n' "$REGISTERED_IDS") <(printf '%s\n' "$SOURCE_IDS") | sed '/^$/d')
UNREGISTERED_IDS=$(comm -13 <(printf '%s\n' "$REGISTERED_IDS") <(printf '%s\n' "$SOURCE_IDS") | sed '/^$/d')

if [ -n "$ORPHANED_IDS" ]; then
  echo ""
  echo "ERROR: coverage exclusion ID(s) registered but used nowhere in frontend/src/:"
  printf '  %s\n' $ORPHANED_IDS
  echo "Delete their sections from frontend/coverage-exclusions.md."
fi

if [ -n "$UNREGISTERED_IDS" ]; then
  echo ""
  echo "ERROR: coverage exclusion ID(s) used in frontend/src/ but missing from the registry:"
  printf '  %s\n' $UNREGISTERED_IDS
fi

if [ ${#ORPHANED_FILES[@]} -gt 0 ] || [ ${#UNUSED_ALLOWLIST[@]} -gt 0 ] || [ -n "$ORPHANED_IDS" ] || [ -n "$UNREGISTERED_IDS" ]; then
  exit 1
fi

exit 0
