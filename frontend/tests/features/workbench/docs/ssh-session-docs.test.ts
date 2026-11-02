/**
 * SSH Session plugin documentation tests (REQ-3.4.1.3, REQ-5.1.5).
 *
 * The three docs markdown files replace their "Status: Implemented" stubs
 * with real content: frontmatter (id, description, versions with changelog)
 * plus a body carrying Use Cases / Behavior / Parameters / Outputs sections,
 * following the http-client.md contract parsed by docs/_loader. Open's page
 * names every block that references its Session ID (SSH-11).
 */

import { describe, it, expect } from 'vitest'
import {
  getControlMetadata,
  getControlDetails,
  getControlLatestVersion,
  getControlChangelog,
} from '@/features/workbench/docs/_loader'

const SSH_SESSION_IDS = ['ssh-session-open', 'ssh-session-exec', 'ssh-session-close']

describe.each(SSH_SESSION_IDS)('%s documentation', (id) => {
  it('parses metadata with a non-empty description', () => {
    const meta = getControlMetadata(id)

    expect(meta).toBeDefined()
    expect(meta!.id).toBe(id)
    expect(meta!.description).toBeTruthy()
  })

  it('declares at least one version with a release date', () => {
    const meta = getControlMetadata(id)

    expect(meta!.versions.length).toBeGreaterThan(0)
    expect(getControlLatestVersion(id)).toBeTruthy()
    for (const version of meta!.versions) {
      expect(version.version).toBeTruthy()
      expect(version.releaseDate).toBeTruthy()
    }
  })

  it('carries a non-empty changelog for the latest version', () => {
    const changelog = getControlChangelog(id, getControlLatestVersion(id))

    expect(changelog.length).toBeGreaterThan(0)
    for (const entry of changelog) {
      expect(entry).toBeTruthy()
    }
  })

  it('replaces the stub body with real documentation sections', () => {
    const details = getControlDetails(id, getControlLatestVersion(id)) ?? ''

    expect(details).not.toContain('**Status:**')
    expect(details).toContain('**Use Cases:**')
    expect(details).toContain('**Behavior:**')
    expect(details).toContain('**Parameters:**')
    expect(details).toContain('**Outputs:**')
  })
})

describe('cross-plugin documentation consistency', () => {
  it('documents the session lifecycle pairing in each body', () => {
    const openDetails = getControlDetails(
      'ssh-session-open',
      getControlLatestVersion('ssh-session-open'),
    ) ?? ''
    const execDetails = getControlDetails(
      'ssh-session-exec',
      getControlLatestVersion('ssh-session-exec'),
    ) ?? ''
    const closeDetails = getControlDetails(
      'ssh-session-close',
      getControlLatestVersion('ssh-session-close'),
    ) ?? ''

    // The trio's contract is the shared session id variable (SSH-6).
    expect(openDetails).toContain('Session ID')
    expect(execDetails).toContain('Session ID')
    expect(closeDetails).toContain('Session ID')
  })
})

describe('ssh-session-open documentation of the Session ID consumers (SSH-11)', () => {
  const CONSUMERS = ['Exec', 'Script', 'Close', 'Tunnel Open', 'SFTP', 'Remote Execution']
  const details = (): string =>
    getControlDetails('ssh-session-open', getControlLatestVersion('ssh-session-open')) ?? ''
  const lineStartingWith = (prefix: string): string =>
    details().split('\n').find((line) => line.startsWith(prefix)) ?? ''

  it.each([
    ['the page description', () => getControlMetadata('ssh-session-open')!.description],
    ['the introduction', () => details().slice(0, details().indexOf('**Use Cases:**'))],
    ['the Session ID binding line', () => lineStartingWith('- Bind the Session ID output')],
    ['the Session ID output line', () => lineStartingWith('- **Session ID**:')],
  ])('names every referencing block in %s', (_where, text) => {
    for (const consumer of CONSUMERS) {
      expect(text(), consumer).toContain(consumer)
    }
  })

  it.each([
    ['the Session ID binding line', '- Bind the Session ID output'],
    ['the Session ID output line', '- **Session ID**:'],
  ])("names a chained Open's Parent Session in %s", (_where, prefix) => {
    expect(lineStartingWith(prefix)).toContain('Parent Session')
  })

  it('keeps a single 1.0.0 version entry', () => {
    expect(getControlMetadata('ssh-session-open')!.versions.map((v) => v.version)).toEqual(['1.0.0'])
  })
})

describe('ssh-session-open documentation of the Host Key Verification default (REQ-4.5.14)', () => {
  const details = (): string =>
    getControlDetails('ssh-session-open', getControlLatestVersion('ssh-session-open')) ?? ''
  const hostKeyLine = (): string =>
    details().split('\n').find((line) => line.startsWith('- **Host Key Verification**:')) ?? ''

  it('says the default is disabled and a newly placed block takes the Settings default', () => {
    expect(hostKeyLine()).toContain(
      '(default: disabled; a newly placed block takes the Settings default)',
    )
    expect(hostKeyLine()).not.toContain('default: accept-new')
    expect(details()).not.toContain('default: accept-new')
  })
})
