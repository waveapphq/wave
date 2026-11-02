/**
 * Markdown Documentation Loader
 *
 * Loads and parses markdown files with YAML frontmatter into the
 * ControlMetadata format. Replaces the monolithic control-metadata.ts
 * with individual markdown files per control/plugin.
 *
 * No external YAML parser dependency - uses a purpose-built parser
 * that handles the subset of YAML used in frontmatter.
 */

import type { ControlMetadata, ControlVersion } from './_types'

// ---------------------------------------------------------------------------
// Eager import of all markdown doc files at build time
// ---------------------------------------------------------------------------

const controlDocs: Record<string, string> = import.meta.glob('./controls/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const pluginDocs: Record<string, string> = import.meta.glob('./plugins/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ---------------------------------------------------------------------------
// Regex patterns (compiled once, all backtracking-safe)
// ---------------------------------------------------------------------------

const DEEP_INDENT_PATTERN = /^[ \t]{6,}/
const INDENT_PATTERN = /^[ \t]{4,}/
const VERSION_MARKER_PATTERN = /<!--[ \t]*version:[ \t]*(\S+)[ \t]*-->/g

// ---------------------------------------------------------------------------
// String-based matchers (no regex, no backtracking risk)
// ---------------------------------------------------------------------------

/** Match `key: value` at start of line. Returns [key, rawValue] or null. */
function matchKeyValue(line: string): [string, string] | null {
  // Key must start with a word char, contain only word chars and hyphens
  let i = 0
  if (i >= line.length || !/\w/.test(line[i])) return null
  i++
  while (i < line.length && /[\w-]/.test(line[i])) i++
  if (i >= line.length || line[i] !== ':') return null
  const key = line.slice(0, i)
  // Skip colon and optional spaces/tabs
  i++
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++
  return [key, line.slice(i)]
}

/** Match `- content` (dash + space(s) + content). Returns content or null. */
function matchArrayItem(trimmedLine: string): string | null {
  if (!trimmedLine.startsWith('-') || trimmedLine.length < 2) return null
  if (trimmedLine[1] !== ' ' && trimmedLine[1] !== '\t') return null
  // Skip additional whitespace between dash and content.
  // Input is always pre-trimmed, so content always follows the whitespace.
  let i = 2
  while (trimmedLine[i] === ' ' || trimmedLine[i] === '\t') i++
  return trimmedLine.slice(i)
}

// ---------------------------------------------------------------------------
// Frontmatter parser (no external dependency)
// ---------------------------------------------------------------------------

interface ParsedDoc {
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * Split a raw markdown string into YAML frontmatter and body.
 * Frontmatter is delimited by `---` on its own line at the start of the file.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed }
  }

  const endIndex = trimmed.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed }
  }

  const yamlBlock = trimmed.slice(4, endIndex)
  const body = trimmed.slice(endIndex + 4).trim()

  return { frontmatter: parseYaml(yamlBlock), body }
}

// ---------------------------------------------------------------------------
// Line cursor helpers
// ---------------------------------------------------------------------------

/** Skip blank lines from index i, return next non-blank index. */
function skipBlanks(lines: string[], i: number): number {
  while (i < lines.length && lines[i].trim() === '') i++
  return i
}

/** Check if a line at index i starts an array (dash-prefixed, after blanks). */
function isArrayStart(lines: string[], i: number): boolean {
  return i < lines.length && lines[i].trimStart().startsWith('-')
}

// ---------------------------------------------------------------------------
// Scalar parser
// ---------------------------------------------------------------------------

/** Parse a scalar value: boolean or string (with optional quote removal). */
function parseScalar(value: string): string | boolean | number {
  if (value === 'true') return true
  if (value === 'false') return false

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  return value
}

// ---------------------------------------------------------------------------
// Top-level YAML parser
// ---------------------------------------------------------------------------

function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      i++
      continue
    }

    const kvMatch = matchKeyValue(line)
    if (!kvMatch) {
      i++
      continue
    }

    const [key, rawValue] = kvMatch

    if (rawValue !== '') {
      result[key] = parseScalar(rawValue)
      i++
      continue
    }

    // Empty value - check for array on following lines
    i = skipBlanks(lines, i + 1)
    if (isArrayStart(lines, i)) {
      const { items, nextIndex } = parseArrayItems(lines, i)
      result[key] = items
      i = nextIndex
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Array item parsers
// ---------------------------------------------------------------------------

/** Collect continuation key-value pairs for an object in a YAML array. */
function collectObjectFields(
  lines: string[],
  startIndex: number,
  obj: Record<string, unknown>,
): number {
  let i = startIndex

  while (i < lines.length) {
    const nextLine = lines[i]
    const nextTrimmed = nextLine.trim()

    if (nextTrimmed === '') {
      i++
      continue
    }

    const contMatch = matchKeyValue(nextTrimmed)
    if (!contMatch || !INDENT_PATTERN.test(nextLine) || nextTrimmed.startsWith('-')) {
      break
    }

    const [contKey, contRawValue] = contMatch

    if (contRawValue !== '') {
      obj[contKey] = parseScalar(contRawValue)
      i++
      continue
    }

    // Nested array inside object
    i = skipBlanks(lines, i + 1)
    if (isArrayStart(lines, i)) {
      const { items: nestedItems, nextIndex } = parseNestedArray(lines, i)
      obj[contKey] = nestedItems
      i = nextIndex
    }
  }

  return i
}

/** Parse an array of items starting at index i. */
function parseArrayItems(lines: string[], startIndex: number): { items: unknown[]; nextIndex: number } {
  const items: unknown[] = []
  let i = startIndex

  while (i < lines.length) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (trimmedLine !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
      break
    }
    if (trimmedLine === '') {
      i++
      continue
    }

    const content = matchArrayItem(trimmedLine)
    if (content === null) break

    const objMatch = matchKeyValue(content)

    if (objMatch) {
      const obj: Record<string, unknown> = { [objMatch[0]]: parseScalar(objMatch[1]) }
      i = collectObjectFields(lines, i + 1, obj)
      items.push(obj)
    } else {
      items.push(parseScalar(content))
      i++
    }
  }

  return { items, nextIndex: i }
}

