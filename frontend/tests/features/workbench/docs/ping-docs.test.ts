/**
 * Ping details page tests (REQ-3.4.1.9, REQ-3.3.4.4, REQ-5.1.5); PING-1, PING-2, PING-4, PING-5,
 * PING-6, PING-7, PING-8, PING-9, PING-11, PING-15.
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

const ID = 'ping'

const INTERVAL_LABEL = 'Interval (seconds)'
const PACKET_SIZE_LABEL = 'Packet size (bytes)'
const MIN_RATE_LABEL = 'Minimum rate (%)'
const DONT_FRAGMENT_LABEL = "Don't fragment"

const INPUT_LABELS = [
  'Host',
  'Count',
  INTERVAL_LABEL,
  PACKET_SIZE_LABEL,
  'Timeout',
  'Pass when',
  'Minimum replies',
  MIN_RATE_LABEL,
  'Log Output',
  'IP version',
  'TTL',
  DONT_FRAGMENT_LABEL,
  'Source address',
  'On error',
]

const OUTPUT_LABELS = ['Success', 'Summary', 'Replies', 'Error', 'Reason']

const PASS_WHEN_CHOICES = ['Any reply', 'All replies', 'At least N replies', 'At least X% replies']

/** Each Advanced row, and the patterns the line explaining it must carry (PING-7, PING-8). */
const ADVANCED_ROWS: [string, RegExp[]][] = [
  ['IP version', [/address family/i]],
  ['TTL', [/hop/i]],
  [DONT_FRAGMENT_LABEL, [/MTU/i, /path/i]],
  ['Source address', [/address/i, /interface name/i]],
]

const SUMMARY_COLUMNS = [/sent/i, /received/i, /loss/i, /minimum/i, /average/i, /maximum/i, /mdev/]
const REPLY_COLUMNS = [/sequence/i, /source/i, /bytes/i, /TTL/, /millisecond/i, /status/i]

const HEADING_LINE = /^\*\*[^*]+:\*\*$/
const BOLD_BULLET = /^- \*\*(.+?)\*\*/

function details(): string {
  return getControlDetails(ID, getControlLatestVersion(ID)) ?? ''
}

function lines(): string[] {
  return details().split('\n')
}

/** Top-level `- **Label**` bullets under a `**Heading:**` line, up to the next heading line. */
function sectionBullets(heading: string): string[] {
  const all = lines()
  const start = all.indexOf(`**${heading}:**`)
  if (start < 0) return []
  const rest = all.slice(start + 1)
  const end = rest.findIndex((line) => HEADING_LINE.test(line))
  return (end < 0 ? rest : rest.slice(0, end))
    .map((line) => BOLD_BULLET.exec(line)?.[1])
    .filter((l): l is string => l !== undefined)
}

function linesNaming(text: string): string[] {
  return lines().filter((line) => line.includes(text))
}

/** True when one line names `text` and matches every pattern. */
function explains(text: string, patterns: RegExp[]): boolean {
  return linesNaming(text).some((line) => patterns.every((pattern) => pattern.test(line)))
}

describe('Ping documentation', () => {
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
    ['ICMP echo requests', /ICMP echo request/i],
    ['the Pass when rules', /Pass when/],
    ['the Advanced rows', /Advanced/],
    ['the privilege model', /unprivileged|no root/i],
    ['remote execution', /Remote Execution|remotable/i],
    ['On error', /On error/],
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

  it('lists the rows under Parameters in sheet order, and nothing else', () => {
    expect(sectionBullets('Parameters')).toEqual(INPUT_LABELS)
  })

  it('lists the outputs under Outputs in order, and nothing else (PING-9)', () => {
    expect(sectionBullets('Outputs')).toEqual(OUTPUT_LABELS)
  })

  it('documents that the block needs no root and no sudo anywhere (PING-4)', () => {
    expect(details()).toMatch(/no root/i)
    expect(details()).toMatch(/no sudo/i)
  })

  it('names the operating system unprivileged ICMP path (PING-4)', () => {
    expect(explains('unprivileged', [/ICMP/])).toBe(true)
  })

  it('documents the refusal: the block fails at once, named machine and setting (PING-5)', () => {
    expect(
      lines().some(
        (line) =>
          /refus/i.test(line) &&
          /fails the block|the block fails/i.test(line) &&
          /ping_group_range/.test(line) &&
          /machine|WAVE server|remote host/i.test(line),
      ),
    ).toBe(true)
  })

  it('documents that the block runs on the remote host inside a Remote Execution body (PING-1)', () => {
    expect(lines().some((line) => /Remote Execution/.test(line) && /remote host/i.test(line))).toBe(
      true,
    )
  })

  it('rules out an SSH tunnel, because a port-forward carries TCP and ICMP is not TCP (PING-1)', () => {
    expect(
      lines().some(
        (line) => /tunnel|port-forward/i.test(line) && /TCP/.test(line) && /ICMP/.test(line),
      ),
    ).toBe(true)
  })

  it('documents one host per block, and that a sweep is a different tool (PING-2)', () => {
    expect(details()).toMatch(/one host/i)
    expect(lines().some((line) => /sweep/i.test(line) && /different tool/i.test(line))).toBe(true)
  })

  it('documents that Timeout is the real bound on the whole block (PING-6)', () => {
    expect(explains('Timeout', [/whole block|the block/i])).toBe(true)
  })

  it.each(PASS_WHEN_CHOICES)('documents the %s rule (PING-3)', (choice) => {
    expect(details()).toContain(choice)
  })

  it.each(ADVANCED_ROWS)('explains the %s row (PING-7, PING-8)', (label, patterns) => {
    expect(explains(label, patterns), label).toBe(true)
  })

  it('names the Summary columns (PING-9)', () => {
    expect(explains('**Summary**', SUMMARY_COLUMNS)).toBe(true)
  })

  it('says in plain words that round-trip mdev is the standard deviation (PING-11)', () => {
    expect(explains('mdev', [/standard deviation/, /round-trip/i])).toBe(true)
  })

  it('names the Replies columns (PING-9)', () => {
    expect(explains('**Replies**', REPLY_COLUMNS)).toBe(true)
  })

  it('names what the Replies status says (PING-15)', () => {
    const status = linesNaming('status')

    expect(status.length).toBeGreaterThan(0)
    expect(status.some((line) => /answered/.test(line) && /timed out/.test(line))).toBe(true)
    expect(status.some((line) => /ICMP error/i.test(line) && /(from|sent it)/i.test(line))).toBe(
      true,
    )
    expect(status.some((line) => /path/i.test(line) && /fragment/i.test(line))).toBe(true)
  })

  it('documents both On error choices, and what Record and continue still reports', () => {
    expect(
      lines().some((line) => /Fail the block/.test(line) && /Record and continue/.test(line)),
    ).toBe(true)
    expect(
      lines().some(
        (line) =>
          /Record and continue/.test(line) && /Summary/.test(line) && /Replies/.test(line),
      ),
    ).toBe(true)
  })
})
