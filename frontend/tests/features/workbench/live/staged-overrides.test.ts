/**
 * Idle Current-edit staging.
 *
 * While idle (no live session) a Current-mode edit stages a transient override
 * instead of hitting the backend. Staged overrides:
 *   - merge into EVERY run request's `variables` seed while present,
 *   - take display precedence below the live WS value but above the definition
 *     (live > staged > definition),
 *   - clear on Reset.
 * They never write the saved definition.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  mergeStagedIntoRunVariables,
  resolveCurrentDisplay,
  resolveCurrentExpressionSource,
  stagedFunctionVariables,
  useStagedOverrides,
  withOverrideSource,
  type StagedOverride,
} from '@/features/workbench/live/staged-overrides'

function stagedMap(entries: Array<[string, StagedOverride]>): Map<string, StagedOverride> {
  return new Map(entries)
}

/** The map the staging hook holds once each `[name, override, functionPath?]` is staged. */
function stagedVia(entries: Array<[string, StagedOverride, string[]?]>): Map<string, StagedOverride> {
  const { result } = renderHook(() => useStagedOverrides())
  act(() => {
    for (const [name, override, functionPath] of entries) result.current.stage(name, override, functionPath)
  })
  return result.current.read()
}

describe('mergeStagedIntoRunVariables', () => {
  it('returns the base seed unchanged when nothing is staged', () => {
    const base = { count: { type: 'integer', value: '1' } }
    expect(mergeStagedIntoRunVariables(base, stagedMap([]))).toEqual(base)
  })

  it('adds a staged literal as a typed value seed entry', () => {
    const staged = stagedMap([['count', { value: '42', type: 'integer' }]])
    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({
      count: { type: 'integer', value: '42' },
    })
  })

  it('adds a staged expression with the isExpression flag set', () => {
    const staged = stagedMap([['derived', { expression: '1 + 2', type: 'integer' }]])
    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({
      derived: { type: 'integer', value: '1 + 2', isExpression: true },
    })
  })

  it('adds a staged template with the isTemplate flag set', () => {
    const staged = stagedMap([['url', { template: 'https://{{ host }}', type: 'string' }]])
    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({
      url: { type: 'string', value: 'https://{{ host }}', isTemplate: true },
    })
  })

  it.each<[string, StagedOverride, Record<string, unknown>]>([
    ['value', { value: 'new', type: 'string' }, { type: 'string', value: 'new', secret: true }],
    [
      'expression',
      { expression: "'a' + 'b'", type: 'string' },
      { type: 'string', value: "'a' + 'b'", isExpression: true, secret: true },
    ],
    [
      'template',
      { template: '{{ a }}', type: 'string' },
      { type: 'string', value: '{{ a }}', isTemplate: true, secret: true },
    ],
  ])('keeps a secret variable secret when a staged %s replaces it', (_kind, override, entry) => {
    const base = { token: { type: 'string', value: 'old', secret: true } }
    expect(mergeStagedIntoRunVariables(base, stagedMap([['token', override]]))).toEqual({
      token: entry,
    })
  })

  it('lets a staged override win over a base seed of the same name', () => {
    const base = { count: { type: 'integer', value: '1' } }
    const staged = stagedMap([['count', { value: '99', type: 'integer' }]])
    expect(mergeStagedIntoRunVariables(base, staged)).toEqual({
      count: { type: 'integer', value: '99' },
    })
  })

  it('does not mutate the base seed', () => {
    const base = { a: { type: 'string', value: 'x' } }
    mergeStagedIntoRunVariables(base, stagedMap([['b', { value: '1', type: 'integer' }]]))
    expect(base).toEqual({ a: { type: 'string', value: 'x' } })
  })
})

describe('staged overrides - element types (REQ-3.1.3.19)', () => {
  it('seeds a staged literal array / map with its element types', () => {
    const staged = stagedMap([['m', { value: { n: '20' }, type: 'map', elementTypes: { n: 'integer' } }]])
    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({
      m: { type: 'map', value: { n: '20' }, elementTypes: { n: 'integer' } },
    })
  })

  const display = (override: StagedOverride | undefined, sessionBaseline: unknown) =>
    resolveCurrentDisplay({
      hasLiveValue: false,
      liveValue: undefined,
      override,
      sessionBaseline,
      definitionValue: { n: '1' },
      baselineElementTypes: { n: 'float' },
      definitionElementTypes: { n: 'string' },
    })

  it('shows each fallback value with its own element types', () => {
    expect(display({ value: { n: '20' }, type: 'map', elementTypes: { n: 'integer' } }, { n: '2' })).toEqual({
      value: { n: '20' },
      hasValue: true,
      elementTypes: { n: 'integer' },
    })
    expect(display(undefined, { n: '2' })).toEqual({
      value: { n: '2' },
      hasValue: true,
      elementTypes: { n: 'float' },
    })
    expect(display(undefined, undefined)).toEqual({
      value: { n: '1' },
      hasValue: false,
      elementTypes: { n: 'string' },
    })
  })

  it('reads a re-armed expression override as not evaluated over the baseline', () => {
    expect(display({ expression: 'x', type: 'map' }, { n: '2' })).toEqual({
      value: { n: '2' },
      hasValue: false,
      elementTypes: { n: 'float' },
    })
  })
})

