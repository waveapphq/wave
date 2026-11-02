/**
 * Netcat details page tests (REQ-3.4.1.9, REQ-3.3.4.3, REQ-5.1.5); NETCAT-1, NETCAT-7, NETCAT-8, NETCAT-9, NETCAT-12.
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

const ID = 'netcat'

const MAX_REPLY_LABEL = 'Max reply size (bytes)'

const INPUT_LABELS = [
  'Host',
  'Ports',
  'Port',
  'Port range',
  'Pass when',
  'Protocol',
  'Mode',
  'Send',
  'Text',
  'File',
  'Timeout',
  'CRLF line endings',
  'Close after sending',
  MAX_REPLY_LABEL,
  'On error',
]

const OUTPUT_LABELS = ['Success', 'Results', 'Reply', 'Error', 'Reason']

const PORT_STATES: [string, RegExp[]][] = [
  ['open', [/connect/i, /reply/i]],
  ['closed', [/refus/i]],
  ['timed out', [/no answer/i]],
  ['open or filtered', [/no reply/i, /pass/i]],
]

const HEADING_LINE = /^\*\*[^*]+:\*\*$/
const BOLD_BULLET = /^- \*\*(.+?)\*\*/

function details(): string {
  return getControlDetails(ID, getControlLatestVersion(ID)) ?? ''
}

/** Top-level `- **Label**` bullets under a `**Heading:**` line, up to the next heading line. */
function sectionBullets(heading: string): string[] {
  const lines = details().split('\n')
  const start = lines.indexOf(`**${heading}:**`)
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => HEADING_LINE.test(line))
  return (end < 0 ? rest : rest.slice(0, end))
    .map((line) => BOLD_BULLET.exec(line)?.[1])
    .filter((l): l is string => l !== undefined)
}

function linesNaming(state: string): string[] {
  return details()
    .split('\n')
    .filter((line) => line.includes(`\`${state}\``))
}

describe('Netcat documentation', () => {
  it('parses metadata with a non-empty description', () => {
    const meta = getControlMetadata(ID)

    expect(meta).toBeDefined()
    expect(meta!.id).toBe(ID)
    expect(meta!.description).toBeTruthy()
  })

  it('ships 1.0.0 as the only version, dated in 2026', () => {
    expect(getControlLatestVersion(ID)).toBe('1.0.0')

    const entry = getControlVersionEntry(ID, '1.0.0')
    expect(entry).toBeDefined()
    expect(entry!.releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
    expect(entry!.deprecated).toBeUndefined()
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
    ['port checks', /Check/],
    ['talking to a port', /Talk/],
    ['ranges and Pass when', /Pass when/],
    ['UDP', /UDP/],
    ['SSH tunnels', /tunnel/i],
    ['remotable', /remotable|Remote Execution/i],
  ])('logs %s under 1.0.0', (_name, pattern) => {
    const changelog = getControlChangelog(ID, '1.0.0')

    expect(changelog.some((line) => pattern.test(line))).toBe(true)
  })

  it('replaces the stub body with real documentation sections', () => {
    expect(details()).not.toContain('**Status:**')
    expect(details()).toContain('**Use Cases:**')
    expect(details()).toContain('**Behavior:**')
    expect(details()).toContain('**Parameters:**')
    expect(details()).toContain('**Outputs:**')
  })

  it.each(PORT_STATES)('explains the %s port state in plain words (NETCAT-8)', (state, patterns) => {
    const lines = linesNaming(state)

    expect(lines.length, state).toBeGreaterThan(0)
    expect(
      lines.some((line) => patterns.every((pattern) => pattern.test(line))),
      state,
    ).toBe(true)
  })

  it('explains that a port behind an SSH tunnel is tested at the far end (NETCAT-9)', () => {
    expect(details()).toMatch(/SSH tunnel/)
    expect(details()).toMatch(/127\.0\.0\.1|localhost/)
    expect(details()).toMatch(/local port/i)
    expect(details()).toMatch(/\bfar\b/i)
  })

  it('documents that UDP cannot go through an SSH tunnel (NETCAT-9)', () => {
    expect(details()).toContain('SSH tunnels carry TCP only')
  })

  it('documents that the block runs on the remote host inside a Remote Execution body (NETCAT-1)', () => {
    const lines = details().split('\n')

    expect(lines.some((line) => /Remote Execution/.test(line) && /remote host/i.test(line))).toBe(
      true,
    )
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

  it('lists the rows under Parameters in sheet order, and nothing else (NETCAT-12)', () => {
    expect(sectionBullets('Parameters')).toEqual(INPUT_LABELS)
  })

  it('lists the outputs under Outputs in order, and nothing else (NETCAT-7)', () => {
    expect(sectionBullets('Outputs')).toEqual(OUTPUT_LABELS)
  })
})
