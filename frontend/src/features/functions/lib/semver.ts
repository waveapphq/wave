/**
 * Pure FE semver helpers for the version dropdown + edit-mode publish dialog.
 * The backend (_versioning.py) stays the authority on which
 * bumps are legal; these only drive presentation - parse a version, classify a
 * typed target, derive the next bump target.
 */

import { MAX_VERSION_LENGTH } from '@/lib/field-constraints'
import type { BumpLevel } from '@/features/functions/api/types'

export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?(?:\+([\w.-]+))?$/

export function parseSemver(version: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(version)
  if (match === null) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function classifyBumpLevel(source: string, target: string): BumpLevel | null {
  const src = parseSemver(source)
  const tgt = parseSemver(target)
  if (!src || !tgt) return null
  const [sM, sN, sP] = src
  const [tM, tN, tP] = tgt
  if (tM === sM && tN === sN && tP > sP) return 'patch'
  if (tM === sM && tN > sN) return 'minor'
  if (tM > sM) return 'major'
  return null
}

export function bumpTarget(source: string, level: BumpLevel): string {
  const parsed = parseSemver(source) ?? [1, 0, 0]
  const [major, minor, patch] = parsed
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major + 1}.0.0`
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Number(a) - Number(b)
  if (aNumeric) return -1
  if (bNumeric) return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// Semver 2 precedence: negative when a < b, positive when a > b, 0 when equal.
// A release outranks its pre-releases; build metadata is ignored; invalid sorts lowest.
export function comparePrecedence(a: string, b: string): number {
  const coreA = parseSemver(a)
  const coreB = parseSemver(b)
  if (coreA === null || coreB === null) {
    return (coreA === null ? 0 : 1) - (coreB === null ? 0 : 1)
  }
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] - coreB[i]
  }
  const preA = SEMVER_RE.exec(a)?.[4] ?? null
  const preB = SEMVER_RE.exec(b)?.[4] ?? null
  if (preA === null && preB === null) return 0
  if (preA === null) return 1
  if (preB === null) return -1
  const idsA = preA.split('.')
  const idsB = preB.split('.')
  const shared = Math.min(idsA.length, idsB.length)
  for (let i = 0; i < shared; i++) {
    const cmp = comparePrereleaseIdentifier(idsA[i], idsB[i])
    if (cmp !== 0) return cmp
  }
  return idsA.length - idsB.length
}

// Highest-precedence version sharing `source`'s major line (or `source` itself
// when the line holds nothing higher). Per-major no-backports means a bump must
// advance past the latest version *in the source's major line*, not merely the
// opened source version.
function majorLineBase(source: string, versions: Iterable<string>): string {
  const sourceMajor = parseSemver(source)![0]
  let base = source
  for (const version of versions) {
    if (parseSemver(version)![0] === sourceMajor && comparePrecedence(version, base) > 0) {
      base = version
    }
  }
  return base
}

// Next bump target at `level` that is not already published, rebased on the
// source's major-line latest (per-major no-backports). Skips taken versions by
// re-bumping at the same level, so a major from 1.2.0 with 2.0.0 already
// published lands on 3.0.0 instead of colliding.
export function nextAvailableTarget(
  source: string,
  level: BumpLevel,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing)
  let candidate = bumpTarget(majorLineBase(source, taken), level)
  while (taken.has(candidate)) {
    candidate = bumpTarget(candidate, level)
  }
  return candidate
}

// Strict semver v2 (https://semver.org/) validation, the single shared helper
// used by every Function version field (publish dialog + version-dropdown Custom
// input). Split into three pieces so each regex stays below the complexity
// threshold while still rejecting illegal strings: leading zeros in numeric
// identifiers, empty identifiers, non-ASCII characters. `SEMVER_RE` above is the
// looser parse helper for extracting the X.Y.Z core; this is the validator.
const SEMVER_CORE_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SEMVER_PRE_IDENT_RE = /^(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)$/
const SEMVER_BUILD_IDENT_RE = /^[\da-zA-Z-]+$/

const isValidBuildMetadata = (build: string): boolean =>
  build.length > 0 && build.split('.').every((part) => SEMVER_BUILD_IDENT_RE.test(part))

const isValidPrerelease = (pre: string): boolean =>
  pre.length > 0 && pre.split('.').every((part) => SEMVER_PRE_IDENT_RE.test(part))

export function isValidSemver(version: string): boolean {
  // Global length cap: an otherwise-valid version over the cap is invalid.
  if (version.length > MAX_VERSION_LENGTH) return false
  // Strip optional build metadata first (everything after `+`).
  const plusIdx = version.indexOf('+')
  const beforeBuild = plusIdx === -1 ? version : version.slice(0, plusIdx)
  if (plusIdx !== -1 && !isValidBuildMetadata(version.slice(plusIdx + 1))) return false
  // Strip optional pre-release (everything after `-`).
  const dashIdx = beforeBuild.indexOf('-')
  const core = dashIdx === -1 ? beforeBuild : beforeBuild.slice(0, dashIdx)
  if (!SEMVER_CORE_RE.test(core)) return false
  if (dashIdx !== -1 && !isValidPrerelease(beforeBuild.slice(dashIdx + 1))) return false
  return true
}
