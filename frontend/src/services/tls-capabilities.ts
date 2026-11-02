/**
 * TLS capabilities client - the fixed host-independent cipher catalog behind
 * the cipher picker sheet (GET /system/tls-capabilities).
 */

import { apiClient } from '@/lib/api'

export interface TlsCipher {
  openssl: string
  iana: string
  min_version: string
  max_version: string
}

export interface TlsCapabilities {
  ciphers: TlsCipher[]
  /** What an unset Cipher Suites sends, by Block and TLS range `<min>-<max>`. */
  defaults: Record<string, Record<string, string[]>>
}

export async function fetchTlsCapabilities(): Promise<TlsCapabilities> {
  const response = await apiClient.get<TlsCapabilities>('/api/v1/system/tls-capabilities')
  return response.data
}
