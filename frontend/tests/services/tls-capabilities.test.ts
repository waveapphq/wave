/**
 * TLS capabilities client: one GET against the pinned
 * /api/v1/system/tls-capabilities path, unwrapping the ApiResponse envelope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api'
import { fetchTlsCapabilities } from '@/services/tls-capabilities'

const mockedGet = vi.mocked(apiClient.get)

describe('fetchTlsCapabilities', () => {
  beforeEach(() => {
    mockedGet.mockReset()
  })

  it('GETs /api/v1/system/tls-capabilities and returns the payload', async () => {
    const payload = {
      ciphers: [
        {
          openssl: 'ECDHE-RSA-AES128-SHA',
          iana: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
          min_version: '1.0',
          max_version: '1.2',
        },
      ],
    }
    mockedGet.mockResolvedValue({ data: payload } as never)

    await expect(fetchTlsCapabilities()).resolves.toEqual(payload)
    expect(mockedGet).toHaveBeenCalledWith('/api/v1/system/tls-capabilities')
  })

  it('propagates transport failures to the caller', async () => {
    mockedGet.mockRejectedValue(new Error('gateway down'))
    await expect(fetchTlsCapabilities()).rejects.toThrow('gateway down')
  })
})
