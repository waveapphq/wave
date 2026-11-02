import { describe, it, expect } from 'vitest'
import {
  convertBackendVariables,
  convertSystemVariables,
  convertSuiteVariables,
  mergeSuiteNamespaceEntries,
  createNamespaceDottedEntries,
} from '@/features/workbench/live/variable-helpers'
import { buildVariablesPayload } from '@/features/workbench/live/save-utils'

describe('convertBackendVariables - element types (REQ-3.1.3.19)', () => {
  it('carries a stored element-type sidecar and ignores a malformed one', () => {
    const [typed, malformed] = convertBackendVariables({
      m: { type: 'map', value: { n: '16' }, elementTypes: { n: 'integer' } },
      a: { type: 'array', value: ['1'], elementTypes: ['number'] },
    })
    expect(typed.elementTypes).toEqual({ n: 'integer' })
    expect(malformed).not.toHaveProperty('elementTypes')
  })
})

describe('convertBackendVariables', () => {
  it('converts a single variable', () => {
    const result = convertBackendVariables({
      count: { type: 'integer', value: 10 },
    })

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('count')
    expect(result[0].value).toBe(10)
    expect(result[0].type).toBe('integer')
    expect(result[0].id).toMatch(/^var-count-\d+-[a-z0-9]{7}$/)
  })

  it('converts multiple variables', () => {
    const result = convertBackendVariables({
      host: { type: 'string', value: 'localhost' },
      port: { type: 'integer', value: 8080 },
      config: { type: 'map', value: { key: 'val' } },
    })

    expect(result).toHaveLength(3)
    const names = result.map((v) => v.name)
    expect(names).toContain('host')
    expect(names).toContain('port')
    expect(names).toContain('config')

    const portVar = result.find((v) => v.name === 'port')!
    expect(portVar.type).toBe('integer')
    expect(portVar.value).toBe(8080)

    const configVar = result.find((v) => v.name === 'config')!
    expect(configVar.type).toBe('map')
  })

  it('sets isExpression when flag is true', () => {
    const result = convertBackendVariables({
      expr: { type: 'string', value: 'a + b', isExpression: true },
    })

    expect(result[0].isExpression).toBe(true)
  })

  it('does not set isExpression when flag is false', () => {
    const result = convertBackendVariables({
      plain: { type: 'string', value: 'hello', isExpression: false },
    })

    expect(result[0].isExpression).toBeUndefined()
  })

  it('does not set isExpression when flag is absent', () => {
    const result = convertBackendVariables({
      plain: { type: 'string', value: 'hello' },
    })

    expect(result[0].isExpression).toBeUndefined()
  })

  it('sets isTemplate when the flag is true', () => {
    const result = convertBackendVariables({
      greeting: { type: 'string', value: 'Hi {{user}}', isTemplate: true },
    })

    expect(result[0].isTemplate).toBe(true)
  })

  it('does not set isTemplate when the flag is absent', () => {
    const result = convertBackendVariables({
      plain: { type: 'string', value: 'hello' },
    })

    expect(result[0].isTemplate).toBeUndefined()
  })

  it('translates the backend "secret" flag to isSecret on the frontend variable', () => {
    const result = convertBackendVariables({
      apiKey: { type: 'string', value: '********', secret: true },
    })

    expect(result[0].isSecret).toBe(true)
  })

  it('does not set isSecret when secret flag is false or absent', () => {
    const result = convertBackendVariables({
      plain: { type: 'string', value: 'hello' },
      explicit: { type: 'string', value: 'world', secret: false },
    })

    expect(result.find((v) => v.name === 'plain')!.isSecret).toBeUndefined()
    expect(result.find((v) => v.name === 'explicit')!.isSecret).toBeUndefined()
  })

  it('returns empty array for empty input', () => {
    const result = convertBackendVariables({})
    expect(result).toEqual([])
  })

  it('generates unique IDs for each variable', () => {
    const result = convertBackendVariables({
      a: { type: 'string', value: '1' },
      b: { type: 'string', value: '2' },
    })

    expect(result[0].id).not.toBe(result[1].id)
  })

  it('carries no value key for a declaration that has none', () => {
    const result = convertBackendVariables({
      k8s_session: { type: 'string' } as never,
    })

    expect('value' in result[0]).toBe(false)
  })

  it('keeps a stored empty string as a value', () => {
    const result = convertBackendVariables({
      blank: { type: 'string', value: '' },
    })

    expect('value' in result[0]).toBe(true)
    expect(result[0].value).toBe('')
  })

  it('round-trips an unset declaration back to the save payload', () => {
    const declaration = { k8s_session: { type: 'string', secret: true } } as never
    const payload = buildVariablesPayload(convertBackendVariables(declaration))

    expect(payload).toEqual({ k8s_session: { type: 'string', secret: true } })
  })
})