describe('resolveCurrentDisplay - precedence live > override > sessionBaseline > definition', () => {
  it('prefers the live runtime value over an override, the baseline and the definition', () => {
    expect(
      resolveCurrentDisplay({
        hasLiveValue: true,
        liveValue: 'live',
        override: { value: 'override', type: 'string' },
        sessionBaseline: 'seeded',
        definitionValue: 'def',
      }),
    ).toEqual({ value: 'live', hasValue: true })
  })

  it('falls back to the override value when there is no live value', () => {
    expect(
      resolveCurrentDisplay({
        hasLiveValue: false,
        liveValue: undefined,
        override: { value: 'override', type: 'string' },
        sessionBaseline: 'seeded',
        definitionValue: 'def',
      }),
    ).toEqual({ value: 'override', hasValue: true })
  })

  it('anchors to the session baseline over the definition when a session exists (no live, no override)', () => {
    // While paused/stopped, Current shows the run-start backend value,
    // never the (editable) Initial definition - editing Initial cannot move it.
    expect(
      resolveCurrentDisplay({
        hasLiveValue: false,
        liveValue: undefined,
        override: undefined,
        sessionBaseline: 'seeded',
        definitionValue: 'edited-definition',
      }),
    ).toEqual({ value: 'seeded', hasValue: true })
  })

  it('falls back to the definition when idle (no live, no override, no session baseline)', () => {
    expect(
      resolveCurrentDisplay({
        hasLiveValue: false,
        liveValue: undefined,
        override: undefined,
        sessionBaseline: undefined,
        definitionValue: 'def',
      }),
    ).toEqual({ value: 'def', hasValue: false })
  })

  it('treats an override template as not rendered yet (no realized display value)', () => {
    expect(
      resolveCurrentDisplay({
        hasLiveValue: false,
        liveValue: undefined,
        override: { template: '{{ a }}', type: 'string' },
        sessionBaseline: undefined,
        definitionValue: '{{ b }}',
      }),
    ).toEqual({ value: '{{ b }}', hasValue: false })
  })

  it('treats an override expression as not-yet-evaluated (no realized display value)', () => {
    const result = resolveCurrentDisplay({
      hasLiveValue: false,
      liveValue: undefined,
      override: { expression: '1 + 2', type: 'integer' },
      sessionBaseline: undefined,
      definitionValue: 5,
    })
    // A re-armed expression has no realized value until the next reference.
    expect(result.hasValue).toBe(false)
  })
})

describe('resolveCurrentDisplay - a live run that started without a value (VMGR-19)', () => {
  const startedNull = {
    hasLiveValue: false,
    liveValue: undefined,
    override: undefined,
    sessionBaseline: null,
    definitionValue: 9874,
  }

  it('reads as holding null, whatever the definition says since', () => {
    expect(
      resolveCurrentDisplay({
        hasLiveValue: false,
        liveValue: undefined,
        override: undefined,
        sessionBaseline: null,
        definitionValue: 9874,
      }),
    ).toEqual({ value: null, hasValue: true })
  })

  it('shows the value the run gave', () => {
    expect(resolveCurrentDisplay({ ...startedNull, hasLiveValue: true, liveValue: 7 })).toEqual({
      value: 7,
      hasValue: true,
    })
  })

  it('shows a Current-mode value', () => {
    const override = { value: 5, type: 'integer' }

    expect(resolveCurrentDisplay({ ...startedNull, override })).toEqual({
      value: 5,
      hasValue: true,
      elementTypes: undefined,
    })
  })

  it('reads a re-armed source as not evaluated yet', () => {
    const override = { expression: 'a + 1', type: 'integer' }

    expect(resolveCurrentDisplay({ ...startedNull, override })).toEqual({
      value: null,
      hasValue: false,
    })
  })

  it('shows the definition once no run holds the variable', () => {
    expect(resolveCurrentDisplay({ ...startedNull, sessionBaseline: undefined })).toEqual({
      value: 9874,
      hasValue: false,
      elementTypes: undefined,
    })
  })
})

