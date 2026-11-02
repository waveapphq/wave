/**
 * Markdown Documentation Loader Tests
 *
 * Tests for the frontmatter parser, version extraction, metadata builder,
 * and all utility functions exported by the loader.
 */

import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  parseVersions,
  parseDocEntry,
  CONTROL_METADATA,
  getControlMetadata,
  getControlVersions,
  getControlLatestVersion,
  getControlChangelog,
  getControlDetails,
  getControlVersionEntry,
} from '@/features/workbench/docs/_loader'

// ==========================================================================
// parseFrontmatter
// ==========================================================================

describe('parseFrontmatter', () => {
  it('parses valid frontmatter with simple key-value pairs', () => {
    const raw = `---
id: my-control
description: A test control
---

Body content here.`
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('my-control')
    expect(frontmatter.description).toBe('A test control')
    expect(body).toBe('Body content here.')
  })

  it('returns empty frontmatter when no --- delimiters present', () => {
    const raw = 'Just some plain text without frontmatter.'
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter).toEqual({})
    expect(body).toBe('Just some plain text without frontmatter.')
  })

  it('returns empty frontmatter when only opening --- is present', () => {
    const raw = `---
id: test
No closing delimiter`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter).toEqual({})
  })

  it('handles quoted string values', () => {
    const raw = `---
version: "1.0.0"
name: 'single-quoted'
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.version).toBe('1.0.0')
    expect(frontmatter.name).toBe('single-quoted')
  })

  it('parses boolean values', () => {
    const raw = `---
deprecated: true
active: false
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.deprecated).toBe(true)
    expect(frontmatter.active).toBe(false)
  })

  it('parses array of strings', () => {
    const raw = `---
id: test
changelog:
  - First entry
  - Second entry
  - Third entry
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.changelog).toEqual(['First entry', 'Second entry', 'Third entry'])
  })

  it('parses array of objects with nested arrays', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-14"
    changelog:
      - Entry one
      - Entry two
    deprecated: true
    deprecationMessage: Use v2 instead
---

Body content.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe('1.0.0')
    expect(versions[0].releaseDate).toBe('2026-03-14')
    expect(versions[0].changelog).toEqual(['Entry one', 'Entry two'])
    expect(versions[0].deprecated).toBe(true)
    expect(versions[0].deprecationMessage).toBe('Use v2 instead')
  })

  it('handles leading whitespace before frontmatter', () => {
    const raw = `
---
id: test
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
  })

  it('handles empty body after frontmatter', () => {
    const raw = `---
id: test
---
`
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
    expect(body).toBe('')
  })

  it('handles non-matching lines in YAML (no key:value pattern)', () => {
    const raw = `---
id: test
some random text without colon
description: A test
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
    expect(frontmatter.description).toBe('A test')
  })

  it('handles empty array continuation (no nested items after empty value)', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-01"
    changelog:
      - Entry one
      - Entry two
    deprecated: false
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(1)
    expect(versions[0].changelog).toEqual(['Entry one', 'Entry two'])
    expect(versions[0].deprecated).toBe(false)
  })

  it('handles object item with empty nested value but no array follows', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    emptyField:
    releaseDate: "2026-01-01"
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe('1.0.0')
  })

  it('handles empty lines within array items', () => {
    const raw = `---
id: test
items:

  - First item

  - Second item
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.items).toEqual(['First item', 'Second item'])
  })

  it('handles bare dash without space (not a valid array item)', () => {
    const raw = `---
id: test
items:
  -
  - Valid item
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
  })

  it('handles dash followed by non-space character (not a valid item)', () => {
    const raw = `---
id: test
items:
  -invalid
  - Valid item
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
  })

  it('handles tab-separated array items', () => {
    const raw = `---
id: test
items:
  -\tTabbed item
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.items).toEqual(['Tabbed item'])
  })

  it('handles array items with extra spaces between dash and content', () => {
    // Tests the while loop in matchArrayItem that skips multiple spaces/tabs
    const raw = '---\nid: test\nitems:\n  -   Spaced item\n  - \t\tTabbed spaces item\n---\n\nBody.'
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.items).toEqual(['Spaced item', 'Tabbed spaces item'])
  })

  it('handles non-array line after empty value key', () => {
    const raw = `---
id: test
data:
nextkey: value
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
    expect(frontmatter.nextkey).toBe('value')
  })

  it('handles nested array with empty lines', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    changelog:

      - Entry one

      - Entry two
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions[0].changelog).toEqual(['Entry one', 'Entry two'])
  })

  it('stops nested array parsing when line is not indented enough', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    changelog:
      - Entry one
  - version: "0.0.1"
    changelog:
      - Placeholder
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(2)
    expect(versions[0].changelog).toEqual(['Entry one'])
    expect(versions[1].changelog).toEqual(['Placeholder'])
  })

  it('stops nested array when non-dash line encountered', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"
    changelog:
      - Entry one
      not-a-dash-line
    releaseDate: "2026-01-01"
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(1)
    expect(versions[0].changelog).toEqual(['Entry one'])
  })

  it('stops array item collection when non-indented non-empty line hit', () => {
    const raw = `---
id: test
items:
  - item1
  - item2
nextkey: value
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.items).toEqual(['item1', 'item2'])
    expect(frontmatter.nextkey).toBe('value')
  })

  it('handles empty lines between object properties in array items', () => {
    const raw = `---
id: test
versions:
  - version: "1.0.0"

    releaseDate: "2026-01-01"

    changelog:
      - Entry one
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe('1.0.0')
    expect(versions[0].releaseDate).toBe('2026-01-01')
    expect(versions[0].changelog).toEqual(['Entry one'])
  })

  it('handles break in array items when non-dash indented line found', () => {
    const raw = `---
id: test
items:
  - item1
  notadash
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.items).toEqual(['item1'])
  })

  it('skips YAML comments', () => {
    const raw = `---
# This is a comment
id: test
# Another comment
description: A test
---

Body.`
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.id).toBe('test')
    expect(frontmatter.description).toBe('A test')
  })

  it('parses multiple versions in frontmatter', () => {
    const raw = `---
id: multi
description: Multi-version test
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-14"
    changelog:
      - New feature
  - version: "0.0.1"
    releaseDate: "2026-01-01"
    changelog:
      - Placeholder version
    deprecated: true
    deprecationMessage: Upgrade to 1.0.0
---

Latest version details.

<!-- version: 0.0.1 -->
---

Older version details.`
    const { frontmatter, body } = parseFrontmatter(raw)
    const versions = frontmatter.versions as Record<string, unknown>[]
    expect(versions).toHaveLength(2)
    expect(versions[0].version).toBe('1.0.0')
    expect(versions[1].version).toBe('0.0.1')
    expect(versions[1].deprecated).toBe(true)
    expect(body).toContain('Latest version details')
    expect(body).toContain('Older version details')
  })
})

// ==========================================================================
// parseVersions
// ==========================================================================

describe('parseVersions', () => {
  it('returns empty array when no versions in frontmatter', () => {
    const result = parseVersions({}, 'Some body text')
    expect(result).toEqual([])
  })

  it('returns empty array when versions is not an array', () => {
    const result = parseVersions({ versions: 'not-an-array' }, 'Body')
    expect(result).toEqual([])
  })

  it('extracts a single version with body as details', () => {
    const frontmatter = {
      versions: [
        {
          version: '1.0.0',
          releaseDate: '2026-01-15',
          changelog: ['Full implementation released'],
        },
      ],
    }
    const body = 'The details for this version.'
    const result = parseVersions(frontmatter, body)

    expect(result).toHaveLength(1)
    expect(result[0].version).toBe('1.0.0')
    expect(result[0].releaseDate).toBe('2026-01-15')
    expect(result[0].changelog).toEqual(['Full implementation released'])
    expect(result[0].details).toBe('The details for this version.')
  })

  it('extracts deprecated version with deprecationMessage', () => {
    const frontmatter = {
      versions: [
        {
          version: '0.0.1',
          releaseDate: '2026-01-01',
          changelog: ['Placeholder version'],
          deprecated: true,
          deprecationMessage: 'Upgrade to 1.0.0',
        },
      ],
    }
    const result = parseVersions(frontmatter, '**Status:** Not implemented')

    expect(result).toHaveLength(1)
    expect(result[0].deprecated).toBe(true)
    expect(result[0].deprecationMessage).toBe('Upgrade to 1.0.0')
  })

  it('does not set deprecated when not true', () => {
    const frontmatter = {
      versions: [
        {
          version: '1.0.0',
          releaseDate: '2026-01-15',
          changelog: ['Full release'],
        },
      ],
    }
    const result = parseVersions(frontmatter, 'Details.')

    expect(result[0].deprecated).toBeUndefined()
    expect(result[0].deprecationMessage).toBeUndefined()
  })

  it('handles multi-version body splitting', () => {
    const frontmatter = {
      versions: [
        {
          version: '1.0.0',
          releaseDate: '2026-03-14',
          changelog: ['New feature'],
        },
        {
          version: '0.0.1',
          releaseDate: '2026-01-01',
          changelog: ['Placeholder version'],
          deprecated: true,
          deprecationMessage: 'Upgrade to 1.0.0',
        },
      ],
    }
    const body = `Latest version content here.

<!-- version: 0.0.1 -->
---

**Status:** Not implemented`

    const result = parseVersions(frontmatter, body)

    expect(result).toHaveLength(2)
    expect(result[0].details).toBe('Latest version content here.')
    expect(result[1].details).toBe('**Status:** Not implemented')
  })

  it('handles version without matching body section', () => {
    const frontmatter = {
      versions: [
        { version: '1.0.0', releaseDate: '2026-01-15', changelog: ['Release'] },
        { version: '0.0.1', releaseDate: '2026-01-01', changelog: ['Placeholder'] },
      ],
    }
    const body = 'Only main content, no version markers.'

    const result = parseVersions(frontmatter, body)
    expect(result[0].details).toBe('Only main content, no version markers.')
    expect(result[1].details).toBe('')
  })

  it('handles empty deprecationMessage gracefully', () => {
    const frontmatter = {
      versions: [
        {
          version: '1.0.0',
          releaseDate: '2026-01-15',
          changelog: ['Release'],
          deprecated: true,
          deprecationMessage: '',
        },
      ],
    }
    const result = parseVersions(frontmatter, 'Details.')
    expect(result[0].deprecated).toBe(true)
    expect(result[0].deprecationMessage).toBeUndefined()
  })

  it('handles non-string version and releaseDate gracefully', () => {
    const frontmatter = {
      versions: [
        { version: 123, releaseDate: true, changelog: ['entry'] },
      ],
    }
    const result = parseVersions(frontmatter, 'Body text')
    expect(result[0].version).toBe('')
    expect(result[0].releaseDate).toBe('')
    expect(result[0].details).toBe('Body text')
  })

  it('handles non-array changelog gracefully', () => {
    const frontmatter = {
      versions: [
        { version: '1.0.0', releaseDate: '2026-01-01', changelog: 'not-array' },
      ],
    }
    const result = parseVersions(frontmatter, 'Body')
    expect(result[0].changelog).toEqual([])
  })

  it('handles multiple version markers in body', () => {
    const frontmatter = {
      versions: [
        { version: '2.0.0', releaseDate: '2026-06-01', changelog: ['v2'] },
        { version: '1.0.0', releaseDate: '2026-01-01', changelog: ['v1'] },
        { version: '0.5.0', releaseDate: '2025-06-01', changelog: ['v0.5'] },
      ],
    }
    const body = `Latest docs

<!-- version: 1.0.0 -->
---

V1 docs here

<!-- version: 0.5.0 -->
---

V0.5 docs here`
    const result = parseVersions(frontmatter, body)
    expect(result[0].details).toBe('Latest docs')
    expect(result[1].details).toBe('V1 docs here')
    expect(result[2].details).toBe('V0.5 docs here')
  })
})

// ==========================================================================
// parseDocEntry
// ==========================================================================

describe('parseDocEntry', () => {
  it('parses a valid markdown doc into ControlMetadata', () => {
    const raw = `---
id: my-control
description: A test control
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-01"
    changelog:
      - Initial release
---

Some details here.`
    const result = parseDocEntry(raw)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('my-control')
    expect(result!.description).toBe('A test control')
    expect(result!.versions).toHaveLength(1)
    expect(result!.versions[0].details).toBe('Some details here.')
  })

  it('returns null when id is missing from frontmatter', () => {
    const raw = `---
description: No ID here
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-01"
    changelog:
      - Release
---

Details.`
    expect(parseDocEntry(raw)).toBeNull()
  })

  it('defaults description to empty string when missing', () => {
    const raw = `---
id: no-desc
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-01"
    changelog:
      - Release
---

Details.`
    const result = parseDocEntry(raw)
    expect(result).not.toBeNull()
    expect(result!.description).toBe('')
  })

  it('returns null for plain text without frontmatter', () => {
    expect(parseDocEntry('Just plain text')).toBeNull()
  })
})

// ==========================================================================
// CONTROL_METADATA registry - loaded from markdown files
// ==========================================================================

describe('CONTROL_METADATA registry', () => {
  // All 15 controls
  const EXPECTED_CONTROLS = [
    'delay',
    'wait-until',
    'if-else',
    'switch-case',
    'assert',
    'for',
    'for-each',
    'while',
    'break',
    'continue',
    'parallel',
    'try-catch-finally',
    'halt',
    'note',
    'variable-setter',
  ]

  // All 40 plugins
  const EXPECTED_PLUGINS = [
    'shell-script',
    'shell-exec',
    'python',
    'file-io',
    'http-client',
    'log',
    'ssh-session-script',
    'ssh-session-open',
    'ssh-session-exec',
    'ssh-session-close',
    'ssh-tunnel-open',
    'ssh-tunnel-close',
    'remote-execution',
    'sftp',
    'ping',
    'netcat',
    'sql-client',
    'opensearch',
    'k8s-connect',
    'k8s-get',
    'k8s-events',
    'k8s-logs',
    'k8s-top',
    'k8s-apply',
    'k8s-delete',
    'k8s-scale',
    'k8s-rollout',
    'k8s-exec',
    'k8s-script',
    'k8s-copy',
    'helm-install',
    'helm-upgrade',
    'helm-rollback',
    'helm-uninstall',
    'helm-test',
    'helm-status',
    'csv-parser',
    'excel-parser',
    'xml-parser',
    'json-parser',
  ]

  const ALL_IDS = [...EXPECTED_CONTROLS, ...EXPECTED_PLUGINS]

  it('contains all 55 entries (15 controls + 40 plugins)', () => {
    expect(Object.keys(CONTROL_METADATA)).toHaveLength(55)
  })

  it('carries no help page for the LDAP block', () => {
    expect(CONTROL_METADATA['ldap-client']).toBeUndefined()
    expect(getControlMetadata('ldap-client')).toBeUndefined()
    expect(getControlVersions('ldap-client')).toEqual([])
  })

  const HELM_IDS = [
    'helm-install',
    'helm-upgrade',
    'helm-rollback',
    'helm-uninstall',
    'helm-test',
    'helm-status',
  ]

  it.each(HELM_IDS)('"%s" ships its first version as 1.0.0', (id) => {
    expect(CONTROL_METADATA[id].versions[0].version).toBe('1.0.0')
  })

  it.each(HELM_IDS)('"%s" names the helm version policy in its details', (id) => {
    expect(CONTROL_METADATA[id].versions[0].details).toMatch(/3\.13/)
  })

  const SHELL_IDS = ['shell-script', 'shell-exec']

  // SHRUN-16: the Details page carries exactly one version.
  it.each(SHELL_IDS)('"%s" ships exactly one version, 1.0.0', (id) => {
    const versions = CONTROL_METADATA[id].versions
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe('1.0.0')
    expect(versions[0].releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(versions[0].changelog.length).toBeGreaterThanOrEqual(1)
  })

  // SHRUN-12: the start line, and the stderr line a non-zero exit message ends with.
  it.each([...SHELL_IDS, 'python'])('"%s" documents the start line and the exit message', (id) => {
    const details = CONTROL_METADATA[id].versions[0].details

    expect(details).toMatch(/one INFO line naming the (shell|interpreter)/)
    expect(details).toMatch(/error message ends with the last line the (script|command) wrote to Stderr/)
  })

  // PYRUN-1: the Python details page carries one version whose changelog names
  // every setting, and PYRUN-17's rules an author cannot see on the sheet.
  describe('python details page (PYRUN-1, PYRUN-17)', () => {
    function pythonDetails(): string {
      return getControlDetails('python', getControlLatestVersion('python')) ?? ''
    }

    it('ships exactly one version, 1.0.0', () => {
      const versions = CONTROL_METADATA['python'].versions

      expect(CONTROL_METADATA['python'].id).toBe('python')
      expect(versions).toHaveLength(1)
      expect(versions[0].version).toBe('1.0.0')
      expect(versions[0].releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('logs one line per setting and rule, not the stub single line', () => {
      const changelog = getControlChangelog('python', '1.0.0')

      expect(changelog.length).toBeGreaterThanOrEqual(10)
      for (const line of changelog) {
        expect(line).toBeTruthy()
      }
      expect(changelog).not.toContain('Full implementation released')
    })

    it.each([
      ['the interpreter rule', /interpreter/i],
      ['the 3.8 floor', /3\.8/],
      ['floats as Decimal', /Decimal/],
      ['exports read on exception', /exception/i],
      ['sys.exit and exit codes', /sys\.exit/],
      ['logging to the console', /logging/i],
      ['the remote host', /remote/i],
    ])('names %s under 1.0.0', (_name, pattern) => {
      const changelog = getControlChangelog('python', '1.0.0')

      expect(changelog.some((line) => pattern.test(line))).toBe(true)
    })

    it('replaces the stub body with real documentation sections', () => {
      expect(pythonDetails()).not.toContain('**Status:**')
      expect(pythonDetails()).toContain('**Use Cases:**')
      expect(pythonDetails()).toContain('**Behavior:**')
      expect(pythonDetails()).toContain('**Parameters:**')
      expect(pythonDetails()).toContain('**Outputs:**')
    })

    it.each([
      'Script Type',
      'Script',
      'Script File',
      'Interpreter',
      'Arguments',
      'Input Variables',
      'Working Directory',
      'Environment',
      'Log Output',
      'Timeout',
      'On error',
      'Variable Exports',
    ])('documents the %s row', (label) => {
      expect(pythonDetails()).toContain(`**${label}**`)
    })
  })

  // A 0.0.x page makes the sheet render no parameter rows at all.
  describe('netcat ships 1.0.0, so the sheet renders its rows (NETCAT-8)', () => {
    it('ships 1.0.0 as its latest and only version', () => {
      expect(getControlLatestVersion('netcat')).toBe('1.0.0')
      expect(getControlVersions('netcat').map((v) => v.version)).toEqual(['1.0.0'])
    })

  })

  describe('sftp ships one 1.0.0 entry', () => {
    it('ships exactly one version, 1.0.0, with a non-empty changelog', () => {
      const versions = CONTROL_METADATA['sftp'].versions

      expect(CONTROL_METADATA['sftp'].id).toBe('sftp')
      expect(versions).toHaveLength(1)
      expect(versions[0].version).toBe('1.0.0')
      expect(versions[0].releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(versions[0].changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('opens its changelog with the release line', () => {
      expect(getControlChangelog('sftp', '1.0.0')[0]).toBe('Full implementation released')
    })
  })

  it('k8s-copy still ships exactly one version, 1.0.0', () => {
    expect(getControlVersions('k8s-copy').map((v) => v.version)).toEqual(['1.0.0'])
  })

  it.each(ALL_IDS)('contains entry for "%s"', (id) => {
    expect(CONTROL_METADATA[id]).toBeDefined()
    expect(CONTROL_METADATA[id].id).toBe(id)
  })

  it.each(ALL_IDS)('"%s" has a non-empty description', (id) => {
    expect(CONTROL_METADATA[id].description).toBeTruthy()
    expect(typeof CONTROL_METADATA[id].description).toBe('string')
  })

  it.each(ALL_IDS)('"%s" has at least one version', (id) => {
    expect(CONTROL_METADATA[id].versions.length).toBeGreaterThanOrEqual(1)
  })

  it.each(ALL_IDS)('"%s" first version has valid releaseDate', (id) => {
    const v = CONTROL_METADATA[id].versions[0]
    expect(v.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(ALL_IDS)('"%s" first version has non-empty changelog', (id) => {
    const v = CONTROL_METADATA[id].versions[0]
    expect(v.changelog.length).toBeGreaterThanOrEqual(1)
    for (const entry of v.changelog) {
      expect(typeof entry).toBe('string')
      expect(entry.length).toBeGreaterThan(0)
    }
  })

  it.each(ALL_IDS)('"%s" first version has details string', (id) => {
    const v = CONTROL_METADATA[id].versions[0]
    expect(typeof v.details).toBe('string')
    expect(v.details.length).toBeGreaterThan(0)
  })

  it('switch-case description names condition-guarded cases', () => {
    expect(CONTROL_METADATA['switch-case'].description).toBe(
      'Multi-way branching with condition-guarded cases',
    )
  })

  // Items with rich details (not just placeholder)
  const ITEMS_WITH_RICH_DETAILS = [
    'delay',
    'wait-until',
    'if-else',
    'switch-case',
    'assert',
    'try-catch-finally',
    'halt',
    'note',
    'variable-setter',
    'http-client',
    'log',
    'xml-parser',
    'json-parser',
  ]

  it.each(ITEMS_WITH_RICH_DETAILS)('"%s" has details longer than 50 chars', (id) => {
    const v = CONTROL_METADATA[id].versions[0]
    expect(v.details.length).toBeGreaterThan(50)
  })

})

// ==========================================================================
// getControlMetadata
// ==========================================================================

describe('getControlMetadata', () => {
  it('returns metadata for existing control', () => {
    const meta = getControlMetadata('delay')
    expect(meta).toBeDefined()
    expect(meta!.id).toBe('delay')
    expect(meta!.description).toBeTruthy()
    expect(meta!.versions.length).toBeGreaterThanOrEqual(1)
  })

  it('returns metadata for existing plugin', () => {
    const meta = getControlMetadata('http-client')
    expect(meta).toBeDefined()
    expect(meta!.id).toBe('http-client')
  })

  it('returns undefined for non-existent control', () => {
    const meta = getControlMetadata('not-a-real-control')
    expect(meta).toBeUndefined()
  })

  // The eleven K8s verb doc pages ship at 1.0.0 with a 2026 release date.
  it.each([
    'k8s-get',
    'k8s-events',
    'k8s-logs',
    'k8s-top',
    'k8s-apply',
    'k8s-delete',
    'k8s-scale',
    'k8s-rollout',
    'k8s-exec',
    'k8s-script',
    'k8s-copy',
  ])(
    'loads the %s plugin doc page by id',
    (id) => {
      const meta = getControlMetadata(id)
      expect(meta).toBeDefined()
      expect(meta!.id).toBe(id)
      expect(meta!.description).toBeTruthy()
      expect(meta!.versions[0].version).toBe('1.0.0')
      expect(meta!.versions[0].releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
      expect(meta!.versions[0].details.length).toBeGreaterThan(0)
    }
  )
})

// ==========================================================================
// getControlVersions
// ==========================================================================

describe('getControlVersions', () => {
  it('returns versions array for existing control', () => {
    const versions = getControlVersions('delay')
    expect(versions.length).toBeGreaterThanOrEqual(1)
    expect(versions[0].version).toBe('1.0.0')
  })

  it('returns empty array for non-existent control', () => {
    const versions = getControlVersions('nonexistent')
    expect(versions).toEqual([])
  })
})

// ==========================================================================
// getControlLatestVersion
// ==========================================================================

describe('getControlLatestVersion', () => {
  it('returns latest version string for implemented control', () => {
    expect(getControlLatestVersion('delay')).toBe('1.0.0')
  })

  it('returns 1.0.0 for parallel', () => {
    expect(getControlLatestVersion('parallel')).toBe('1.0.0')
  })

  it('returns 1.0.0 for switch-case', () => {
    expect(getControlLatestVersion('switch-case')).toBe('1.0.0')
  })

  it('returns 1.0.0 for wait-until', () => {
    expect(getControlLatestVersion('wait-until')).toBe('1.0.0')
  })

  it('returns default 1.0.0 for non-existent control', () => {
    expect(getControlLatestVersion('nonexistent')).toBe('1.0.0')
  })
})

// ==========================================================================
// getControlChangelog
// ==========================================================================

describe('getControlChangelog', () => {
  it('returns changelog entries for valid version', () => {
    const changelog = getControlChangelog('delay', '1.0.0')
    expect(changelog.length).toBeGreaterThan(0)
    expect(changelog).toContain('Full implementation released')
  })

  it('returns empty array for non-existent control', () => {
    expect(getControlChangelog('nonexistent', '1.0.0')).toEqual([])
  })

  it('returns empty array for non-existent version', () => {
    expect(getControlChangelog('delay', '99.99.99')).toEqual([])
  })
})

// ==========================================================================
// getControlDetails
// ==========================================================================

describe('getControlDetails', () => {
  it('returns details for valid control and version', () => {
    const details = getControlDetails('delay', '1.0.0')
    expect(details).toBeDefined()
    expect(details).toContain('Delay control')
  })

  it('returns undefined for non-existent control', () => {
    expect(getControlDetails('nonexistent', '1.0.0')).toBeUndefined()
  })

  it('returns undefined for non-existent version', () => {
    expect(getControlDetails('delay', '99.99.99')).toBeUndefined()
  })
})

// ==========================================================================
// getControlVersionEntry
// ==========================================================================

describe('getControlVersionEntry', () => {
  it('returns version entry for valid control and version', () => {
    const entry = getControlVersionEntry('delay', '1.0.0')
    expect(entry).toBeDefined()
    expect(entry!.version).toBe('1.0.0')
    expect(entry!.releaseDate).toBeTruthy()
    expect(entry!.changelog).toBeDefined()
    expect(entry!.details).toBeDefined()
  })

  it('returns undefined for non-existent control', () => {
    expect(getControlVersionEntry('nonexistent', '1.0.0')).toBeUndefined()
  })

  it('returns undefined for non-existent version', () => {
    expect(getControlVersionEntry('delay', '99.99.99')).toBeUndefined()
  })
})

// ==========================================================================
// Content verification - ensure details content matches original
// ==========================================================================

describe('content preservation', () => {
  it('delay details contain expected content', () => {
    const details = getControlDetails('delay', '1.0.0')!
    expect(details).toContain('Delay control pauses workflow execution')
    expect(details).toContain('Use Cases')
    expect(details).toContain('Behavior')
    expect(details).toContain('Parameters')
    expect(details).toContain('duration')
  })

  it('if-else details contain branch types', () => {
    const details = getControlDetails('if-else', '1.0.0')!
    expect(details).toContain('If')
    expect(details).toContain('Else If')
    expect(details).toContain('Else')
    expect(details).toContain('top-to-bottom')
    expect(details).toContain('first')
  })

  it('switch-case details contain cases, default, break and the then egress', () => {
    const details = getControlDetails('switch-case', '1.0.0')!
    expect(details).toContain('Case')
    expect(details).toContain('Default')
    expect(details).toContain('Break')
    expect(details).toContain('conditions')
    expect(details).toContain('then')
  })

  it('assert details contain assertion types and modes', () => {
    const details = getControlDetails('assert', '1.0.0')!
    expect(details).toContain('Literal')
    expect(details).toContain('Expression')
    expect(details).toContain('Single')
    expect(details).toContain('Split')
    expect(details).toContain('passed')
  })

  it('try-catch-finally details contain error schema and path handles', () => {
    const details = getControlDetails('try-catch-finally', '1.0.0')!
    expect(details).toContain('is_retryable')
    expect(details).toContain('stack_trace')
    expect(details).toContain('output binding')
    expect(details).toContain('try')
    expect(details).toContain('catch')
    expect(details).toContain('finally')
    expect(details).toContain('then')
    expect(details).toContain('egress')
  })

  it('try-catch-finally details call the items on its paths blocks', () => {
    const details = getControlDetails('try-catch-finally', '1.0.0')!
    expect(details).toContain('if any block in the try path throws')
    expect(details).toContain('Protected scope - blocks here execute first.')
    expect(details).toContain('When a try-path block throws')
    expect(details).toContain('so blocks in the catch and finally paths can read it')
    expect(details).toContain('Empty catch path (no blocks connected)')
    expect(details).toContain('| node_id | string | ID of the failed block |')
    expect(getControlChangelog('try-catch-finally', '1.0.0')).toContain(
      'Configurable catch path (enabled by default) for error handling blocks',
    )
  })

  it('halt details contain scope and status', () => {
    const details = getControlDetails('halt', '1.0.0')!
    expect(details).toContain('scope')
    expect(details).toContain('status')
  })

  it.each([
    'continue',
    'break',
    'for',
    'for-each',
    'while',
    'halt',
    'wait-until',
    'ssh-session-exec',
    'remote-execution',
  ])('%s help page calls a canvas item a block, never a node', (id) => {
    const text = getControlVersions(id)
      .flatMap((version) => [...version.changelog, version.details])
      .join('\n')

    expect(text).not.toMatch(/\bnodes?\b/i)
  })

  it('ssh-session-script help page says node only for the Node.js interpreter', () => {
    const details = getControlDetails(
      'ssh-session-script',
      getControlLatestVersion('ssh-session-script'),
    )!
    expect(details).toContain(
      'Pick the interpreter per block (/bin/sh, bash, python3, perl, node) without installing anything extra on the host',
    )
    expect(details).toContain('an unknown, closed, or dropped session fails the block')
    expect(details.match(/\bnodes?\b/gi)).toHaveLength(2)
  })

  it('http-client details contain comprehensive parameter documentation', () => {
    const details = getControlDetails('http-client', getControlLatestVersion('http-client'))!
    expect(details).toContain('HTTP Client')
    expect(details).toContain('Use Cases')
    expect(details).toContain('Parameters')
    expect(details).toContain('Outputs')
    expect(details).toContain('Status Code')
    expect(details).toContain('Body')
    expect(details).toContain('Headers')
  })

  // The download target became File Path, a save-as reference (TDATA-10).
  it('http-client logs its download File Path in the only version it has', () => {
    const versions = getControlVersions('http-client')
    expect(versions.map((v) => v.version)).toEqual(['1.0.0'])

    const entry = getControlVersionEntry('http-client', '1.0.0')!
    expect(entry.releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
    expect(entry.changelog.some((line) => line.includes('File Path'))).toBe(true)
  })

  it('http-client documents the download target under its new name', () => {
    const details = getControlDetails('http-client', getControlLatestVersion('http-client'))!
    expect(details).toContain('**File Path**')
    expect(details).not.toContain('**File Name**')
  })

  it('log details contain log levels', () => {
    const details = getControlDetails('log', '1.0.0')!
    expect(details).toContain('DEBUG')
    expect(details).toContain('INFO')
    expect(details).toContain('WARN')
    expect(details).toContain('ERROR')
    expect(details).toContain('FATAL')
  })

  it('xml-parser details contain XPath', () => {
    const details = getControlDetails('xml-parser', '1.0.0')!
    expect(details).toContain('XPath')
  })

  it('json-parser details contain JSONPath', () => {
    const details = getControlDetails('json-parser', '1.0.0')!
    expect(details).toContain('JSONPath')
  })

  it('variable-setter details contain variables parameter', () => {
    const details = getControlDetails('variable-setter', '1.0.0')!
    expect(details).toContain('variables')
  })

  it('note details contain annotation concepts', () => {
    const details = getControlDetails('note', '1.0.0')!
    expect(details).toContain('sticky-note')
    expect(details).toContain('canvas')
  })
})
