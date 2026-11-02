/**
 * File I/O plugin documentation tests (REQ-3.4.1.10, REQ-5.1.5).
 *
 * The doc page moves off its "Status: Implemented" stub to a single 1.0.0 entry
 * listing what the block does, and its Parameters and Outputs sections name
 * every row the descriptor tables declare.
 *
 * Design decisions: FIO-1 through FIO-11
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

const ID = 'file-io'

const INPUT_LABELS = [
  'Operation',
  'Path',
  'Content',
  'If the file exists',
  'Source',
  'Destination',
  'Ignore missing',
  'Size',
  'Checksum',
  'Output format',
  'RegEx Pattern',
  'Include subfolders',
]

const OUTPUT_LABELS = [
  'Content',
  'Exists',
  'Type',
  'Modified',
  'Size',
  'Checksum',
  'Stats',
  'Entries',
  'Count',
]

const OPERATION_NAMES = [
  'Read',
  'Write',
  'Copy',
  'Move',
  'Delete',
  'Stats',
  'List',
  'Create folder',
]

function details(): string {
  return getControlDetails(ID, getControlLatestVersion(ID)) ?? ''
}

describe('File I/O documentation', () => {
  it('parses metadata with a non-empty description', () => {
    const meta = getControlMetadata(ID)

    expect(meta).toBeDefined()
    expect(meta!.id).toBe(ID)
    expect(meta!.description).toBeTruthy()
  })

  it('ships 1.0.0 as the only version, dated in 2026 (FIO-11)', () => {
    expect(getControlLatestVersion(ID)).toBe('1.0.0')

    const entry = getControlVersionEntry(ID, '1.0.0')
    expect(entry).toBeDefined()
    expect(entry!.releaseDate).toMatch(/^2026-\d{2}-\d{2}$/)
    expect(entry!.deprecated).toBeUndefined()
  })

  it('carries no second version before release', () => {
    const meta = getControlMetadata(ID)

    expect(meta!.versions.map((v) => v.version)).toEqual(['1.0.0'])
    for (const version of meta!.versions) {
      expect(version.releaseDate, version.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(version.changelog.length, version.version).toBeGreaterThan(0)
    }
  })

  it.each([
    ['Stats', /Stats/],
    ['List', /List/],
    ['Create folder', /Create folder/],
    ['If the file exists', /If the file exists/],
    ['Ignore missing', /Ignore missing/],
    ['Browse on path fields', /Browse/],
    ['remotable', /remotable|Remote Execution/i],
  ])('logs %s under 1.0.0', (_name, pattern) => {
    const changelog = getControlChangelog(ID, '1.0.0')

    expect(changelog.some((line) => pattern.test(line))).toBe(true)
  })

  it('logs one line per new operation and setting', () => {
    const changelog = getControlChangelog(ID, '1.0.0')

    expect(changelog.length).toBeGreaterThanOrEqual(7)
    for (const line of changelog) {
      expect(line).toBeTruthy()
    }
  })

  it('replaces the stub body with real documentation sections', () => {
    expect(details()).not.toContain('**Status:**')
    expect(details()).toContain('**Use Cases:**')
    expect(details()).toContain('**Behavior:**')
    expect(details()).toContain('**Parameters:**')
    expect(details()).toContain('**Outputs:**')
  })

  it.each(OPERATION_NAMES)('names the %s operation in the body (FIO-1)', (operation) => {
    expect(details()).toContain(operation)
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

    expect([...declared].sort()).toEqual(
      [...new Set([...INPUT_LABELS, ...OUTPUT_LABELS])].sort(),
    )
    for (const label of declared) {
      expect(details(), label).toContain(`**${label}**`)
    }
  })
})
