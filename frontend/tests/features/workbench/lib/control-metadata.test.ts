/**
 * Control Metadata Tests
 *
 * Tests for control metadata registry, version history, and utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  getControlMetadata,
  getControlVersions,
  getControlLatestVersion,
  getControlChangelog,
  getControlDetails,
  getControlVersionEntry,
  CONTROL_METADATA,
} from '@/features/workbench/docs/_loader'

describe('Control Metadata', () => {
  // ==========================================================================
  // HTTP Client Metadata (REQ-3.4.1.4)
  // ==========================================================================

  describe('HTTP Client Metadata (REQ-3.4.1.4)', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['http-client']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['http-client']
      expect(meta.id).toBe('http-client')
    })

    it('has a description', () => {
      const meta = CONTROL_METADATA['http-client']
      expect(meta.description).toBeTruthy()
      expect(typeof meta.description).toBe('string')
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['http-client']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['http-client']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // Must be a 2026 date
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has non-empty changelog', () => {
      const meta = CONTROL_METADATA['http-client']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog.length).toBeGreaterThanOrEqual(1)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['http-client']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['http-client']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })
  })

  describe('Log Plugin Metadata (REQ-3.4.1.17)', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['log']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['log']
      expect(meta.id).toBe('log')
    })

    it('has a description', () => {
      const meta = CONTROL_METADATA['log']
      expect(meta.description).toBeTruthy()
      expect(typeof meta.description).toBe('string')
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['log']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['log']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has non-empty changelog', () => {
      const meta = CONTROL_METADATA['log']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog.length).toBeGreaterThanOrEqual(1)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['log']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['log']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })
  })

  describe('Log Plugin Metadata Utility Functions', () => {
    it('getControlMetadata returns log metadata', () => {
      const meta = getControlMetadata('log')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('log')
    })

    it('getControlVersions returns versions array for log', () => {
      const versions = getControlVersions('log')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for log', () => {
      const version = getControlLatestVersion('log')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for log 1.0.0', () => {
      const changelog = getControlChangelog('log', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for log 1.0.0', () => {
      const details = getControlDetails('log', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for log 1.0.0', () => {
      const entry = getControlVersionEntry('log', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })
  })

  // ==========================================================================
  // Var Setter Control Metadata (REQ-3.4.1.14)
  // ==========================================================================

  describe('Var Setter Metadata (REQ-3.4.1.14)', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['variable-setter']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.id).toBe('variable-setter')
    })

    it('has non-empty description', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.description).toBeTruthy()
      expect(meta.description.length).toBeGreaterThan(0)
    })

    it('has version 1.0.0', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.versions).toHaveLength(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('has releaseDate in 2026', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.versions[0].releaseDate).toMatch(/^2026-/)
    })

    it('has non-empty changelog', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.versions[0].changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('has details string', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.versions[0].details).toBeTruthy()
      expect(typeof meta.versions[0].details).toBe('string')
    })

    it('details mention variables parameter', () => {
      const meta = CONTROL_METADATA['variable-setter']
      expect(meta.versions[0].details).toContain('variables')
    })

    it('details do not mention scope parameter', () => {
      const meta = CONTROL_METADATA['variable-setter']
      const details = meta.versions[0].details!.toLowerCase()
      expect(details).not.toContain('scope parameter')
      expect(details).not.toContain('scope selector')
    })
  })

  describe('Var Setter Metadata Utility Functions', () => {
    it('getControlMetadata returns variable-setter metadata', () => {
      const meta = getControlMetadata('variable-setter')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('variable-setter')
    })

    it('getControlVersions returns versions array for variable-setter', () => {
      const versions = getControlVersions('variable-setter')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for variable-setter', () => {
      const version = getControlLatestVersion('variable-setter')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for variable-setter 1.0.0', () => {
      const changelog = getControlChangelog('variable-setter', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for variable-setter 1.0.0', () => {
      const details = getControlDetails('variable-setter', '1.0.0')
      expect(details).toBeTruthy()
    })
  })

  describe('If/Else Metadata', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['if-else']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['if-else']
      expect(meta.id).toBe('if-else')
    })

    it('has a description mentioning N-branch conditional', () => {
      const meta = CONTROL_METADATA['if-else']
      expect(meta.description).toBeTruthy()
      expect(meta.description).toContain('N-branch')
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['if-else']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has 5 changelog entries', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog).toHaveLength(5)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 details mention branch types (If, Else If, Else)', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('If')
      expect(v1!.details).toContain('Else If')
      expect(v1!.details).toContain('Else')
    })

    it('version 1.0.0 details mention behavior (top-to-bottom, first match wins)', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('top-to-bottom')
      expect(v1!.details).toContain('first')
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['if-else']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })

    it('does not have 0.0.1 placeholder version anymore', () => {
      const meta = CONTROL_METADATA['if-else']
      const v001 = meta.versions.find((v) => v.version === '0.0.1')
      expect(v001).toBeUndefined()
    })
  })

  describe('If/Else Metadata Utility Functions', () => {
    it('getControlMetadata returns if-else metadata', () => {
      const meta = getControlMetadata('if-else')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('if-else')
    })

    it('getControlVersions returns versions array for if-else', () => {
      const versions = getControlVersions('if-else')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for if-else', () => {
      const version = getControlLatestVersion('if-else')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for if-else 1.0.0', () => {
      const changelog = getControlChangelog('if-else', '1.0.0')
      expect(changelog).toHaveLength(5)
    })

    it('getControlDetails returns details for if-else 1.0.0', () => {
      const details = getControlDetails('if-else', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for if-else 1.0.0', () => {
      const entry = getControlVersionEntry('if-else', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })
  })

  describe('Assert Metadata', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['assert']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['assert']
      expect(meta.id).toBe('assert')
    })

    it('has a description mentioning assertions and branching', () => {
      const meta = CONTROL_METADATA['assert']
      expect(meta.description).toBeTruthy()
      expect(meta.description).toContain('assertions')
      expect(meta.description).toContain('branch')
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['assert']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has non-empty changelog', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog.length).toBeGreaterThanOrEqual(1)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })

    it('version 1.0.0 details mention assertion types (Literal, Expression)', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('Literal')
      expect(v1!.details).toContain('Expression')
    })

    it('version 1.0.0 details mention operating modes (Single, Split)', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('Single')
      expect(v1!.details).toContain('Split')
    })

    it('version 1.0.0 details mention output (passed)', () => {
      const meta = CONTROL_METADATA['assert']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('passed')
    })

  })

  describe('Assert Metadata Utility Functions', () => {
    it('getControlMetadata returns assert metadata', () => {
      const meta = getControlMetadata('assert')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('assert')
    })

    it('getControlVersions returns versions array for assert', () => {
      const versions = getControlVersions('assert')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for assert', () => {
      const version = getControlLatestVersion('assert')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for assert 1.0.0', () => {
      const changelog = getControlChangelog('assert', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for assert 1.0.0', () => {
      const details = getControlDetails('assert', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for assert 1.0.0', () => {
      const entry = getControlVersionEntry('assert', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })

  })

  describe('HTTP Client Metadata Utility Functions', () => {
    it('getControlMetadata returns http-client metadata', () => {
      const meta = getControlMetadata('http-client')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('http-client')
    })

    it('getControlVersions returns versions array for http-client', () => {
      const versions = getControlVersions('http-client')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for http-client', () => {
      const version = getControlLatestVersion('http-client')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for http-client 1.0.0', () => {
      const changelog = getControlChangelog('http-client', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for http-client 1.0.0', () => {
      const details = getControlDetails('http-client', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for http-client 1.0.0', () => {
      const entry = getControlVersionEntry('http-client', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })

    it('getControlVersionEntry returns undefined for non-existent version', () => {
      const entry = getControlVersionEntry('http-client', '99.99.99')
      expect(entry).toBeUndefined()
    })
  })

  describe('XML Parser Metadata', () => {
    it('getControlMetadata returns xml-parser metadata', () => {
      const meta = getControlMetadata('xml-parser')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('xml-parser')
    })

    it('has a non-empty description', () => {
      const meta = getControlMetadata('xml-parser')
      expect(meta!.description).toBeTruthy()
      expect(meta!.description.length).toBeGreaterThan(0)
    })

    it('getControlVersions returns versions array for xml-parser', () => {
      const versions = getControlVersions('xml-parser')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for xml-parser', () => {
      const version = getControlLatestVersion('xml-parser')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for xml-parser 1.0.0', () => {
      const changelog = getControlChangelog('xml-parser', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for xml-parser 1.0.0', () => {
      const details = getControlDetails('xml-parser', '1.0.0')
      expect(details).toBeTruthy()
      expect(details!).toContain('XPath')
    })

    it('getControlVersionEntry returns entry for xml-parser 1.0.0', () => {
      const entry = getControlVersionEntry('xml-parser', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
      expect(entry!.releaseDate).toBeTruthy()
    })
  })

  // ==========================================================================
  // Halt Control Metadata (REQ-3.5.1.4, REQ-3.5.1.14)
  // ==========================================================================

  describe('Halt Metadata (REQ-3.5.1.4)', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['halt']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['halt']
      expect(meta.id).toBe('halt')
    })

    it('has a meaningful description (not just placeholder)', () => {
      const meta = CONTROL_METADATA['halt']
      expect(meta.description).toBeTruthy()
      expect(meta.description.length).toBeGreaterThan(10)
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['halt']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has non-empty changelog', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog.length).toBeGreaterThanOrEqual(1)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })

    it('version 1.0.0 details mention scope configuration', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('scope')
    })

    it('version 1.0.0 details mention status parameter', () => {
      const meta = CONTROL_METADATA['halt']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('status')
    })

  })

  describe('Halt Metadata Utility Functions', () => {
    it('getControlMetadata returns halt metadata', () => {
      const meta = getControlMetadata('halt')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('halt')
    })

    it('getControlVersions returns versions array for halt', () => {
      const versions = getControlVersions('halt')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for halt', () => {
      const version = getControlLatestVersion('halt')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for halt 1.0.0', () => {
      const changelog = getControlChangelog('halt', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(1)
    })

    it('getControlDetails returns details for halt 1.0.0', () => {
      const details = getControlDetails('halt', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for halt 1.0.0', () => {
      const entry = getControlVersionEntry('halt', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })

  })

  // ==========================================================================
  // Try/Catch/Finally Control Metadata (REQ-3.2.2.6)
  // ==========================================================================

  describe('Try/Catch/Finally Metadata (REQ-3.2.2.6)', () => {
    it('exists in CONTROL_METADATA registry', () => {
      expect(CONTROL_METADATA['try-catch-finally']).toBeDefined()
    })

    it('has correct id', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      expect(meta.id).toBe('try-catch-finally')
    })

    it('has a meaningful description (not just placeholder)', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      expect(meta.description).toBeTruthy()
      expect(meta.description.length).toBeGreaterThan(10)
    })

    it('has version 1.0.0 as latest', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      expect(meta.versions).toBeDefined()
      expect(meta.versions.length).toBeGreaterThanOrEqual(1)
      expect(meta.versions[0].version).toBe('1.0.0')
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1).toBeDefined()
      expect(v1!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v1!.releaseDate).toMatch(/^2026-/)
    })

    it('version 1.0.0 has non-empty changelog with at least 3 entries', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.changelog.length).toBeGreaterThanOrEqual(3)
      for (const entry of v1!.changelog) {
        expect(typeof entry).toBe('string')
        expect(entry.length).toBeGreaterThan(0)
      }
    })

    it('version 1.0.0 has non-empty details markdown', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toBeTruthy()
      expect(v1!.details.length).toBeGreaterThan(50)
    })

    it('version 1.0.0 is not deprecated', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.deprecated).toBeFalsy()
    })

    it('version 1.0.0 details document error object schema', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('is_retryable')
      expect(v1!.details).toContain('stack_trace')
      expect(v1!.details).toContain('output binding')
    })

    it('version 1.0.0 details document path handles', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('try')
      expect(v1!.details).toContain('catch')
      expect(v1!.details).toContain('finally')
      expect(v1!.details).toContain('then')
    })

    it('version 1.0.0 details mention egress handle', () => {
      const meta = CONTROL_METADATA['try-catch-finally']
      const v1 = meta.versions.find((v) => v.version === '1.0.0')
      expect(v1!.details).toContain('egress')
    })

  })

  describe('Try/Catch/Finally Metadata Utility Functions', () => {
    it('getControlMetadata returns try-catch-finally metadata', () => {
      const meta = getControlMetadata('try-catch-finally')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('try-catch-finally')
    })

    it('getControlVersions returns versions array', () => {
      const versions = getControlVersions('try-catch-finally')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0', () => {
      const version = getControlLatestVersion('try-catch-finally')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns changelog for 1.0.0', () => {
      const changelog = getControlChangelog('try-catch-finally', '1.0.0')
      expect(changelog.length).toBeGreaterThanOrEqual(3)
    })

    it('getControlDetails returns details for 1.0.0', () => {
      const details = getControlDetails('try-catch-finally', '1.0.0')
      expect(details).toBeTruthy()
    })

    it('getControlVersionEntry returns entry for 1.0.0', () => {
      const entry = getControlVersionEntry('try-catch-finally', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
    })

  })

  describe('JSON Parser Metadata', () => {
    it('getControlMetadata returns json-parser metadata', () => {
      const meta = getControlMetadata('json-parser')
      expect(meta).toBeDefined()
      expect(meta!.id).toBe('json-parser')
    })

    it('has a non-empty description containing JSON', () => {
      const meta = getControlMetadata('json-parser')
      expect(meta!.description).toBeTruthy()
      expect(meta!.description.length).toBeGreaterThan(0)
      expect(meta!.description).toContain('JSON')
    })

    it('getControlVersions returns versions array for json-parser', () => {
      const versions = getControlVersions('json-parser')
      expect(versions.length).toBeGreaterThanOrEqual(1)
      expect(versions[0].version).toBe('1.0.0')
    })

    it('getControlLatestVersion returns 1.0.0 for json-parser', () => {
      const version = getControlLatestVersion('json-parser')
      expect(version).toBe('1.0.0')
    })

    it('getControlChangelog returns 7 entries for json-parser 1.0.0', () => {
      const changelog = getControlChangelog('json-parser', '1.0.0')
      expect(changelog).toHaveLength(7)
    })

    it('getControlDetails returns details containing JSONPath for json-parser 1.0.0', () => {
      const details = getControlDetails('json-parser', '1.0.0')
      expect(details).toBeTruthy()
      expect(details!).toContain('JSONPath')
    })

    it('getControlVersionEntry returns entry for json-parser 1.0.0', () => {
      const entry = getControlVersionEntry('json-parser', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry!.version).toBe('1.0.0')
      expect(entry!.releaseDate).toBeTruthy()
    })

    it('version 1.0.0 has valid releaseDate in ISO format', () => {
      const entry = getControlVersionEntry('json-parser', '1.0.0')
      expect(entry!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry!.releaseDate).toMatch(/^2026-/)
    })
  })
})
