/**
 * The generic catalog request every Get Tables / Get fields pull sends, and its cache keys: the connection rows
 * the adapter names, filtered expression / template fields and element types, the profile bindings, and a key
 * that never depends on key order, the locale, or a sealed secret's ciphertext.
 *
 * REQ-3.3.2.6, REQ-5.1.2, REQ-5.1.4; SQL-12, OS-13
 */

import { describe, it, expect, vi } from 'vitest'

import {
  byCodeUnits,
  catalogKey,
  catalogRequestOf,
  catalogStateKey,
  sortedDeep,
  type CatalogProfileBinding,
} from '@/features/workbench/lib/catalog-request'

// ============================================
// A catalog adapter: its connection rows and extractor
// ============================================

interface DemoConnection {
  url: unknown
  username: unknown
  password: unknown
  options: unknown
}

const DEMO_ROWS: ReadonlySet<string> = new Set(['url', 'username', 'password', 'options'])

function demoConnectionOf(values: Record<string, unknown>): DemoConnection {
  return {
    url: values.url ?? null,
    username: values.username ?? null,
    password: values.password ?? null,
    options: values.options ?? {},
  }
}

const REQUEST_KEYS = [
  'connection',
  'element_types',
  'environment_id',
  'expression_fields',
  'profile_bindings',
  'template_fields',
  'test_id',
]

const SEALED_PASSWORD = 'wave:enc:v1:c2VhbGVkLXBhc3N3b3Jk'

const LOGS_BINDING: CatalogProfileBinding = {
  profileId: 'profile-logs',
  alias: 'logs',
  profileName: 'Logs cluster',
  profileType: 'opensearch',
}

/** A block's values: its connection rows and rows the pull never sends. */
const BLOCK_VALUES: Record<string, unknown> = {
  url: 'https://catalog.lab:9200',
  username: 'wave',
  password: 'secret-pw',
  options: {},
  query: 'status: 500',
  size: 100,
  timeout: 30,
}

const BLOCK_CONNECTION: DemoConnection = {
  url: 'https://catalog.lab:9200',
  username: 'wave',
  password: 'secret-pw',
  options: {},
}

const BASE_REQUEST = {
  connection: BLOCK_CONNECTION,
  expression_fields: [] as string[],
  template_fields: [] as string[],
  element_types: {},
  profile_bindings: [] as CatalogProfileBinding[],
  environment_id: 'env-lab' as string | null,
  test_id: 'test-logs' as string | null,
}

type DemoRequest = typeof BASE_REQUEST

function build(input: Partial<Parameters<typeof catalogRequestOf>[0]> = {}) {
  return catalogRequestOf(
    {
      values: BLOCK_VALUES,
      expressionFields: [],
      templateFields: [],
      profileBindings: [],
      environmentId: 'env-lab',
      testId: 'test-logs',
      ...input,
    },
    DEMO_ROWS,
    demoConnectionOf,
  )
}

function withConnection(connection: Partial<DemoConnection>): DemoRequest {
  return { ...BASE_REQUEST, connection: { ...BLOCK_CONNECTION, ...connection } }
}

/** Every object in the parsed key lists its keys in sorted order, at every depth. */
function expectSortedKeysDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectSortedKeysDeep(item)
    return
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    expect(keys).toEqual([...keys].sort())
    for (const key of keys) expectSortedKeysDeep((value as Record<string, unknown>)[key])
  }
}

/** The same object with its own keys in reverse order, at every depth. */
function reverseKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => reverseKeysDeep(item)) as T
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse()
    return Object.fromEntries(entries.map(([key, item]) => [key, reverseKeysDeep(item)])) as T
  }
  return value
}

// ============================================
// catalogRequestOf
// ============================================

