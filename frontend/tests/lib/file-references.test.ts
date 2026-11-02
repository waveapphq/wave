/**
 * WAVE-side file reference helpers: reference building and
 * the folder + name split the save-as picker composes.
 *
 * Module: frontend/src/lib/file-references.ts
 */

import { describe, it, expect } from 'vitest'
import {
  buildTestDataReference,
  buildArtifactReference,
  splitReference,
  joinReference,
} from '@/lib/file-references'

describe('buildTestDataReference', () => {
  it('prefixes a relative file path with the test data scheme', () => {
    expect(buildTestDataReference('users.csv')).toBe('testdata://users.csv')
  })

  it('keeps the folder structure of a nested path', () => {
    expect(buildTestDataReference('fixtures/nested/users.csv')).toBe(
      'testdata://fixtures/nested/users.csv'
    )
  })
})

describe('buildArtifactReference', () => {
  it('prefixes a relative file path with the artifact scheme', () => {
    expect(buildArtifactReference('out.json')).toBe('artifact://out.json')
  })

  it('keeps the folder structure of a nested path', () => {
    expect(buildArtifactReference('reports/2026/out.json')).toBe(
      'artifact://reports/2026/out.json'
    )
  })
})

describe('splitReference', () => {
  it('splits a scheme value into its folder and its name', () => {
    expect(splitReference('testdata://fixtures/users.csv')).toEqual({
      folder: 'testdata://fixtures',
      name: 'users.csv',
    })
  })

  it('splits an artifact scheme value the same way', () => {
    expect(splitReference('artifact://reports/out.json')).toEqual({
      folder: 'artifact://reports',
      name: 'out.json',
    })
  })

  it('reports a bare name as a name with no folder', () => {
    expect(splitReference('users.csv')).toEqual({ folder: '', name: 'users.csv' })
  })

  it('splits a nested relative path at its last separator', () => {
    expect(splitReference('fixtures/nested/users.csv')).toEqual({
      folder: 'fixtures/nested',
      name: 'users.csv',
    })
  })

  it('splits an absolute path at its last separator', () => {
    expect(splitReference('/var/data/out.csv')).toEqual({ folder: '/var/data', name: 'out.csv' })
  })

  it('reports an empty value as an empty folder and an empty name', () => {
    expect(splitReference('')).toEqual({ folder: '', name: '' })
  })
})

describe('joinReference', () => {
  it('joins a folder and a name with one separator', () => {
    expect(joinReference('testdata://fixtures', 'users.csv')).toBe(
      'testdata://fixtures/users.csv'
    )
  })

  it('returns the name alone when there is no folder', () => {
    expect(joinReference('', 'users.csv')).toBe('users.csv')
  })

  it('returns an empty value when there is neither folder nor name', () => {
    expect(joinReference('', '')).toBe('')
  })

  it.each([
    'testdata://fixtures/users.csv',
    'artifact://reports/out.json',
    'artifact://out.json',
    'users.csv',
    '/var/data/out.csv',
    '',
  ])('round-trips %s through splitReference', (value) => {
    const { folder, name } = splitReference(value)

    expect(joinReference(folder, name)).toBe(value)
  })
})
