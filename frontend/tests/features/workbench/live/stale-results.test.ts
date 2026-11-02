/**
 * Evaluated results the next ad-hoc run evaluates again (REQ-3.2.1.5).
 *
 * After a run, the row of an evaluated expression or template shows its result.
 * Once its source, or a variable it reads, is edited, the next ad-hoc run
 * evaluates it again, so the panel drops the old result.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  editedDefinitions,
  namesBlocksWrite,
  resultsReading,
  type DefinedVariable,
  type ResultsContext,
} from '@/features/workbench/live/stale-results'

const identifiers = (source: string) => source.match(/\b([a-zA-Z_]\w*)\b/g) ?? []

const host: DefinedVariable = { id: 'v-host', name: 'host', value: 'b', type: 'string' }
const url: DefinedVariable = {
  id: 'v-url',
  name: 'url',
  value: "'http://' + host",
  type: 'string',
  isExpression: true,
}
const page: DefinedVariable = {
  id: 'v-page',
  name: 'page',
  value: '{{ url }}/index',
  type: 'string',
  isTemplate: true,
}

function context(overrides: Partial<ResultsContext> = {}): ResultsContext {
  return {
    variables: [host, url, page],
    live: new Map<string, unknown>([
      ['url', 'http://b'],
      ['page', 'http://b/index'],
    ]),
    overrides: new Map(),
    blockWritten: new Set(),
    namesRead: identifiers,
    ...overrides,
  }
}

describe('resultsReading', () => {
  it('names the result that reads an edited variable and the one that reads it in turn', () => {
    expect(resultsReading(['host'], context())).toEqual(['url', 'page'])
  })

  it('names an edited result itself', () => {
    expect(resultsReading(['page'], context())).toEqual(['page'])
  })

  it('names nothing when no result reads the edited variable', () => {
    expect(resultsReading(['other'], context())).toEqual([])
  })

  it('leaves a computed variable no run evaluated', () => {
    const live = new Map<string, unknown>([['page', 'http://b/index']])

    expect(resultsReading(['host'], context({ live }))).toEqual([])
  })

  it('leaves a value a block may have written', () => {
    const blockWritten = new Set(['url'])

    expect(resultsReading(['host'], context({ blockWritten }))).toEqual([])
  })

  it('leaves a computed variable that has no source yet', () => {
    const unset: DefinedVariable = { id: 'v-url', name: 'url', type: 'string', isExpression: true }

    expect(resultsReading(['host', 'url'], context({ variables: [host, unset] }))).toEqual([])
  })

  it('never names a literal, even one that holds a live value', () => {
    const live = new Map<string, unknown>([['host', 'from-a-block']])

    expect(resultsReading(['host'], context({ live }))).toEqual([])
  })

  it('reads a Current-mode source in place of the definition', () => {
    const overrides = new Map([['url', { expression: "'http://' + other", type: 'string' }]])

    expect(resultsReading(['host'], context({ overrides }))).toEqual([])
    expect(resultsReading(['other'], context({ overrides }))).toEqual(['url', 'page'])
  })

  it('counts a literal with a Current-mode source as a result', () => {
    const overrides = new Map([['host', { template: '{{ zone }}', type: 'string' }]])
    const live = new Map<string, unknown>([['host', 'eu']])

    expect(resultsReading(['zone'], context({ overrides, live }))).toEqual(['host'])
  })

  it('asks for the names of an expression and of a template each in its own way', () => {
    const namesRead = vi.fn(identifiers)

    resultsReading(['host'], context({ namesRead }))

    expect(namesRead.mock.calls).toEqual([
      ["'http://' + host", false],
      ['{{ url }}/index', true],
    ])
  })

  it('reads a Current-mode template as a template', () => {
    const namesRead = vi.fn(identifiers)
    const overrides = new Map([['url', { template: 'http://{{ host }}', type: 'string' }]])

    resultsReading(['host'], context({ namesRead, overrides, variables: [host, url] }))

    expect(namesRead.mock.calls).toEqual([['http://{{ host }}', true]])
  })
})

describe('editedDefinitions', () => {
  const edited = (previous: DefinedVariable[], overrides: Partial<ResultsContext> = {}) =>
    [...editedDefinitions(previous, context(overrides))].sort((a, b) => a.localeCompare(b))

  it('names nothing when the definitions are the same', () => {
    expect(edited([{ ...host }, { ...url }, { ...page }])).toEqual([])
  })

  it('names a literal whose value changed and that follows its definition', () => {
    expect(edited([{ ...host, value: 'a' }, url, page])).toEqual(['host'])
  })

  it('names a variable whose type changed', () => {
    expect(edited([{ ...host, type: 'integer' }, url, page])).toEqual(['host'])
  })

  it('leaves a literal that holds a value the session gave it', () => {
    const live = new Map<string, unknown>([['host', 'from-a-block']])

    expect(edited([{ ...host, value: 'a' }, url, page], { live })).toEqual([])
  })

  it('names an evaluated expression whose source changed', () => {
    expect(edited([host, { ...url, value: "'ftp://' + host" }, page])).toEqual(['url'])
  })

  it('names a literal that was turned into an expression', () => {
    const variables = [{ ...host, value: "'b'", isExpression: true }, url, page]

    expect(edited([host, url, page], { variables })).toEqual(['host'])
  })

  it('names a computed variable whose kind changed', () => {
    expect(edited([host, url, { ...page, isTemplate: false, isExpression: true }])).toEqual(['page'])
  })

  it('leaves a computed variable whose value a block may have written', () => {
    const blockWritten = new Set(['url'])

    expect(edited([host, { ...url, value: "'ftp://' + host" }, page], { blockWritten })).toEqual([])
  })

  it('leaves a variable that follows a Current-mode source', () => {
    const overrides = new Map([['url', { expression: "'https://' + host", type: 'string' }]])

    expect(edited([host, { ...url, value: "'ftp://' + host" }, page], { overrides })).toEqual([])
  })

  it('leaves a variable that follows a Current-mode template', () => {
    const overrides = new Map([['page', { template: '{{ url }}/home', type: 'string' }]])

    expect(edited([host, url, { ...page, value: '{{ url }}' }], { overrides })).toEqual([])
  })

  it('names a variable with a staged Current-mode value that no run has used yet', () => {
    const overrides = new Map([['host', { value: 'staged', type: 'string' }]])

    expect(edited([{ ...host, value: 'a' }, url, page], { overrides })).toEqual(['host'])
  })

  it('names a removed variable', () => {
    const gone: DefinedVariable = { id: 'v-zone', name: 'zone', value: 'eu', type: 'string' }

    expect(edited([host, url, page, gone])).toEqual(['zone'])
  })

  it('names a removed expression a run had evaluated', () => {
    const gone: DefinedVariable = { id: 'v-zone', name: 'zone', value: "'eu'", isExpression: true }
    const live = new Map<string, unknown>([['zone', 'eu']])

    expect(edited([host, url, page, gone], { live })).toEqual(['zone'])
  })

  it('names an added variable', () => {
    expect(edited([url, page])).toEqual(['host'])
  })

  it('names both the old and the new name of a renamed variable', () => {
    expect(edited([{ ...host, name: 'server' }, url, page])).toEqual(['host', 'server'])
  })
})

describe('namesBlocksWrite', () => {
  const node = (data: Record<string, unknown>) => ({ data })

  it('collects output binding targets and Variable Setter targets', () => {
    const nodes = [
      node({ elementType: 'http-client', config: { outputBindings: { body: 'page', status: '' } } }),
      node({ elementType: 'variable-setter', config: { values: { variables: { url: "'x'" } } } }),
    ]

    expect([...namesBlocksWrite(nodes)]).toEqual(['page', 'url'])
  })

  it('reads nothing from a block without a config, bindings or Setter rows', () => {
    const nodes = [
      node({ elementType: 'log' }),
      node({ elementType: 'log', config: {} }),
      node({ elementType: 'variable-setter', config: { values: {} } }),
      node({ elementType: 'log', config: { values: { variables: { host: 'x' } } } }),
    ]

    expect([...namesBlocksWrite(nodes)]).toEqual([])
  })
})
