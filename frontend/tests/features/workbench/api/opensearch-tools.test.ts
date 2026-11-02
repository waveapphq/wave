/**
 * OpenSearch tools API client: the wire shapes of the check, suggest and Get fields calls.
 *
 * REQ-3.3.2.6, REQ-3.3.2.5, REQ-5.1.2; OS-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { apiClient } from '@/lib/api'
import {
  cancelFields,
  checkOpenSearch,
  getFields,
  startFields,
  suggestOpenSearch,
} from '@/features/workbench/api/opensearch-tools'
import type {
  OpenSearchCheckIssue,
  OpenSearchFieldsRequest,
  OpenSearchSuggestions,
} from '@/features/workbench/api/opensearch-tools'
import {
  SAMPLE_DQL,
  SAMPLE_FIELDS,
  SAMPLE_FIELDS_REQUEST,
  SAMPLE_INDEXES,
  SAMPLE_OS_CONNECTION,
  SAMPLE_QUERY_DSL,
} from '../opensearch-fixtures'

const JOB_ID = '9b1e7c4a2f6d48e0a5c3b8d7e6f1a204'

/** As the check endpoint answers them: line and column 1-based, positions in characters. */
const CHECK_ISSUES: OpenSearchCheckIssue[] = [
  { line: 1, col: 1, length: 11, message: 'Unknown field log.invalid in filebeat-*' },
  { line: 2, col: 5, length: 1, message: 'Expected "(", value, whitespace but end of input found.' },
]

const SUGGESTIONS: OpenSearchSuggestions = {
  from: 4,
  to: 12,
  items: [
    { label: 'service.name', kind: 'field', detail: 'keyword', info: '' },
    { label: 'service.version', kind: 'field', detail: 'keyword', info: '' },
  ],
}

const DQL_CHECK = {
  language: 'dql' as const,
  text: SAMPLE_DQL,
  template: true,
  fields_job_id: JOB_ID,
  index: 'filebeat-*',
}

const DQL_SUGGEST = {
  language: 'dql' as const,
  text: 'and service.',
  cursor: 12,
  template: false,
  fields_job_id: JOB_ID,
}

function ok<T>(data: T, requestId: string) {
  return { data, meta: { requestId }, status: 200 }
}

function clientError(message: string, status: number): Error {
  return Object.assign(new Error(message), {
    type: 'client',
    status,
    isRetryable: false,
  })
}

function networkError(): Error {
  return Object.assign(new Error('Network request failed'), {
    type: 'network',
    isRetryable: true,
  })
}

function abortError(): Error {
  return Object.assign(new Error('Request aborted'), { name: 'AbortError' })
}