describe('useStagedOverrides', () => {
  it('starts with no staged overrides', () => {
    const { result } = renderHook(() => useStagedOverrides())
    expect(result.current.read().size).toBe(0)
  })

  it('stages a literal override keyed by name', () => {
    const { result } = renderHook(() => useStagedOverrides())
    act(() => result.current.stage('count', { value: '42', type: 'integer' }))
    expect(result.current.read().get('count')).toEqual({ value: '42', type: 'integer' })
  })

  it('overwrites an existing staged entry for the same name', () => {
    const { result } = renderHook(() => useStagedOverrides())
    act(() => result.current.stage('count', { value: '1', type: 'integer' }))
    act(() => result.current.stage('count', { value: '2', type: 'integer' }))
    expect(result.current.read().get('count')).toEqual({ value: '2', type: 'integer' })
    expect(result.current.read().size).toBe(1)
  })

  it('reads a value at once after it is staged, before any re-render (VMGR-64)', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useStagedOverrides()
    })
    const { stage, read } = result.current

    stage('count', { value: '9', type: 'integer' })

    expect(read().get('count')).toEqual({ value: '9', type: 'integer' })
    expect(renders).toBe(1)
  })

  it('clear() empties all staged overrides (Reset)', () => {
    const { result } = renderHook(() => useStagedOverrides())
    act(() => result.current.stage('a', { value: '1', type: 'integer' }))
    act(() => result.current.stage('b', { expression: 'x + 1', type: 'integer' }))
    act(() => result.current.clear())
    expect(result.current.read().size).toBe(0)
  })
})

describe('staged Current values are kept per scope (REQ-3.2.1.6)', () => {
  const TEST_COUNT: StagedOverride = { value: '1', type: 'integer' }
  const FN_COUNT: StagedOverride = { value: '9', type: 'integer' }

  it('keeps a Test variable value and a same-named Function local value apart', () => {
    const staged = stagedVia([
      ['count', TEST_COUNT],
      ['count', FN_COUNT, ['fn-a']],
    ])

    expect(staged.size).toBe(2)
  })

  it('keeps the same name in two Function instances apart', () => {
    const staged = stagedVia([
      ['count', FN_COUNT, ['fn-a']],
      ['count', FN_COUNT, ['fn-b']],
    ])

    expect(staged.size).toBe(2)
  })

  it('replaces the value staged again for the same name in the same scope', () => {
    const staged = stagedVia([
      ['count', TEST_COUNT, ['fn-a']],
      ['count', FN_COUNT, ['fn-a']],
    ])

    expect(staged.size).toBe(1)
    expect(stagedFunctionVariables(staged)).toEqual([
      { function_path: ['fn-a'], variables: { count: { type: 'integer', value: '9' } } },
    ])
  })

  it('reads an empty path as the Test scope', () => {
    const staged = stagedVia([
      ['count', TEST_COUNT],
      ['count', FN_COUNT, []],
    ])

    expect(staged.size).toBe(1)
    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({ count: { type: 'integer', value: '9' } })
    expect(stagedFunctionVariables(staged)).toEqual([])
  })

  it('clear() empties every scope (Reset)', () => {
    const { result } = renderHook(() => useStagedOverrides())
    act(() => result.current.stage('a', TEST_COUNT))
    act(() => result.current.stage('b', FN_COUNT, ['fn-a']))

    act(() => result.current.clear())

    expect(result.current.read().size).toBe(0)
  })
})

describe('mergeStagedIntoRunVariables - the run variables carry Test-scope values only (REQ-3.2.1.6)', () => {
  it('sends a staged Test variable value and leaves a staged Function value out', () => {
    const staged = stagedVia([
      ['count', { value: '42', type: 'integer' }],
      ['tmp', { value: 'x', type: 'string' }, ['fn-a']],
    ])

    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({ count: { type: 'integer', value: '42' } })
  })

  it('leaves a same-named Test variable to its own value when only the Function local is staged', () => {
    const base = { count: { type: 'integer', value: '1' } }
    const staged = stagedVia([['count', { value: '9', type: 'integer' }, ['fn-a']]])

    expect(mergeStagedIntoRunVariables(base, staged)).toEqual({ count: { type: 'integer', value: '1' } })
  })

  it('sends a null Current value staged before a run as null', () => {
    const staged = stagedMap([['note', { value: null, type: 'string' }]])

    expect(mergeStagedIntoRunVariables({}, staged)).toEqual({ note: { type: 'string', value: null } })
  })
})