describe('convertSystemVariables', () => {
  it('converts system variables to NamespaceEntry format', () => {
    const result = convertSystemVariables(
      { API_URL: { type: 'string', value: 'https://api.example.com' } },
    )

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('API_URL')
    expect(result[0].type).toBe('string')
  })

  it('keeps the stored type', () => {
    const result = convertSystemVariables(
      { FLAG: { type: 'boolean', value: true } },
    )

    expect(result[0].type).toBe('boolean')
  })

  it('returns empty array for empty input', () => {
    const result = convertSystemVariables({})
    expect(result).toEqual([])
  })

  it('converts multiple system variables', () => {
    const result = convertSystemVariables(
      {
        URL: { type: 'string', value: 'http://localhost' },
        RETRIES: { type: 'integer', value: 3 },
        DEBUG: { type: 'boolean', value: false },
      },
    )

    expect(result).toHaveLength(3)
    const retries = result.find((v) => v.name === 'RETRIES')!
    expect(retries.type).toBe('integer')
  })
})

describe('createNamespaceDottedEntries', () => {
  it('creates dotted entries for system-scope variables', () => {
    const vars = [
      { name: 'api_host', type: 'string' as const },
      { name: 'timeout', type: 'integer' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'system')

    // Should have 1 top-level entry + 2 dotted entries
    expect(dotted).toHaveLength(3)

    // Top-level "system" object
    const topLevel = dotted.find((v) => v.name === 'system')!
    expect(topLevel).toBeDefined()
    expect(topLevel.type).toBe('object')

    expect(topLevel.source).toBe('System Variables')

    // Dotted entries
    const dottedHost = dotted.find((v) => v.name === 'system.api_host')!
    expect(dottedHost).toBeDefined()
    expect(dottedHost.type).toBe('string')

    expect(dottedHost.source).toBe('System Variables')

    const dottedTimeout = dotted.find((v) => v.name === 'system.timeout')!
    expect(dottedTimeout).toBeDefined()
    expect(dottedTimeout.type).toBe('integer')
    expect(dottedTimeout.source).toBe('System Variables')
  })

  it('returns empty array for empty input', () => {
    const dotted = createNamespaceDottedEntries([], 'system')
    expect(dotted).toEqual([])
  })

  it('creates dotted entries for suite namespace', () => {
    const vars = [
      { name: 'base_url', type: 'string' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'suite', 'Auth Suite')

    const topLevel = dotted.find((v) => v.name === 'suite')!
    expect(topLevel.source).toBe('Suite')

    const dottedEntry = dotted.find((v) => v.name === 'suite.base_url')!
    expect(dottedEntry.source).toBe('Suite')
    expect(dottedEntry.type).toBe('string')
  })

  it('creates dotted entries for regression namespace', () => {
    const vars = [
      { name: 'run_id', type: 'string' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'regression', 'Nightly')

    const topLevel = dotted.find((v) => v.name === 'regression')!
    expect(topLevel.source).toBe('Regression: Nightly')

    const dottedEntry = dotted.find((v) => v.name === 'regression.run_id')!
    expect(dottedEntry.source).toBe('Regression: Nightly')
  })

  it('uses Suite label regardless of displayName', () => {
    const vars = [{ name: 'base_url', type: 'string' as const }]

    const dotted = createNamespaceDottedEntries(vars, 'suite')

    const topLevel = dotted.find((v) => v.name === 'suite')!
    expect(topLevel.source).toBe('Suite')
  })

  it('uses plain Regression label when displayName not provided', () => {
    const vars = [{ name: 'run_id', type: 'string' as const }]

    const dotted = createNamespaceDottedEntries(vars, 'regression')

    const topLevel = dotted.find((v) => v.name === 'regression')!
    expect(topLevel.source).toBe('Regression')
  })

  it('does not duplicate top-level entry when called multiple times', () => {
    const vars = [
      { name: 'host', type: 'string' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'system')
    const topLevels = dotted.filter((v) => v.name === 'system')
    expect(topLevels).toHaveLength(1)
  })

  it('uses Suite label for all suite entries regardless of sources', () => {
    const vars = [
      { name: 'base_url', type: 'string', sources: ['Auth Suite', 'API Suite'] },
      { name: 'timeout', type: 'integer', sources: ['Auth Suite'] },
      { name: 'host', type: 'string' },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'suite')

    expect(dotted.find((v) => v.name === 'suite.base_url')!.source).toBe('Suite')
    expect(dotted.find((v) => v.name === 'suite.timeout')!.source).toBe('Suite')
    expect(dotted.find((v) => v.name === 'suite.host')!.source).toBe('Suite')
  })

  it('uses System Variables label for system namespace even with sources', () => {
    const vars = [
      { name: 'host', type: 'string', sources: ['System'] },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'system')

    const dottedHost = dotted.find((v) => v.name === 'system.host')!
    expect(dottedHost.source).toBe('System Variables')
  })

  it('emits the bare root first, then the dotted entries in input order', () => {
    const vars = [
      { name: 'api_host', type: 'string' as const },
      { name: 'timeout', type: 'integer' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'system')

    expect(dotted.map((v) => v.name)).toEqual(['system', 'system.api_host', 'system.timeout'])
  })

  it('marks the bare root entry with isNamespaceRoot', () => {
    const vars = [{ name: 'timeout', type: 'integer' as const }]

    const dotted = createNamespaceDottedEntries(vars, 'system')

    expect(dotted.find((v) => v.name === 'system')!.isNamespaceRoot).toBe(true)
  })

  it('marks the bare root for the suite and regression namespaces too', () => {
    const suiteDotted = createNamespaceDottedEntries(
      [{ name: 'base_url', type: 'string' as const }],
      'suite',
    )
    const regressionDotted = createNamespaceDottedEntries(
      [{ name: 'run_id', type: 'string' as const }],
      'regression',
      'Nightly',
    )

    expect(suiteDotted.find((v) => v.name === 'suite')!.isNamespaceRoot).toBe(true)
    expect(regressionDotted.find((v) => v.name === 'regression')!.isNamespaceRoot).toBe(true)
  })

  it('omits the isNamespaceRoot key entirely from every dotted entry', () => {
    const vars = [
      { name: 'api_host', type: 'string' as const },
      { name: 'timeout', type: 'integer' as const },
    ]

    const dotted = createNamespaceDottedEntries(vars, 'system')

    for (const entry of dotted.filter((v) => v.name !== 'system')) {
      expect(entry).not.toHaveProperty('isNamespaceRoot')
    }
  })

  it('keeps the source label on the marked root unchanged', () => {
    const dotted = createNamespaceDottedEntries(
      [{ name: 'run_id', type: 'string' as const }],
      'regression',
      'Nightly',
    )

    const root = dotted.find((v) => v.name === 'regression')!
    expect(root.type).toBe('object')
    expect(root.source).toBe('Regression: Nightly')
    expect(root.isNamespaceRoot).toBe(true)
  })
})

describe('convertSuiteVariables', () => {
  it('converts suite variables to NamespaceEntry format', () => {
    const result = convertSuiteVariables(
      { BASE_URL: { type: 'string', value: 'https://api.example.com' } },
    )

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('BASE_URL')
    expect(result[0].type).toBe('string')
  })

  it('keeps the stored type', () => {
    const result = convertSuiteVariables(
      { FLAG: { type: 'boolean', value: true } },
    )

    expect(result[0].type).toBe('boolean')
  })

  it('returns empty array for empty input', () => {
    const result = convertSuiteVariables({})
    expect(result).toEqual([])
  })

  it('converts multiple suite variables', () => {
    const result = convertSuiteVariables(
      {
        URL: { type: 'string', value: 'http://localhost' },
        RETRIES: { type: 'integer', value: 3 },
        DEBUG: { type: 'boolean', value: false },
      },
    )

    expect(result).toHaveLength(3)
    const retries = result.find((v) => v.name === 'RETRIES')!
    expect(retries.type).toBe('integer')
  })
})

describe('mergeSuiteNamespaceEntries', () => {
  it('returns empty array for empty input', () => {
    const result = mergeSuiteNamespaceEntries([])
    expect(result).toEqual([])
  })

  it('returns entries from a single suite', () => {
    const result = mergeSuiteNamespaceEntries([
      {
        suiteId: 's1',
        suiteName: 'Auth Suite',
        entries: [
          { name: 'base_url', type: 'string' },
          { name: 'timeout', type: 'integer' },
        ],
      },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: 'base_url', type: 'string', sources: ['Auth Suite'] })
    expect(result[1]).toEqual({ name: 'timeout', type: 'integer', sources: ['Auth Suite'] })
  })

  it('merges same variable name+type from multiple suites', () => {
    const result = mergeSuiteNamespaceEntries([
      {
        suiteId: 's1',
        suiteName: 'Auth Suite',
        entries: [{ name: 'base_url', type: 'string' }],
      },
      {
        suiteId: 's2',
        suiteName: 'API Suite',
        entries: [{ name: 'base_url', type: 'string' }],
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'base_url',
      type: 'string',
      sources: ['Auth Suite', 'API Suite'],
    })
  })

  it('keeps separate entries for same name but different type', () => {
    const result = mergeSuiteNamespaceEntries([
      {
        suiteId: 's1',
        suiteName: 'Suite A',
        entries: [{ name: 'timeout', type: 'string' }],
      },
      {
        suiteId: 's2',
        suiteName: 'Suite B',
        entries: [{ name: 'timeout', type: 'integer' }],
      },
    ])

    expect(result).toHaveLength(2)
    const stringEntry = result.find((e) => e.type === 'string')!
    expect(stringEntry.sources).toEqual(['Suite A'])
    const intEntry = result.find((e) => e.type === 'integer')!
    expect(intEntry.sources).toEqual(['Suite B'])
  })

  it('does not duplicate suite name when same suite appears twice', () => {
    const result = mergeSuiteNamespaceEntries([
      {
        suiteId: 's1',
        suiteName: 'Auth Suite',
        entries: [{ name: 'base_url', type: 'string' }],
      },
      {
        suiteId: 's1',
        suiteName: 'Auth Suite',
        entries: [{ name: 'base_url', type: 'string' }],
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].sources).toEqual(['Auth Suite'])
  })
})