describe('opensearch-tools API client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // checkOpenSearch
  // ==========================================================================

  describe('checkOpenSearch', () => {
    it('POSTs the language, text, kind, fields job and index to the check endpoint with the abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ issues: [] }, 'req-check'))

      const controller = new AbortController()
      await checkOpenSearch(DQL_CHECK, controller.signal)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      const [path, body, config] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/check')
      expect(body).toEqual(DQL_CHECK)
      expect(config?.signal).toBe(controller.signal)
    })

    it.each(['dql', 'query_dsl', 'aggregation'] as const)('sends the %s language unchanged', async (language) => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ issues: [] }, `req-check-${language}`))

      await checkOpenSearch({ ...DQL_CHECK, language, text: SAMPLE_QUERY_DSL })

      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/check')
      expect(body).toEqual({ ...DQL_CHECK, language, text: SAMPLE_QUERY_DSL })
    })

    it('sends a Literal body with no fields job and a blank index as they are', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ issues: [] }, 'req-check-literal'))

      await checkOpenSearch({ ...DQL_CHECK, template: false, fields_job_id: null, index: '' })

      const [, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(body).toEqual({ ...DQL_CHECK, template: false, fields_job_id: null, index: '' })
    })

    it('returns the issues in the server shape, positions unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ issues: CHECK_ISSUES }, 'req-check-issues'))

      const result = await checkOpenSearch(DQL_CHECK)

      expect(result).toEqual({ issues: CHECK_ISSUES })
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort()).toEqual(['col', 'length', 'line', 'message'])
      }
    })

    it('resolves to no issues when the request fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(networkError())

      await expect(checkOpenSearch(DQL_CHECK)).resolves.toEqual({ issues: [] })
    })

    it.each([
      ["Unknown query language 'lucene': use dql, query_dsl or aggregation", 400],
      ['Query exceeds 1 MB', 422],
    ])('resolves to no issues when the server refuses the request (%s)', async (message, status) => {
      vi.mocked(apiClient.post).mockRejectedValue(clientError(message, status))

      await expect(checkOpenSearch(DQL_CHECK)).resolves.toEqual({ issues: [] })
    })

    it('resolves to no issues when the request is aborted by the next keystroke', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(abortError())
      const controller = new AbortController()
      controller.abort()

      await expect(checkOpenSearch(DQL_CHECK, controller.signal)).resolves.toEqual({ issues: [] })
    })
  })

  // ==========================================================================
  // suggestOpenSearch
  // ==========================================================================

  describe('suggestOpenSearch', () => {
    it('POSTs the language, text, cursor, kind and fields job to the suggest endpoint with the abort signal', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok(SUGGESTIONS, 'req-suggest'))

      const controller = new AbortController()
      await suggestOpenSearch(DQL_SUGGEST, controller.signal)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      const [path, body, config] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/suggest')
      expect(body).toEqual(DQL_SUGGEST)
      expect(config?.signal).toBe(controller.signal)
    })

    it.each(['dql', 'query_dsl', 'aggregation'] as const)('sends the %s language unchanged', async (language) => {
      vi.mocked(apiClient.post).mockResolvedValue(ok(SUGGESTIONS, `req-suggest-${language}`))

      await suggestOpenSearch({ ...DQL_SUGGEST, language, fields_job_id: null })

      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/suggest')
      expect(body).toEqual({ ...DQL_SUGGEST, language, fields_job_id: null })
    })

    it('returns the suggestions in the server shape, positions unchanged', async () => {
      const keys: OpenSearchSuggestions = {
        from: 2,
        to: 7,
        items: [
          {
            label: 'match',
            kind: 'key',
            detail: 'object',
            info: 'Returns documents that match a provided text, number, date or boolean value. Added in 1.0.',
          },
          { label: 'and', kind: 'value', detail: '', info: '' },
          { label: 'or', kind: 'operator', detail: '', info: '' },
        ],
      }
      vi.mocked(apiClient.post).mockResolvedValue(ok(keys, 'req-suggest-keys'))

      await expect(suggestOpenSearch({ ...DQL_SUGGEST, language: 'query_dsl' })).resolves.toEqual(keys)
    })

    it('answers an empty list at the cursor when the request fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(networkError())

      await expect(suggestOpenSearch({ ...DQL_SUGGEST, cursor: 7 })).resolves.toEqual({
        from: 7,
        to: 7,
        items: [],
      })
    })

    it('answers an empty list at the cursor when the server refuses the cursor', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(clientError('Cursor 42 is outside the text', 400))

      await expect(suggestOpenSearch({ ...DQL_SUGGEST, cursor: 42 })).resolves.toEqual({
        from: 42,
        to: 42,
        items: [],
      })
    })

    it('answers an empty list at the cursor when the request is aborted by the next keystroke', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(abortError())
      const controller = new AbortController()
      controller.abort()

      await expect(suggestOpenSearch(DQL_SUGGEST, controller.signal)).resolves.toEqual({
        from: 12,
        to: 12,
        items: [],
      })
    })
  })

  // ==========================================================================
  // startFields
  // ==========================================================================

  describe('startFields', () => {
    it('POSTs the whole fields request to the fields endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ job_id: JOB_ID, cached: false }, 'req-fields'))

      await startFields(SAMPLE_FIELDS_REQUEST)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/fields')
      expect(body).toEqual(SAMPLE_FIELDS_REQUEST)
    })

    it('carries rows as they sit on the block, with the expression, template and profile context', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ job_id: JOB_ID, cached: false }, 'req-fields-rows'))
      const request: OpenSearchFieldsRequest = {
        connection: {
          ...SAMPLE_OS_CONNECTION,
          url: '{{ os_url }}',
          password: 'wave:enc:v1:b3Mtc2VhbGVkLXBhc3N3b3Jk',
          index: 'logs-{{ env }}-*',
        },
        expression_fields: ['url'],
        template_fields: ['index'],
        element_types: {},
        profile_bindings: [
          { profileId: 'profile-logs', alias: 'logs', profileName: 'Logs cluster', profileType: 'opensearch' },
        ],
        environment_id: 'env-staging',
        test_id: 'test-checkout',
      }

      await startFields(request)

      const [, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(body).toEqual(request)
    })

    it('sends refresh when the author asks for a new pull', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ job_id: JOB_ID, cached: false }, 'req-fields-refresh'))

      await startFields({ ...SAMPLE_FIELDS_REQUEST, refresh: true })

      const [path, body] = vi.mocked(apiClient.post).mock.calls[0]
      expect(path).toBe('/opensearch-tools/fields')
      expect(body).toEqual({ ...SAMPLE_FIELDS_REQUEST, refresh: true })
    })

    it('returns a new job unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(ok({ job_id: JOB_ID, cached: false }, 'req-fields-job'))

      await expect(startFields(SAMPLE_FIELDS_REQUEST)).resolves.toEqual({ job_id: JOB_ID, cached: false })
    })

    it('returns a cached answer with its indexes and fields unchanged', async () => {
      const cached = { job_id: JOB_ID, cached: true, indexes: [...SAMPLE_INDEXES], fields: [...SAMPLE_FIELDS] }
      vi.mocked(apiClient.post).mockResolvedValue(ok(cached, 'req-fields-cached'))

      await expect(startFields(SAMPLE_FIELDS_REQUEST)).resolves.toEqual(cached)
    })

    it('rejects with the client error when the server refuses the request', async () => {
      const error = clientError('Cluster URL is required', 422)
      vi.mocked(apiClient.post).mockRejectedValue(error)

      await expect(startFields(SAMPLE_FIELDS_REQUEST)).rejects.toBe(error)
    })

    it('rejects with the client error when the request fails', async () => {
      const error = networkError()
      vi.mocked(apiClient.post).mockRejectedValue(error)

      await expect(startFields(SAMPLE_FIELDS_REQUEST)).rejects.toBe(error)
    })
  })

  // ==========================================================================
  // getFields
  // ==========================================================================

  describe('getFields', () => {
    it('GETs the job by its id', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(ok({ status: 'connecting' }, 'req-poll'))

      await getFields(JOB_ID)

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      const [path] = vi.mocked(apiClient.get).mock.calls[0]
      expect(path).toBe(`/opensearch-tools/fields/${JOB_ID}`)
    })

    it.each([
      [{ status: 'connecting' }],
      [{ status: 'reading' }],
      [{ status: 'done', indexes: [...SAMPLE_INDEXES], fields: [...SAMPLE_FIELDS] }],
      [{ status: 'done', indexes: [...SAMPLE_INDEXES], fields: [] }],
      [{ status: 'failed', error: 'Cannot resolve Cluster URL: name os_url is not defined' }],
      [{ status: 'canceled' }],
    ])('returns the job %j unchanged', async (job) => {
      vi.mocked(apiClient.get).mockResolvedValue(ok(job, 'req-poll-status'))

      await expect(getFields(JOB_ID)).resolves.toEqual(job)
    })

    it('rejects with the client error when the job is unknown', async () => {
      const error = clientError(`Catalog job '${JOB_ID}' not found`, 404)
      vi.mocked(apiClient.get).mockRejectedValue(error)

      await expect(getFields(JOB_ID)).rejects.toBe(error)
    })

    it('rejects with the client error when the request fails', async () => {
      const error = networkError()
      vi.mocked(apiClient.get).mockRejectedValue(error)

      await expect(getFields(JOB_ID)).rejects.toBe(error)
    })
  })

  // ==========================================================================
  // cancelFields
  // ==========================================================================

  describe('cancelFields', () => {
    it('sends DELETE for the job by its id', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(ok({ status: 'canceled' }, 'req-cancel'))

      await cancelFields(JOB_ID)

      expect(apiClient.delete).toHaveBeenCalledTimes(1)
      const [path] = vi.mocked(apiClient.delete).mock.calls[0]
      expect(path).toBe(`/opensearch-tools/fields/${JOB_ID}`)
    })

    it('returns the canceled status', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(ok({ status: 'canceled' }, 'req-cancel-status'))

      await expect(cancelFields(JOB_ID)).resolves.toEqual({ status: 'canceled' })
    })

    it('rejects with the client error when the job is unknown', async () => {
      const error = clientError(`Catalog job '${JOB_ID}' not found`, 404)
      vi.mocked(apiClient.delete).mockRejectedValue(error)

      await expect(cancelFields(JOB_ID)).rejects.toBe(error)
    })
  })
})