describe('stagedFunctionVariables - Function values ride the run under their instance path (REQ-3.2.1.6)', () => {
  it('sends a Function local value under the path of its Function instance', () => {
    const staged = stagedVia([['tmp', { value: 5, type: 'integer' }, ['fn-a']]])

    expect(stagedFunctionVariables(staged)).toEqual([
      { function_path: ['fn-a'], variables: { tmp: { type: 'integer', value: 5 } } },
    ])
  })

  it('groups the values of one Function instance into one entry', () => {
    const staged = stagedVia([
      ['who', { value: 'ann', type: 'string' }, ['fn-a']],
      ['tries', { value: 3, type: 'integer' }, ['fn-a']],
    ])

    expect(stagedFunctionVariables(staged)).toEqual([
      {
        function_path: ['fn-a'],
        variables: { who: { type: 'string', value: 'ann' }, tries: { type: 'integer', value: 3 } },
      },
    ])
  })

  it('gives each Function instance its own entry, a nested path in order from the Test canvas inward', () => {
    const staged = stagedVia([
      ['tmp', { value: 1, type: 'integer' }, ['fn-a']],
      ['tmp', { value: 2, type: 'integer' }, ['fn-a', 'fn-b']],
    ])

    const entries = stagedFunctionVariables(staged)

    expect(entries).toHaveLength(2)
    expect(entries).toEqual(
      expect.arrayContaining([
        { function_path: ['fn-a'], variables: { tmp: { type: 'integer', value: 1 } } },
        { function_path: ['fn-a', 'fn-b'], variables: { tmp: { type: 'integer', value: 2 } } },
      ]),
    )
  })

  it('sends no entry when only Test variable values are staged', () => {
    const staged = stagedVia([['count', { value: '1', type: 'integer' }]])

    expect(stagedFunctionVariables(staged)).toEqual([])
  })

  it.each<[string, StagedOverride, Record<string, unknown>]>([
    ['expression', { expression: 'a + 1', type: 'integer' }, { type: 'integer', value: 'a + 1', isExpression: true }],
    ['template', { template: 'Hi {{ who }}', type: 'string' }, { type: 'string', value: 'Hi {{ who }}', isTemplate: true }],
    [
      'map with element types',
      { value: { n: '20' }, type: 'map', elementTypes: { n: 'integer' } },
      { type: 'map', value: { n: '20' }, elementTypes: { n: 'integer' } },
    ],
    ['null value', { value: null, type: 'table' }, { type: 'table', value: null }],
  ])('sends a staged Function %s in the run seed form', (_kind, override, entry) => {
    const staged = stagedVia([['local', override, ['fn-a']]])

    expect(stagedFunctionVariables(staged)).toEqual([{ function_path: ['fn-a'], variables: { local: entry } }])
  })
})

describe('resolveCurrentExpressionSource - override > definition', () => {
  it('prefers the override expression', () => {
    expect(resolveCurrentExpressionSource("'ovr'", "'def'")).toBe("'ovr'")
  })

  it('falls back to the definition when not overridden', () => {
    expect(resolveCurrentExpressionSource(undefined, "'def'")).toBe("'def'")
  })

  it('returns an empty string when nothing resolves to a string', () => {
    expect(resolveCurrentExpressionSource(undefined, 42)).toBe('')
  })
})

describe('withOverrideSource - the variable as the next run reads it', () => {
  const url = { name: 'url', value: "'def/' + host", isExpression: true }

  it('returns the variable itself when nothing is overridden', () => {
    expect(withOverrideSource(url, undefined)).toBe(url)
  })

  it('returns the variable itself for a literal override', () => {
    expect(withOverrideSource(url, { value: 'x', type: 'string' })).toBe(url)
  })

  it('replaces the source with an overridden expression', () => {
    const shown = withOverrideSource(url, { expression: "'ovr/' + host", type: 'string' })

    expect(shown).toEqual({ name: 'url', value: "'ovr/' + host", isExpression: true })
  })

  it('replaces the source with an overridden template', () => {
    const template = { name: 'url', value: 'http://{{ host }}', isTemplate: true }

    const shown = withOverrideSource(template, { template: 'https://{{ host }}', type: 'string' })

    expect(shown).toEqual({ name: 'url', value: 'https://{{ host }}', isTemplate: true })
  })

  it('leaves the definition untouched', () => {
    withOverrideSource(url, { expression: "'ovr/' + host", type: 'string' })

    expect(url.value).toBe("'def/' + host")
  })
})
