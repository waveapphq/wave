/**
 * Workflow Store: the one per-pull cache of every catalog pull (SQL tables, OpenSearch fields), keyed by
 * `kind:stateKey`, kept while the test is open and emptied when it closes.
 *
 * REQ-3.4.1.6, REQ-3.3.2.6, REQ-5.1.2; SQL-12, OS-13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const sqlApi = vi.hoisted(() => ({
  checkSql: vi.fn(),
  startCatalog: vi.fn(),
  getCatalog: vi.fn(),
  cancelCatalog: vi.fn(),
}))

const openSearchApi = vi.hoisted(() => ({
  checkOpenSearch: vi.fn(),
  suggestOpenSearch: vi.fn(),
  startFields: vi.fn(),
  getFields: vi.fn(),
  cancelFields: vi.fn(),
}))

vi.mock('@/features/workbench/api/sql-tools', () => sqlApi)
vi.mock('@/features/workbench/api/opensearch-tools', () => openSearchApi)

import {
  createWorkflowStore,
  useWorkflowStore,
} from '@/features/workbench/stores/workflow-store'
import type { CatalogPullEntry } from '@/features/workbench/stores/workflow-store'
import { SAMPLE_FIELDS, SAMPLE_INDEXES } from '../opensearch-fixtures'
import { CUSTOMERS, ORDERS, SAMPLE_TABLES } from '../sql-fixtures'

const KEY_A = 'sql:{"connection":{"host":"db.lab"}}'
const KEY_B = 'sql:{"connection":{"host":"db2.lab"}}'
const KEY_FIELDS = 'opensearch:{"connection":{"url":"https://opensearch.example:9200"}}'
// The same state key under the other kind: a separate pull.
const KEY_FIELDS_AS_SQL = 'sql:{"connection":{"url":"https://opensearch.example:9200"}}'

const CONNECTING: CatalogPullEntry = { status: 'connecting', jobId: null, data: { tables: [] }, error: null }
const READING: CatalogPullEntry = { status: 'reading', jobId: 'job-a', data: { tables: [] }, error: null }
const LOADED: CatalogPullEntry = {
  status: 'loaded',
  jobId: 'job-a',
  data: { tables: [...SAMPLE_TABLES] },
  error: null,
}
const FAILED: CatalogPullEntry = {
  status: 'failed',
  jobId: 'job-b',
  data: { tables: [] },
  error: 'password authentication failed for user "wave"',
}
const FIELDS_LOADED: CatalogPullEntry = {
  status: 'loaded',
  jobId: 'job-fields',
  data: { indexes: [...SAMPLE_INDEXES], fields: [...SAMPLE_FIELDS] },
  error: null,
}
const FIELDS_READING: CatalogPullEntry = {
  status: 'reading',
  jobId: 'job-fields',
  data: { indexes: [], fields: [] },
  error: null,
}

function pulls(): Map<string, CatalogPullEntry> {
  return useWorkflowStore.getState().catalogPulls
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.getState().clearCatalogPulls()
})

describe('catalogPulls - initial state', () => {
  it('starts as an empty Map on a new store', () => {
    const store = createWorkflowStore({ persistKey: null })

    expect(store.getState().catalogPulls).toBeInstanceOf(Map)
    expect(store.getState().catalogPulls.size).toBe(0)
  })

  it('carries no SQL-only catalog map beside it', () => {
    const state = createWorkflowStore({ persistKey: null }).getState() as unknown as Record<string, unknown>

    expect(state.sqlCatalogs).toBeUndefined()
    expect(state.setSqlCatalog).toBeUndefined()
    expect(state.removeSqlCatalog).toBeUndefined()
    expect(state.clearSqlCatalogs).toBeUndefined()
  })
})

describe('setCatalogPull', () => {
  it('stores an entry under its key', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, CONNECTING)

    expect(pulls().get(KEY_A)).toEqual(CONNECTING)
    expect(pulls().size).toBe(1)
  })

  it('replaces the entry of the same key', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, CONNECTING)
    useWorkflowStore.getState().setCatalogPull(KEY_A, READING)
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)

    expect(pulls().get(KEY_A)).toEqual(LOADED)
    expect(pulls().size).toBe(1)
  })

  it('leaves the entries of other keys untouched', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_B, CONNECTING)
    useWorkflowStore.getState().setCatalogPull(KEY_B, FAILED)

    expect(pulls().get(KEY_A)).toEqual(LOADED)
    expect(pulls().get(KEY_B)).toEqual(FAILED)
    expect(pulls().size).toBe(2)
  })

  it('stores the entry exactly as given, its data untouched', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)

    expect(pulls().get(KEY_A)).toBe(LOADED)
  })

  it('sets a new Map and leaves the previous one as it was', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, CONNECTING)
    const before = pulls()

    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)

    expect(pulls()).not.toBe(before)
    expect(before.get(KEY_A)).toEqual(CONNECTING)
  })

  it('sets a new Map when a key is added', () => {
    const before = pulls()

    useWorkflowStore.getState().setCatalogPull(KEY_B, READING)

    expect(pulls()).not.toBe(before)
    expect(before.has(KEY_B)).toBe(false)
  })
})

describe('setCatalogPull - an opensearch pull', () => {
  it('stores the indexes and fields of a loaded pull under its opensearch key', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)

    expect(pulls().get(KEY_FIELDS)).toEqual({
      status: 'loaded',
      jobId: 'job-fields',
      data: { indexes: SAMPLE_INDEXES, fields: SAMPLE_FIELDS },
      error: null,
    })
  })

  it('keeps an opensearch pull and a sql pull in the same map', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_READING)

    expect(pulls().get(KEY_A)).toEqual(LOADED)
    expect(pulls().get(KEY_FIELDS)).toEqual(FIELDS_READING)
    expect(pulls().size).toBe(2)
  })

  it('keeps two kinds apart when their state keys are the same', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)

    expect(pulls().has(KEY_FIELDS_AS_SQL)).toBe(false)

    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS_AS_SQL, CONNECTING)

    expect(pulls().get(KEY_FIELDS)).toEqual(FIELDS_LOADED)
    expect(pulls().get(KEY_FIELDS_AS_SQL)).toEqual(CONNECTING)
  })
})

describe('removeCatalogPull', () => {
  it('removes the entry of one key and leaves the others', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_B, READING)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_READING)

    useWorkflowStore.getState().removeCatalogPull(KEY_B)

    expect(pulls().has(KEY_B)).toBe(false)
    expect(pulls().get(KEY_A)).toEqual(LOADED)
    expect(pulls().get(KEY_FIELDS)).toEqual(FIELDS_READING)
    expect(pulls().size).toBe(2)
  })

  it('removes an opensearch pull and leaves the sql pulls', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_READING)

    useWorkflowStore.getState().removeCatalogPull(KEY_FIELDS)

    expect(pulls().has(KEY_FIELDS)).toBe(false)
    expect(pulls().get(KEY_A)).toEqual(LOADED)
  })

  it('sets a new Map and leaves the previous one as it was', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, READING)
    const before = pulls()

    useWorkflowStore.getState().removeCatalogPull(KEY_A)

    expect(pulls()).not.toBe(before)
    expect(before.get(KEY_A)).toEqual(READING)
  })

  it('leaves every entry in place when the key holds none', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)

    useWorkflowStore.getState().removeCatalogPull(KEY_B)

    expect(pulls().get(KEY_A)).toEqual(LOADED)
    expect(pulls().size).toBe(1)
  })
})

describe('clearCatalogPulls', () => {
  it('removes every entry of every kind', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_B, CONNECTING)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)

    useWorkflowStore.getState().clearCatalogPulls()

    expect(pulls()).toBeInstanceOf(Map)
    expect(pulls().size).toBe(0)
  })

  it('sets a new Map', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    const before = pulls()

    useWorkflowStore.getState().clearCatalogPulls()

    expect(pulls()).not.toBe(before)
    expect(before.get(KEY_A)).toEqual(LOADED)
  })
})

describe('reset', () => {
  it('empties the catalog cache of every kind, so the lists go when the test closes (OS-13)', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().setCatalogPull(KEY_B, READING)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)

    useWorkflowStore.getState().reset()

    expect(pulls()).toBeInstanceOf(Map)
    expect(pulls().size).toBe(0)
  })
})

describe('catalogPulls - selectors', () => {
  it('re-renders a component that selects one entry when it changes', () => {
    const { result } = renderHook(() =>
      useWorkflowStore((state) => state.catalogPulls.get(KEY_A)?.status ?? 'none')
    )
    expect(result.current).toBe('none')

    act(() => {
      useWorkflowStore.getState().setCatalogPull(KEY_A, CONNECTING)
    })
    expect(result.current).toBe('connecting')

    act(() => {
      useWorkflowStore.getState().setCatalogPull(KEY_A, {
        status: 'loaded',
        jobId: 'job-a',
        data: { tables: [ORDERS, CUSTOMERS] },
        error: null,
      })
    })
    expect(result.current).toBe('loaded')

    act(() => {
      useWorkflowStore.getState().removeCatalogPull(KEY_A)
    })
    expect(result.current).toBe('none')
  })

  it('re-renders a component that selects an opensearch entry when it changes', () => {
    const { result } = renderHook(() =>
      useWorkflowStore((state) => state.catalogPulls.get(KEY_FIELDS)?.status ?? 'none')
    )

    act(() => {
      useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_READING)
    })
    expect(result.current).toBe('reading')

    act(() => {
      useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)
    })
    expect(result.current).toBe('loaded')
  })

  it('keeps the stores of two workbench instances apart', () => {
    const other = createWorkflowStore({ persistKey: null })

    other.getState().setCatalogPull(KEY_A, LOADED)

    expect(other.getState().catalogPulls.get(KEY_A)).toEqual(LOADED)
    expect(pulls().has(KEY_A)).toBe(false)
  })
})

describe('catalogPulls - no API', () => {
  it('never calls the SQL tools or the OpenSearch tools API', () => {
    useWorkflowStore.getState().setCatalogPull(KEY_A, CONNECTING)
    useWorkflowStore.getState().setCatalogPull(KEY_A, LOADED)
    useWorkflowStore.getState().removeCatalogPull(KEY_A)
    useWorkflowStore.getState().setCatalogPull(KEY_B, READING)
    useWorkflowStore.getState().setCatalogPull(KEY_FIELDS, FIELDS_LOADED)
    useWorkflowStore.getState().clearCatalogPulls()
    useWorkflowStore.getState().setCatalogPull(KEY_A, FAILED)
    useWorkflowStore.getState().reset()

    for (const call of [...Object.values(sqlApi), ...Object.values(openSearchApi)]) {
      expect(call).not.toHaveBeenCalled()
    }
  })
})