describe('catalogRequestOf', () => {
  it('wraps the connection rows with the pull context', () => {
    expect(build()).toEqual(BASE_REQUEST)
  })

  it('holds exactly the seven request fields and never refresh', () => {
    expect(Object.keys(build()).sort()).toEqual(REQUEST_KEYS)
  })

  it('builds the connection with the extractor it is given, from the block values', () => {
    const connectionOf = vi.fn(demoConnectionOf)

    const request = catalogRequestOf(
      { values: BLOCK_VALUES, expressionFields: [], templateFields: [], profileBindings: [] },
      DEMO_ROWS,
      connectionOf,
    )

    expect(connectionOf).toHaveBeenCalledTimes(1)
    expect(connectionOf).toHaveBeenCalledWith(BLOCK_VALUES)
    expect(request.connection).toEqual(BLOCK_CONNECTION)
  })

  it('keeps only the connection rows among the expression fields, in their given order', () => {
    const request = build({ expressionFields: ['query', 'password', 'size', 'url', 'timeout', 'options'] })

    expect(request.expression_fields).toEqual(['password', 'url', 'options'])
  })

  it('keeps an entry expression of a connection row beside the rows', () => {
    const request = build({ expressionFields: ['url', 'options.header', 'query.term'] })

    expect(request.expression_fields).toEqual(['url', 'options.header'])
  })

  it('keeps only the connection rows among the template fields, in their given order', () => {
    const request = build({ templateFields: ['query', 'username', 'size', 'url'] })

    expect(request.template_fields).toEqual(['username', 'url'])
  })

  it("carries only the connection rows' element types (REQ-3.1.3.19)", () => {
    const request = build({
      elementTypes: {
        options: { retries: 'integer', header: 'string' },
        query: ['string'],
      },
    })

    expect(request.element_types).toEqual({ options: { retries: 'integer', header: 'string' } })
  })

  it('sends no element types when the block has none', () => {
    expect(build({ elementTypes: undefined }).element_types).toEqual({})
  })

  it('carries the block profile bindings in their given order', () => {
    const other: CatalogProfileBinding = {
      profileId: 'profile-metrics',
      alias: 'metrics',
      profileName: 'Metrics cluster',
      profileType: 'opensearch',
    }

    expect(build({ profileBindings: [LOGS_BINDING, other] }).profile_bindings).toEqual([
      LOGS_BINDING,
      other,
    ])
  })

  it('carries only the four fields of a binding', () => {
    const stored = { ...LOGS_BINDING, color: 'blue', sortOrder: 3 } as CatalogProfileBinding

    expect(build({ profileBindings: [stored] }).profile_bindings).toEqual([LOGS_BINDING])
  })

  it('carries the Environment and the test', () => {
    const request = build({ environmentId: 'env-staging', testId: 'test-billing' })

    expect(request.environment_id).toBe('env-staging')
    expect(request.test_id).toBe('test-billing')
  })

  it('sends null for an Environment and a test that are absent', () => {
    const request = catalogRequestOf(
      { values: BLOCK_VALUES, expressionFields: [], templateFields: [], profileBindings: [] },
      DEMO_ROWS,
      demoConnectionOf,
    )

    expect(request.environment_id).toBeNull()
    expect(request.test_id).toBeNull()
  })

  it('sends null for an Environment and a test given as null', () => {
    const request = build({ environmentId: null, testId: null })

    expect(request.environment_id).toBeNull()
    expect(request.test_id).toBeNull()
  })

  it('does not change the input it reads', () => {
    const input = {
      values: { ...BLOCK_VALUES },
      expressionFields: ['query', 'url'],
      templateFields: ['username'],
      profileBindings: [{ ...LOGS_BINDING }],
      elementTypes: { options: { retries: 'integer' as const } },
    }
    const before = JSON.stringify(input)

    catalogRequestOf(input, DEMO_ROWS, demoConnectionOf)

    expect(JSON.stringify(input)).toBe(before)
  })
})

// ============================================
// byCodeUnits and sortedDeep
// ============================================

