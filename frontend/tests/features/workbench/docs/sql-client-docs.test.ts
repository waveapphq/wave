/**
 * SQL details page tests (REQ-3.4.1.6, REQ-3.4.1.19, REQ-5.1.4, REQ-5.1.5); SQL-1, SQL-3, SQL-6, SQL-7, SQL-8, SQL-9, SQL-10, SQL-15.
 */

import { describe, it, expect } from 'vitest'
import {
  getControlMetadata,
  getControlChangelog,
  getControlDetails,
  getControlLatestVersion,
  getControlVersionEntry,
} from '@/features/workbench/docs/_loader'
import { getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'

const ID = 'sql-client'

const INPUT_LABELS = [
  'Operation',
  'Database type',
  'Host',
  'Port',
  'Database',
  'Username',
  'Password',
  'File',
  'Script Type',
  'SQL',
  'SQL File',
  'Parameters',
  'Stop on error',
  'Procedure',
  'Arguments',
  'Out arguments',
  'Table',
  'Target table',
  'Mode',
  'Key columns',
  'Commit each batch',
  'Timeout',
  'TLS',
  'Verify Server Certificate',
  'CA Certificate',
  'Client Certificate',
  'Client Key',
  'Connect timeout',
  'Max rows',
  'Batch size',
  'Driver options',
  'On error',
]

const OUTPUT_LABELS = ['Success', 'Rows', 'Row count', 'Rows changed', 'Out values', 'Error', 'Reason']

const HEADINGS = ['Use Cases', 'Behavior', 'Parameters', 'Outputs', 'Databases']

const DATABASES = ['PostgreSQL', 'MySQL / MariaDB', 'Oracle', 'SQL Server', 'SQLite']

const DATABASE_ENTRIES = [
  'Separator',
  'Placeholder in the DEBUG log',
  'Booleans',
  'Add or replace',
  'Driver options',
]

const HEADING_LINE = /^\*\*[^*]+:\*\*$/
const BOLD_BULLET = /^- \*\*(.+?)\*\*/
const NESTED_BULLET = /^\s+- (.+)$/
const ENTRY_LABEL = /^([^:]+):/
// A slash that stands on its own, not the one inside PL/SQL.
const LONE_SLASH = /(^|[\s`'"(])\/($|[\s`'",.)])/

interface DatabaseBullet {
  name: string
  entries: string[]
}

function details(): string {
  return getControlDetails(ID, getControlLatestVersion(ID)) ?? ''
}

function lines(): string[] {
  return details().split('\n')
}

/** The lines under a `**Heading:**` line, up to the next heading line. */
function sectionLines(heading: string): string[] {
  const all = lines()
  const start = all.indexOf(`**${heading}:**`)
  if (start < 0) return []
  const rest = all.slice(start + 1)
  const end = rest.findIndex((line) => HEADING_LINE.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

/** Top-level `- **Label**` bullets under a `**Heading:**` line. */
function sectionBullets(heading: string): string[] {
  return sectionLines(heading)
    .map((line) => BOLD_BULLET.exec(line)?.[1])
    .filter((l): l is string => l !== undefined)
}

/** Each database bullet under Databases with the text of its nested bullets. */
function databaseBullets(): DatabaseBullet[] {
  const result: DatabaseBullet[] = []
  for (const line of sectionLines('Databases')) {
    const top = BOLD_BULLET.exec(line)
    if (top) {
      result.push({ name: top[1], entries: [] })
      continue
    }
    const nested = NESTED_BULLET.exec(line)
    if (nested && result.length > 0) result[result.length - 1].entries.push(nested[1])
  }
  return result
}

function database(name: string): DatabaseBullet {
  const found = databaseBullets().find((d) => d.name === name)
  expect(found, `the ${name} bullet under Databases`).toBeDefined()
  return found!
}

/** The nested entry of a database that starts with `{label}:`. */
function entry(name: string, label: string): string {
  const found = database(name).entries.find((e) => e.startsWith(`${label}:`))
  expect(found, `${name} ${label}`).toBeDefined()
  return found!
}

describe('SQL documentation', () => {
  it('parses metadata with a non-empty description', () => {
    const meta = getControlMetadata(ID)

    expect(meta).toBeDefined()
    expect(meta!.id).toBe(ID)
    expect(meta!.description).toBeTruthy()
  })

  it('ships 1.0.0 as the only version, dated in 2026', () => {
    expect(getControlLatestVersion(ID)).toBe('1.0.0')

    const entryOfVersion = getControlVersionEntry(ID, '1.0.0')
    expect(entryOfVersion).toBeDefined()
    expect(entryOfVersion!.releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
    expect(entryOfVersion!.deprecated).toBeUndefined()
    expect(getControlMetadata(ID)!.versions.map((v) => v.version)).toEqual(['1.0.0'])
  })

  it('logs one line per feature, not the placeholder line', () => {
    const changelog = getControlChangelog(ID, '1.0.0')

    expect(changelog.length).toBeGreaterThanOrEqual(6)
    for (const line of changelog) {
      expect(line.trim().length, line).toBeGreaterThan(0)
    }
    expect(changelog).not.toContain('Placeholder version')
  })

  it.each([
    ['Run SQL', /Run SQL/],
    ['Call procedure', /Call procedure/],
    ['Load table', /Load table/],
    ['remote execution', /Remote Execution/],
  ])('logs %s under 1.0.0', (_name, pattern) => {
    const changelog = getControlChangelog(ID, '1.0.0')

    expect(changelog.some((line) => pattern.test(line))).toBe(true)
  })

  it('logs the {} expression toggle of the SQL row under 1.0.0 (SQL-10)', () => {
    expect(getControlChangelog(ID, '1.0.0')).toContain(
      'SQL row takes the {} expression toggle: the expression gives the SQL text; :name parameters still bind',
    )
  })

  it('describes the SQL row with its {} expression under Parameters (SQL-10)', () => {
    const line = sectionLines('Parameters').find((text) => text.startsWith('- **SQL**:'))

    expect(line).toBe(
      '- **SQL**: One statement or a whole script, with `:name` where a value goes; with {}, an expression that gives the SQL text (required with Source) (Run SQL)',
    )
  })

  it('replaces the stub body with real documentation sections', () => {
    expect(details()).not.toContain('**Status:**')
  })

  it.each(HEADINGS)('carries the %s heading on its own line', (heading) => {
    expect(lines()).toContain(`**${heading}:**`)
  })

  it.each(INPUT_LABELS)('documents the %s row', (label) => {
    expect(details()).toContain(`**${label}**`)
  })

  it.each(OUTPUT_LABELS)('documents the %s output', (label) => {
    expect(details()).toContain(`**${label}**`)
  })

  it('documents every label the descriptors declare, and invents none', () => {
    const declared = new Set<string>()
    for (const row of getInputParams(ID) ?? []) declared.add(row.label ?? row.name)
    for (const out of getOutputParams(ID) ?? []) declared.add(out.label ?? out.name)

    expect([...declared].toSorted()).toEqual(
      [...new Set([...INPUT_LABELS, ...OUTPUT_LABELS])].toSorted(),
    )
    for (const label of declared) {
      expect(details(), label).toContain(`**${label}**`)
    }
  })

  it('lists each row once under Parameters in sheet order, and nothing else', () => {
    expect(sectionBullets('Parameters')).toEqual(INPUT_LABELS)
  })

  it('lists the outputs under Outputs in order, and nothing else (SQL-9)', () => {
    expect(sectionBullets('Outputs')).toEqual(OUTPUT_LABELS)
  })

  it('lists the five databases under Databases in order, and nothing else', () => {
    expect(databaseBullets().map((d) => d.name)).toEqual(DATABASES)
  })

  it.each(DATABASES.filter((name) => name !== 'SQLite'))(
    'documents the separator, DEBUG placeholder, booleans, Add or replace and driver options of %s',
    (name) => {
      expect(database(name).entries.map((e) => ENTRY_LABEL.exec(e)?.[1] ?? e)).toEqual(
        DATABASE_ENTRIES,
      )
    },
  )

  it('documents the same entries for SQLite, then what is not available there', () => {
    expect(database('SQLite').entries.map((e) => ENTRY_LABEL.exec(e)?.[1] ?? e)).toEqual([
      ...DATABASE_ENTRIES,
      'Not available',
    ])
  })

  it.each(['PostgreSQL', 'MySQL / MariaDB'])('separates %s statements with ; (SQL-3)', (name) => {
    expect(entry(name, 'Separator')).toContain(';')
  })

  it('separates SQL Server batches with a GO line (SQL-3)', () => {
    expect(entry('SQL Server', 'Separator')).toMatch(/\bGO\b/)
  })

  it('separates an Oracle PL/SQL block with a / line (SQL-3)', () => {
    expect(entry('Oracle', 'Separator')).toMatch(LONE_SLASH)
  })

  it('names the Oracle dsn driver option (SQL-8)', () => {
    expect(entry('Oracle', 'Driver options')).toContain('dsn')
  })

  it('says an Oracle dsn is a full connect descriptor or host:port/service, and a TNS alias is refused (REQ-3.4.1.19)', () => {
    const options = entry('Oracle', 'Driver options')

    expect(options).toContain('TNS alias is refused')
    expect(options).toContain('full connect descriptor')
    expect(options).toContain('host:port/service')
  })

  it('says an Oracle dsn that is a configuration provider address is refused (REQ-3.4.1.19)', () => {
    const options = entry('Oracle', 'Driver options')

    expect(options).toMatch(/is refused, and so are .*configuration provider address \(`config-file:\/\/\.\.\.`\)/)
  })

  it('says an Oracle dsn that is a directory address is refused (REQ-3.4.1.19)', () => {
    const options = entry('Oracle', 'Driver options')

    expect(options).toMatch(/is refused, and so are .*directory address \(`ldap:\/\/\.\.\.`\)/)
  })

  it('says an Oracle dsn must agree with the TLS row, tcps:// with TLS on (REQ-3.4.1.19)', () => {
    const matching = sectionLines('Behavior').filter((text) => text.includes('agree with the TLS row'))

    expect(matching).toHaveLength(1)
    expect(matching[0]).toMatch(/\bOracle\b/)
    expect(matching[0]).toContain('`dsn`')
    expect(matching[0]).toContain('`tcps://`')
    expect(matching[0]).toContain('With TLS on')
    expect(matching[0]).toContain('With TLS off')
    expect(matching[0]).toContain('fails the block before anything connects')
  })

  it.each(['Oracle', 'SQL Server'])('maps booleans to 1 and 0 on %s (SQL-7)', (name) => {
    const booleans = entry(name, 'Booleans')
    expect(booleans).toMatch(/\b1\b/)
    expect(booleans).toMatch(/\b0\b/)
  })

  it('says Add or replace on MySQL matches any unique key (SQL-7)', () => {
    expect(entry('MySQL / MariaDB', 'Add or replace')).toContain('unique key')
  })

  it('names Call procedure as not available on SQLite (SQL-6)', () => {
    expect(entry('SQLite', 'Not available')).toContain('Call procedure')
  })

  it('names timeout and cached_statements as the only SQLite driver options, and no sqlite3.connect (REQ-3.4.1.19)', () => {
    expect(entry('SQLite', 'Driver options')).toBe(
      'Driver options: `timeout`, seconds to wait on a locked file, and `cached_statements`; any other name is refused',
    )
    expect(details()).not.toContain('sqlite3.connect')
  })

  it('says an Oracle procedure hands its rows back with DBMS_SQL.RETURN_RESULT, into Rows (SQL-6, SQL-9)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('DBMS_SQL.RETURN_RESULT'))

    expect(line, 'a Behavior line naming DBMS_SQL.RETURN_RESULT').toBeDefined()
    expect(line).toMatch(/\bOracle\b/)
    expect(line).toMatch(/\bRows\b/)
  })

  it('says a PostgreSQL function is called with SELECT * FROM when CALL finds no procedure, into Rows (SQL-6, SQL-9)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('SELECT * FROM'))

    expect(line, 'a Behavior line naming SELECT * FROM').toBeDefined()
    expect(line).toMatch(/\bPostgreSQL\b/)
    expect(line).toMatch(/\bCALL\b/)
    expect(line).toMatch(/\bfunction\b/)
    expect(line).toMatch(/\bRows\b/)
  })

  it('says a PostgreSQL function\'s OUT parameters named under Out arguments fill Out values (SQL-6, SQL-9)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('SELECT * FROM'))

    expect(line).toMatch(/\bOUT parameters\b/)
    expect(line).toMatch(/\bOut arguments\b/)
    expect(line).toMatch(/\bOut values\b/)
  })

  it('says session state (USE, SET, ALTER SESSION) ends with the block (SQL-1, SQL-3)', () => {
    expect(
      lines().some(
        (line) =>
          /session state/i.test(line) &&
          /\bUSE\b/.test(line) &&
          /\bSET\b/.test(line) &&
          /ALTER SESSION/.test(line) &&
          /ends with the block/i.test(line),
      ),
    ).toBe(true)
  })

  it('says an Oracle session uses the database\'s own time zone (REQ-3.4.1.19)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('time zone'))

    expect(line, 'a Behavior line naming the time zone').toBeDefined()
    expect(line).toMatch(/\bOracle\b/)
    expect(line).toContain('the database\'s own time zone')
  })

  it('says the program name is WAVE, and a Driver option of the same name wins (REQ-3.4.1.19)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('program name'))

    expect(line, 'a Behavior line naming the program name').toBeDefined()
    expect(line).toMatch(/["`]WAVE["`]/)
    expect(line).toContain('Driver option')
    expect(line).toContain('of the same name')
    expect(line).toMatch(/\bwins\b/)
  })

  it('names SQLite among the prebuilt builds of a Remote Execution body, with glibc 2.28 (REQ-3.4.1.19, SQL-15)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('Remote Execution'))

    expect(line, 'a Behavior line naming Remote Execution').toBeDefined()
    expect(line).toContain('prebuilt build')
    expect(line).toMatch(/\bSQLite\b/)
    expect(line).toContain('glibc 2.28')
  })

  it('says SQLite is WAVE\'s own bundled build, the same version on the WAVE host and on remote hosts (REQ-3.4.1.19, SQL-15)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('bundled build'))

    expect(line, 'a Behavior line naming the bundled build').toBeDefined()
    expect(line).toMatch(/\bSQLite\b/)
    expect(line).toContain('WAVE\'s own bundled build')
    expect(line).toContain('the same version')
    expect(line).toContain('WAVE host')
    expect(line).toMatch(/\bremote hosts?\b/)
  })

  it('names DBTIMEZONE as the time zone an Oracle session uses (REQ-3.4.1.19)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('time zone'))

    expect(line).toContain('uses the database\'s own time zone (`DBTIMEZONE`), not the time zone of')
  })

  it('gives glibc 2.17 and musl 1.2 as the floor of every prebuilt build, and glibc 2.28 as SQLite\'s own (REQ-3.4.1.19, SQL-15)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('Remote Execution'))

    expect(line).toContain(
      'travel as prebuilt builds for Python 3.10 to 3.14 on x86_64 or aarch64 with glibc 2.17 or newer, or musl 1.2 or newer.',
    )
    expect(line).toContain('SQLite also needs glibc 2.28 or newer on the remote host; an older one fails the block the same way')
    expect(line!.match(/musl/g)).toHaveLength(1)
  })

  it('says which hosts fail the block with reason Unsupported, a C library too old to load a build among them (SQL-15)', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('Remote Execution'))

    expect(line).toContain(
      'A host with a newer Python, another processor or another C library, or one too old to load a build, fails the block with reason Unsupported.',
    )
    expect(line).not.toContain('another machine')
  })

  it('says the Driver options names are the driver\'s own except on SQLite, and points at Databases (SQL-8)', () => {
    const line = sectionLines('Parameters').find((text) => text.startsWith('- **Driver options**:'))

    expect(line).toContain(
      'handed to the driver under the driver\'s own names, except on SQLite: its two names are WAVE\'s own. See Databases for them and for the common ones.',
    )
  })

  it('says Get Tables connects from the WAVE host, and nowhere says WAVE server', () => {
    const line = sectionLines('Behavior').find((text) => text.includes('Get Tables'))

    expect(details()).not.toContain('WAVE server')
    expect(line).toContain('WAVE host')
  })
})
