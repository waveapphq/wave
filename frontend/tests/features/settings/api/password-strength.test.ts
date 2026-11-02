/**
 * Password Strength API Client Tests
 *
 * REQ-5.2.7.1: the strength score shown while a new password is typed (MCP-7).
 *
 * Module under test: frontend/src/features/settings/api/password-strength.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  scorePassword,
  type PasswordStrengthResult,
} from '@/features/settings/api/password-strength'

// ============================================================================
// Fixtures
// ============================================================================

const ENDPOINT = '/api/v1/system/password-strength'

const LABELED_SCORES: PasswordStrengthResult[] = [
  { score: 0, label: 'Very weak' },
  { score: 1, label: 'Weak' },
  { score: 2, label: 'Fair' },
  { score: 3, label: 'Strong' },
  { score: 4, label: 'Very strong' },
]

/** What apiClient resolves once it has unwrapped the `{ success, data, meta }` envelope. */
function unwrapped(data: PasswordStrengthResult) {
  return { data, meta: { requestId: 'test-req-id' }, status: 200 }
}

function sentBody(): Record<string, unknown> {
  return vi.mocked(apiClient.post).mock.calls[0][1] as Record<string, unknown>
}

// ============================================================================
// Tests
// ============================================================================

describe('Password Strength API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('scorePassword', () => {
    it('POSTs to /api/v1/system/password-strength once', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 3, label: 'Strong' }))

      await scorePassword('Wavekeeper!9', ['wave'])

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(vi.mocked(apiClient.post).mock.calls[0][0]).toBe(ENDPOINT)
      expect(apiClient.get).not.toHaveBeenCalled()
      expect(apiClient.put).not.toHaveBeenCalled()
    })

    it('sends the password and the user inputs as { password, user_inputs }', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 1, label: 'Weak' }))

      await scorePassword('wavekeeper2026', ['wavekeeper'])

      expect(sentBody()).toStrictEqual({
        password: 'wavekeeper2026',
        user_inputs: ['wavekeeper'],
      })
    })

    it('sends every user input in the order given', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 2, label: 'Fair' }))

      await scorePassword('Tr0ub4dour&3', ['ops', 'wave'])

      expect(sentBody().user_inputs).toEqual(['ops', 'wave'])
    })

    it('sends the password verbatim, with its spaces and symbols', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 4, label: 'Very strong' }))
      const password = '  correct horse battery staple 9f3k!Q  '

      await scorePassword(password, ['wave'])

      expect(sentBody().password).toBe(password)
    })

    it('sends the password with no user inputs when none are given', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 0, label: 'Very weak' }))

      await scorePassword('password')

      expect(sentBody().password).toBe('password')
      expect(sentBody().user_inputs ?? []).toEqual([])
      expect(Object.keys(sentBody()).filter((key) => key !== 'user_inputs')).toEqual(['password'])
    })

    it.each(LABELED_SCORES)('resolves the unwrapped score $score with label "$label"', async (answer) => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped(answer))

      const result = await scorePassword('blue-kettle-42', ['wave'])

      expect(result).toStrictEqual(answer)
    })

    it('resolves exactly score and label, never the response envelope', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(unwrapped({ score: 4, label: 'Very strong' }))

      const result = await scorePassword('blue-kettle-42')

      expect(Object.keys(result).sort((a, b) => a.localeCompare(b))).toEqual(['label', 'score'])
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = Object.assign(new Error('Internal Server Error'), { status: 500 })
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(scorePassword('password', ['wave'])).rejects.toBe(apiError)
    })
  })
})