describe('byCodeUnits', () => {
  it('orders strings by UTF-16 code unit, as a bare sort() does, never by the locale', () => {
    expect(['é', 'a', '_', 'Z', 'B', 'aa'].sort(byCodeUnits)).toEqual(['B', 'Z', '_', 'a', 'aa', 'é'])
  })

  it('answers negative, zero and positive', () => {
    expect(byCodeUnits('a', 'b')).toBeLessThan(0)
    expect(byCodeUnits('b', 'b')).toBe(0)
    expect(byCodeUnits('b', 'a')).toBeGreaterThan(0)
  })
})

describe('sortedDeep', () => {
  it('sorts the keys of every object, at every depth', () => {
    const sorted = sortedDeep({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } })

    expect(JSON.stringify(sorted)).toBe('{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}')
  })

  it('keeps the order of array items', () => {
    expect(sortedDeep(['b', 'a', { d: 1, c: 2 }])).toEqual(['b', 'a', { c: 2, d: 1 }])
  })

  it('leaves strings, numbers, booleans and null as they are', () => {
    expect(sortedDeep('text')).toBe('text')
    expect(sortedDeep(5)).toBe(5)
    expect(sortedDeep(false)).toBe(false)
    expect(sortedDeep(null)).toBeNull()
  })

  it('orders keys by UTF-16 code unit', () => {
    const sorted = sortedDeep({ é: 1, a: 2, _: 3, Z: 4, B: 5, aa: 6 }) as Record<string, number>

    expect(Object.keys(sorted)).toEqual(['B', 'Z', '_', 'a', 'aa', 'é'])
  })

  it('does not change the value it reads', () => {
    const value = { b: [{ d: 1, c: 2 }], a: 1 }
    const before = JSON.stringify(value)

    sortedDeep(value)

    expect(JSON.stringify(value)).toBe(before)
  })
})

// ============================================
// catalogKey
// ============================================

describe('catalogKey', () => {
  it('is a string', () => {
    expect(typeof catalogKey(BASE_REQUEST)).toBe('string')
  })

  it('is the JSON of the whole request', () => {
    const request: DemoRequest = {
      connection: { ...BLOCK_CONNECTION, url: '{{ cluster_url }}', password: SEALED_PASSWORD },
      expression_fields: ['url'],
      template_fields: ['username'],
      element_types: { options: { retries: 'integer' } },
      profile_bindings: [LOGS_BINDING],
      environment_id: 'env-staging',
      test_id: 'test-logs',
    }

    expect(JSON.parse(catalogKey(request))).toEqual(request)
  })

  it('lists object keys in sorted order at every depth', () => {
    const request = {
      test_id: 'test-logs',
      profile_bindings: [
        { profileType: 'opensearch', profileName: 'Logs cluster', alias: 'logs', profileId: 'p-1' },
      ],
      environment_id: 'env-lab',
      template_fields: [],
      expression_fields: [],
      element_types: {},
      connection: reverseKeysDeep({ ...BLOCK_CONNECTION, options: { tls: 'on', retries: 2, agent: 'wave' } }),
    }

    expectSortedKeysDeep(JSON.parse(catalogKey(request)))
  })

  it('orders keys by UTF-16 code unit, never by the locale', () => {
    const request = withConnection({ options: { é: 1, a: 2, _: 3, Z: 4, B: 5, aa: 6 } })

    const key = JSON.parse(catalogKey(request)) as DemoRequest
    expect(Object.keys(key.connection.options as Record<string, unknown>)).toEqual([
      'B',
      'Z',
      '_',
      'a',
      'aa',
      'é',
    ])
  })

  it('is equal for equal requests whatever the key order, nested options included', () => {
    const request: DemoRequest = {
      ...withConnection({ options: { tls: 'on', retries: 2, agent: 'wave' } }),
      profile_bindings: [LOGS_BINDING],
    }

    expect(catalogKey(reverseKeysDeep(request))).toBe(catalogKey(request))
  })

  it('is equal for two separately built requests describing the same pull', () => {
    expect(catalogKey(build({ values: { ...BLOCK_VALUES } }))).toBe(
      catalogKey(build({ values: { ...BLOCK_VALUES } })),
    )
  })

  it.each<[string, Partial<DemoConnection>]>([
    ['url', { url: 'https://other.lab:9200' }],
    ['username', { username: 'reporter' }],
    ['password', { password: 'other-pw' }],
    ['options', { options: { retries: 2 } }],
  ])('changes when the %s row changes', (_row, change) => {
    expect(catalogKey(withConnection(change))).not.toBe(catalogKey(BASE_REQUEST))
  })

  it.each<[string, Partial<DemoRequest>]>([
    ['a row turns into an expression', { expression_fields: ['url'] }],
    ['a row turns into a template', { template_fields: ['username'] }],
    ['a row gains an element type', { element_types: { options: { retries: 'integer' } } }],
    ['a profile is bound', { profile_bindings: [LOGS_BINDING] }],
    ['the Environment changes', { environment_id: 'env-staging' }],
    ['no Environment is picked', { environment_id: null }],
    ['the test changes', { test_id: 'test-billing' }],
  ])('changes when %s', (_label, change) => {
    expect(catalogKey({ ...BASE_REQUEST, ...change })).not.toBe(catalogKey(BASE_REQUEST))
  })

  it('does not change the request it reads', () => {
    const request = reverseKeysDeep(BASE_REQUEST)
    const before = JSON.stringify(request)

    catalogKey(request)

    expect(JSON.stringify(request)).toBe(before)
  })
})

