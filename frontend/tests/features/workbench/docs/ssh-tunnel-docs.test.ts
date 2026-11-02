/**
 * SSH Tunnel plugin documentation tests (REQ-3.4.1.3, REQ-5.1.5).
 *
 * The two tunnel markdown files replace their "Status: Implemented" stubs with
 * real content: frontmatter (id, description, versions with changelog) plus a
 * body carrying Use Cases / Behavior / Parameters / Outputs sections, following
 * the ssh-session-close.md contract parsed by docs/_loader. Each body documents
 * that a tunnel rides an open SSH session (Session ID) and is closed by its
 * Tunnel ID. Tunnel Open documents every input and its Validate Target check
 * (SSHTUN-7) inside the single 1.0.0 entry.
 */

import { describe, it, expect } from 'vitest'
import {
  getControlMetadata,
  getControlDetails,
  getControlLatestVersion,
  getControlChangelog,
} from '@/features/workbench/docs/_loader'
import { getInputParams } from '@/features/workbench/lib/node-parameters'

const SSH_TUNNEL_IDS = ['ssh-tunnel-open', 'ssh-tunnel-close']

describe.each(SSH_TUNNEL_IDS)('%s documentation', (id) => {
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
  it('documents the session/tunnel lifecycle pairing in each body', () => {
    const openDetails = getControlDetails(
      'ssh-tunnel-open',
      getControlLatestVersion('ssh-tunnel-open'),
    ) ?? ''
    const closeDetails = getControlDetails(
      'ssh-tunnel-close',
      getControlLatestVersion('ssh-tunnel-close'),
    ) ?? ''

    expect(openDetails).toContain('Session ID')
    expect(openDetails).toContain('Tunnel ID')
    expect(closeDetails).toContain('Tunnel ID')
  })
})

describe('ssh-tunnel-open documentation of Validate Target (SSHTUN-7)', () => {
  const details = (): string =>
    getControlDetails('ssh-tunnel-open', getControlLatestVersion('ssh-tunnel-open')) ?? ''

  function section(name: string, next: string): string {
    const text = details()
    return text.slice(text.indexOf(`**${name}:**`), text.indexOf(`**${next}:**`))
  }

  it('keeps a single 1.0.0 version entry', () => {
    expect(getControlMetadata('ssh-tunnel-open')!.versions.map((v) => v.version)).toEqual(['1.0.0'])
  })

  it('lists every Tunnel Open input in the Parameters section', () => {
    const parameters = section('Parameters', 'Outputs')

    for (const input of getInputParams('ssh-tunnel-open') ?? []) {
      expect(parameters, `Parameters entry for ${input.label}`).toContain(`- **${input.label}**:`)
    }
  })

  it('describes the Validate Target check in the Behavior section', () => {
    expect(section('Behavior', 'Parameters')).toContain('Validate Target')
  })

  it('names Validate Target in the 1.0.0 changelog', () => {
    const changelog = getControlChangelog('ssh-tunnel-open', '1.0.0')

    expect(changelog.some((entry) => entry.includes('Validate Target'))).toBe(true)
  })
})