/** Parse a nested array (deeper indentation level). */
function parseNestedArray(lines: string[], startIndex: number): { items: unknown[]; nextIndex: number } {
  const items: unknown[] = []
  let i = startIndex

  while (i < lines.length) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (trimmedLine === '') {
      i++
      continue
    }
    if (!DEEP_INDENT_PATTERN.test(line)) break

    const nestedContent = matchArrayItem(trimmedLine)
    if (nestedContent === null) break

    items.push(parseScalar(nestedContent))
    i++
  }

  return { items, nextIndex: i }
}

// ---------------------------------------------------------------------------
// Version extraction from parsed frontmatter
// ---------------------------------------------------------------------------

/**
 * Extract ControlVersion[] from parsed frontmatter, merging in body content
 * for the details field.
 */
export function parseVersions(frontmatter: Record<string, unknown>, body: string): ControlVersion[] {
  const rawVersions = frontmatter.versions
  if (!Array.isArray(rawVersions)) return []

  const versionBodies = splitBodyByVersion(body)

  return rawVersions.map((rv: Record<string, unknown>, index: number) => {
    const version: ControlVersion = {
      version: typeof rv.version === 'string' ? rv.version : '',
      releaseDate: typeof rv.releaseDate === 'string' ? rv.releaseDate : '',
      changelog: Array.isArray(rv.changelog) ? rv.changelog.map(String) : [],
      details: index === 0 ? versionBodies.main : (versionBodies.byVersion[String(rv.version)] ?? ''),
    }

    if (rv.deprecated === true) {
      version.deprecated = true
    }
    if (typeof rv.deprecationMessage === 'string' && rv.deprecationMessage) {
      version.deprecationMessage = rv.deprecationMessage
    }

    return version
  })
}

/**
 * Split the markdown body into sections by version comment markers.
 *
 * Format:
 * ```
 * (main content for latest version)
 *
 * <!-- version: 0.0.1 -->
 * ---
 *
 * (content for version 0.0.1)
 * ```
 */
function splitBodyByVersion(body: string): { main: string; byVersion: Record<string, string> } {
  const byVersion: Record<string, string> = {}
  const markers: { version: string; index: number }[] = []
  let match: RegExpExecArray | null

  while ((match = VERSION_MARKER_PATTERN.exec(body)) !== null) {
    markers.push({ version: match[1], index: match.index })
  }
  // Reset lastIndex for reuse
  VERSION_MARKER_PATTERN.lastIndex = 0

  if (markers.length === 0) {
    return { main: body.trim(), byVersion }
  }

  const main = body.slice(0, markers[0].index).trim()

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + body.slice(markers[i].index).indexOf('\n') + 1
    const end = i + 1 < markers.length ? markers[i + 1].index : body.length
    let section = body.slice(start, end).trim()
    if (section.startsWith('---')) {
      section = section.slice(3).trim()
    }
    byVersion[markers[i].version] = section
  }

  return { main, byVersion }
}

// ---------------------------------------------------------------------------
// Metadata builder
// ---------------------------------------------------------------------------

/**
 * Parse a single raw markdown doc into ControlMetadata.
 * Returns null if the frontmatter lacks an `id` field.
 */
export function parseDocEntry(raw: string): ControlMetadata | null {
  const { frontmatter, body } = parseFrontmatter(raw)
  const id = (frontmatter.id as string) ?? ''
  if (!id) return null

  return {
    id,
    description: (frontmatter.description as string) ?? '',
    versions: parseVersions(frontmatter, body),
  }
}

function buildMetadata(docs: Record<string, string>): Record<string, ControlMetadata> {
  const result: Record<string, ControlMetadata> = {}

  for (const [_path, raw] of Object.entries(docs)) {
    const entry = parseDocEntry(raw)
    if (entry) result[entry.id] = entry
  }

  return result
}

// ---------------------------------------------------------------------------
// Public API - identical to the old control-metadata.ts exports
// ---------------------------------------------------------------------------

/** Metadata for all controls + plugins, keyed by ID for O(1) lookup. */
export const CONTROL_METADATA: Record<string, ControlMetadata> = {
  ...buildMetadata(controlDocs),
  ...buildMetadata(pluginDocs),
}

/** Get metadata for a control by ID. */
export function getControlMetadata(controlId: string): ControlMetadata | undefined {
  return CONTROL_METADATA[controlId]
}

/** Get all available versions for a control (newest first). */
export function getControlVersions(controlId: string): ControlVersion[] {
  return CONTROL_METADATA[controlId]?.versions ?? []
}

/** Get the latest (current) version for a control. */
export function getControlLatestVersion(controlId: string): string {
  const versions = getControlVersions(controlId)
  return versions[0]?.version ?? '1.0.0'
}

/** Get changelog for a specific version of a control. */
export function getControlChangelog(controlId: string, version: string): string[] {
  const versions = getControlVersions(controlId)
  return versions.find((v) => v.version === version)?.changelog ?? []
}

/** Get details for a specific version of a control. */
export function getControlDetails(controlId: string, version: string): string | undefined {
  const versions = getControlVersions(controlId)
  return versions.find((v) => v.version === version)?.details
}

/** Find a version entry by version string. */
export function getControlVersionEntry(controlId: string, version: string): ControlVersion | undefined {
  const versions = getControlVersions(controlId)
  return versions.find((v) => v.version === version)
}
