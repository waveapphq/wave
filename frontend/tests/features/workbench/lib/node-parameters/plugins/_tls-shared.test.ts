/**
 * The TLS trust rows the HTTP, K8s Connect and SQL blocks share.
 *
 * REQ-5.1.4, REQ-3.4.1.6; SQL-8
 */

import { describe, it, expect } from 'vitest'
import { tlsTrustInputs } from '@/features/workbench/lib/node-parameters/plugins/_tls-shared'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { type InputParam } from '@/features/workbench/lib/node-parameters/types'

const TLS_GROUP = 'TLS / Certificates'
const TRUST_NAMES = ['verify_ssl', 'ca_cert', 'client_cert', 'client_key']
const GATE_KEYS = new Set(['showWhen', 'showWhenAll', 'showWhenAny'])

const VERIFY_SSL_HELP =
  'Verify the server certificate: against CA Certificate when it is set, otherwise against the certificates WAVE trusts (Settings > Network > Certificates)'

const CA_CERT_HELP =
  'CA certificate (file path, variable reference, or PEM string); when set, it is the only certificate this block trusts'

const K8S_CA_CERT_HELP =
  'CA certificate (variable reference or PEM string); when set, it is the only certificate this block trusts'

/** A row without its visibility gates. */
function withoutGates(entry: InputParam): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !GATE_KEYS.has(key)))
}

/** The four rows as the HTTP block declares them, in the given group. */
function expectedRows(group: string): InputParam[] {
  return [
    {
      name: 'verify_ssl',
      label: 'Verify Server Certificate',
      type: 'boolean',
      required: false,
      description: VERIFY_SSL_HELP,
      defaultValue: true,
      group,
    },
    {
      name: 'ca_cert',
      label: 'CA Certificate',
      type: 'string',
      required: false,
      description: CA_CERT_HELP,
      group,
      allowedFormats: ['plain'],
    },
    {
      name: 'client_cert',
      label: 'Client Certificate',
      type: 'string',
      required: false,
      description: 'Client certificate for mutual TLS (file path, variable reference, or PEM string)',
      group,
      allowedFormats: ['plain'],
    },
    {
      name: 'client_key',
      label: 'Client Key',
      type: 'string',
      required: false,
      description: 'Private key for the client certificate (file path or PEM string)',
      group,
      secret: true,
      allowedFormats: ['plain'],
    },
  ]
}

/** `count` consecutive rows of a block, starting at its verify_ssl row. */
function rowsFromVerify(elementType: string, count: number): InputParam[] {
  const all = getInputParams(elementType) ?? []
  const start = all.findIndex((p) => p.name === 'verify_ssl')
  expect(start, `${elementType} declares verify_ssl`).toBeGreaterThan(-1)
  return all.slice(start, start + count)
}

describe('tlsTrustInputs', () => {
  it('returns Verify Server Certificate, CA Certificate, Client Certificate and Client Key, in that order', () => {
    expect(tlsTrustInputs(TLS_GROUP).map((p: InputParam) => p.name)).toEqual(TRUST_NAMES)
  })

  it('returns each row with its exact fields', () => {
    expect(tlsTrustInputs(TLS_GROUP)).toEqual(expectedRows(TLS_GROUP))
  })

  it('places every row in the group it is given', () => {
    const rows = tlsTrustInputs('Security')
    expect(rows.map((p: InputParam) => p.group)).toEqual(['Security', 'Security', 'Security', 'Security'])
    expect(rows).toEqual(expectedRows('Security'))
  })

  it('turns certificate verification on by default and defaults no other row', () => {
    expect(tlsTrustInputs(TLS_GROUP).map((p: InputParam) => p.defaultValue)).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('marks only the Client Key secret', () => {
    expect(tlsTrustInputs(TLS_GROUP).map((p: InputParam) => p.secret)).toEqual([
      undefined,
      undefined,
      undefined,
      true,
    ])
  })
})

describe('trust rule help copy (REQ-4.5.16)', () => {
  it('says Verify Server Certificate checks against CA Certificate when set, otherwise the certificates WAVE trusts', () => {
    expect(tlsTrustInputs(TLS_GROUP)[0].description).toBe(VERIFY_SSL_HELP)
  })

  it('says a set CA Certificate is the only certificate the block trusts', () => {
    expect(tlsTrustInputs(TLS_GROUP)[1].description).toBe(CA_CERT_HELP)
  })

  it.each(['http-client', 'sql-client', 'opensearch'])(
    'gives %s the same two help lines',
    (elementType) => {
      const rows = Object.fromEntries((getInputParams(elementType) ?? []).map((p) => [p.name, p]))

      expect(rows.verify_ssl.description).toBe(VERIFY_SSL_HELP)
      expect(rows.ca_cert.description).toBe(CA_CERT_HELP)
    },
  )

  it('gives k8s-connect the same Verify help and a CA help without a file path, since it takes PEM text only', () => {
    const rows = Object.fromEntries((getInputParams('k8s-connect') ?? []).map((p) => [p.name, p]))

    expect(rows.verify_ssl.description).toBe(VERIFY_SSL_HELP)
    expect(rows.ca_cert.description).toBe(K8S_CA_CERT_HELP)
  })
})

describe('blocks that declare the shared rows', () => {
  it('declares them on the HTTP block in place, in the TLS / Certificates group', () => {
    expect(rowsFromVerify('http-client', 4)).toEqual(tlsTrustInputs(TLS_GROUP))
  })

  it('declares them on K8s Connect with TLS Server Name between CA Certificate and Client Certificate', () => {
    const rows = rowsFromVerify('k8s-connect', 5)
    expect(rows.map((p) => p.name)).toEqual([
      'verify_ssl',
      'ca_cert',
      'tls_server_name',
      'client_cert',
      'client_key',
    ])
    expect(rows.filter((p) => p.name !== 'tls_server_name')).toEqual(
      tlsTrustInputs(TLS_GROUP).map((p) =>
        p.name === 'ca_cert' ? { ...p, description: K8S_CA_CERT_HELP } : p,
      ),
    )
  })

  it('declares them on the SQL block, only their visibility added (SQL-8)', () => {
    expect(rowsFromVerify('sql-client', 4).map(withoutGates)).toEqual(
      tlsTrustInputs(TLS_GROUP).map(withoutGates),
    )
  })

  it('gates every one of them on the SQL block (SQL-8)', () => {
    const gated = rowsFromVerify('sql-client', 4).map(
      (p) => p.showWhen !== undefined || p.showWhenAll !== undefined || p.showWhenAny !== undefined,
    )
    expect(gated).toEqual([true, true, true, true])
  })
})