// ============================================
// catalogStateKey
// ============================================

describe('catalogStateKey', () => {
  /** Two blocks' requests built from identical rows, each secret sealed on its own. */
  const blockRequest = (password: unknown, username: unknown = 'wave') =>
    build({ values: { ...BLOCK_VALUES, password, username }, profileBindings: [LOGS_BINDING] })

  it('is equal for two blocks whose identical rows hold a secret sealed apart', () => {
    const first = blockRequest('wave:enc:v1:Zmlyc3Qtbm9uY2U=')
    const second = blockRequest('wave:enc:v1:c2Vjb25kLW5vbmNl')

    expect(catalogKey(second)).not.toBe(catalogKey(first))
    expect(catalogStateKey(second)).toBe(catalogStateKey(first))
  })

  it('normalizes every sealed connection row, whatever its name', () => {
    const first = blockRequest(SEALED_PASSWORD, 'wave:enc:v1:dXNlci1vbmU=')
    const second = blockRequest(SEALED_PASSWORD, 'wave:enc:v1:dXNlci10d28=')

    expect(catalogStateKey(second)).toBe(catalogStateKey(first))
  })

  it('is the request key for a request that holds no sealed value', () => {
    expect(catalogStateKey(BASE_REQUEST)).toBe(catalogKey(BASE_REQUEST))
  })

  it('keeps a typed secret apart from a sealed one', () => {
    expect(catalogStateKey(blockRequest('secret-pw'))).not.toBe(
      catalogStateKey(blockRequest(SEALED_PASSWORD)),
    )
  })

  it('keeps two typed secrets apart', () => {
    expect(catalogStateKey(blockRequest('secret-pw'))).not.toBe(catalogStateKey(blockRequest('other-pw')))
  })

  it('changes when any other row changes beside a sealed secret', () => {
    const other = build({
      values: { ...BLOCK_VALUES, url: 'https://other.lab:9200', password: SEALED_PASSWORD },
      profileBindings: [LOGS_BINDING],
    })

    expect(catalogStateKey(other)).not.toBe(catalogStateKey(blockRequest(SEALED_PASSWORD)))
  })

  it('is equal whatever the key order', () => {
    const request = blockRequest(SEALED_PASSWORD)

    expect(catalogStateKey(reverseKeysDeep(request))).toBe(catalogStateKey(request))
  })

  it('does not change the request it reads', () => {
    const request = blockRequest(SEALED_PASSWORD)
    const before = JSON.stringify(request)

    catalogStateKey(request)

    expect(JSON.stringify(request)).toBe(before)
  })
})
