/**
 * SECRET_MASK_FIELDS catalog + backend parity guard (REQ-3.1.3.16).
 *
 * The FE catalog of a plugin's credential-bearing fields drives the per-block
 * Secret Masking checklist. Its keys are the canonical lowercase header names
 * and MUST equal the backend HTTPClientPlugin._SENSITIVE_HEADERS set, so
 * the two declarations cannot silently diverge.
 */
import { describe, it, expect } from 'vitest'
import * as nodeParams from '@/features/workbench/lib/node-parameters'

// The canonical eight credential headers - the FE twin of the backend
// HTTPClientPlugin._SENSITIVE_HEADERS frozenset.
const CANONICAL_HTTP_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]

interface SecretMaskField {
  key: string
  label: string
}

// The shape-cast keeps this contract test compiling against the optional
// `SECRET_MASK_FIELDS` and `getSecretMaskFields` registry exports.
const mod = nodeParams as unknown as {
  SECRET_MASK_FIELDS?: Record<string, SecretMaskField[]>
  getSecretMaskFields?: (nodeId: string) => SecretMaskField[] | undefined
}

function httpCatalog(): SecretMaskField[] {
  return mod.SECRET_MASK_FIELDS?.['http-client'] ?? []
}

describe('SECRET_MASK_FIELDS catalog (REQ-3.1.3.16)', () => {
  it('exposes a non-empty http-client credential-field catalog', () => {
    expect(httpCatalog().length).toBeGreaterThan(0)
  })

  it('http-client field keys equal the canonical eight (BE _SENSITIVE_HEADERS twin)', () => {
    const keys = httpCatalog().map((f) => f.key)
    expect(new Set(keys)).toEqual(new Set(CANONICAL_HTTP_KEYS))
    expect(keys).toHaveLength(CANONICAL_HTTP_KEYS.length)
  })

  it('every field carries a lowercase key and a non-empty display label', () => {
    for (const field of httpCatalog()) {
      expect(field.key).toBe(field.key.toLowerCase())
      expect(typeof field.label).toBe('string')
      expect(field.label.length).toBeGreaterThan(0)
    }
  })
})

describe('getSecretMaskFields getter (REQ-3.1.3.16)', () => {
  it('returns the http-client catalog', () => {
    const keys = (mod.getSecretMaskFields?.('http-client') ?? []).map((f) => f.key)
    expect(new Set(keys)).toEqual(new Set(CANONICAL_HTTP_KEYS))
  })

  it('returns no catalog for a plugin that declares none', () => {
    expect(mod.getSecretMaskFields?.('log') ?? []).toEqual([])
  })
})

// SSH Session Open joins the per-field masking catalog. Its keys are the
// three declared credential PARAM names and MUST equal the backend
// SSHSessionOpenPlugin.metadata["secret_mask_fields"] set.
const CANONICAL_SSH_KEYS = ['password', 'private_key', 'passphrase']

function sshCatalog(): SecretMaskField[] {
  return mod.SECRET_MASK_FIELDS?.['ssh-session-open'] ?? []
}

describe('SECRET_MASK_FIELDS catalog - SSH Session Open (REQ-3.1.3.16)', () => {
  it('exposes a non-empty ssh-session-open credential-field catalog', () => {
    expect(sshCatalog().length).toBeGreaterThan(0)
  })

  it('ssh-session-open field keys equal the declared credential params (BE parity)', () => {
    const keys = sshCatalog().map((f) => f.key)
    expect(new Set(keys)).toEqual(new Set(CANONICAL_SSH_KEYS))
    expect(keys).toHaveLength(CANONICAL_SSH_KEYS.length)
  })

  it('every ssh field carries a lowercase key and a non-empty display label', () => {
    for (const field of sshCatalog()) {
      expect(field.key).toBe(field.key.toLowerCase())
      expect(typeof field.label).toBe('string')
      expect(field.label.length).toBeGreaterThan(0)
    }
  })
})

describe('getSecretMaskFields getter - SSH Session Open (REQ-3.1.3.16)', () => {
  it('returns the ssh-session-open catalog', () => {
    const keys = (mod.getSecretMaskFields?.('ssh-session-open') ?? []).map((f) => f.key)
    expect(new Set(keys)).toEqual(new Set(CANONICAL_SSH_KEYS))
  })
})

// K8s Connect declares no masking catalog: key absence, not an empty array, is the contract.
describe('SECRET_MASK_FIELDS catalog - K8s Connect declares none (REQ-3.1.3.16)', () => {
  it('carries no k8s-connect key in the catalog map', () => {
    expect(mod.SECRET_MASK_FIELDS?.['k8s-connect']).toBeUndefined()
  })

  it('returns no catalog for k8s-connect through the getter', () => {
    expect(mod.getSecretMaskFields?.('k8s-connect') ?? []).toEqual([])
  })
})

// REQ-4.5.6: kind Secret registers its values at run time, so no static per-field catalog exists.
const K8S_VERB_IDS = [
  'k8s-get',
  'k8s-events',
  'k8s-logs',
  'k8s-top',
  'k8s-apply',
  'k8s-delete',
  'k8s-scale',
  'k8s-rollout',
  'k8s-exec',
  'k8s-script',
  'k8s-copy',
]

describe('SECRET_MASK_FIELDS catalog - K8s verb blocks declare none (REQ-3.1.3.16, REQ-4.5.6)', () => {
  it('lists no K8s verb block among the catalog keys', () => {
    const keys = Object.keys(mod.SECRET_MASK_FIELDS ?? {})
    for (const id of K8S_VERB_IDS) {
      expect(keys).not.toContain(id)
    }
  })

  it.each(K8S_VERB_IDS)('carries no %s key in the catalog map', (id) => {
    expect(mod.SECRET_MASK_FIELDS?.[id]).toBeUndefined()
  })

  it.each(K8S_VERB_IDS)('returns no catalog for %s through the getter', (id) => {
    expect(mod.getSecretMaskFields?.(id)).toBeUndefined()
    expect(mod.getSecretMaskFields?.(id) ?? []).toEqual([])
  })
})

const HELM_IDS = [
  'helm-install',
  'helm-upgrade',
  'helm-rollback',
  'helm-uninstall',
  'helm-test',
  'helm-status',
]

const HELM_SECRET_ROWS: Record<string, string[]> = {
  'helm-install': ['session', 'repo_password'],
  'helm-upgrade': ['session', 'repo_password'],
  'helm-rollback': ['session'],
  'helm-uninstall': ['session'],
  'helm-test': ['session'],
  'helm-status': ['session'],
}

describe('Helm blocks - the repository password is a declared secret row (REQ-3.1.3.16)', () => {
  it.each(HELM_IDS)('declares no credential-key catalog for %s', (id) => {
    expect(mod.SECRET_MASK_FIELDS?.[id]).toBeUndefined()
    expect(mod.getSecretMaskFields?.(id)).toBeUndefined()
  })

  it.each(HELM_IDS)('marks exactly the declared secret rows on %s', (id) => {
    const params = nodeParams.getInputParams(id) ?? []
    const secrets = params.filter((p) => p.secret).map((p) => p.name)
    expect(secrets).toEqual(HELM_SECRET_ROWS[id])
  })

  it('renders the repository password as a secret field on Install and Upgrade', () => {
    for (const id of ['helm-install', 'helm-upgrade']) {
      const params = nodeParams.getInputParams(id) ?? []
      const password = params.find((p) => p.name === 'repo_password')
      expect(password, `${id} declares repo_password`).toBeDefined()
      expect(password!.secret, `${id} repo_password is secret`).toBe(true)
    }
  })

  it('leaves the repository username in the clear', () => {
    const params = nodeParams.getInputParams('helm-install') ?? []
    expect(params.find((p) => p.name === 'repo_username')?.secret).toBeUndefined()
  })
})

// The SQL block's two secret rows, the twin of the backend secret_mask_fields list.
const CANONICAL_SQL_FIELDS: SecretMaskField[] = [
  { key: 'password', label: 'Password' },
  { key: 'client_key', label: 'Client Key' },
]

function sqlCatalog(): SecretMaskField[] {
  return mod.SECRET_MASK_FIELDS?.['sql-client'] ?? []
}

describe('SECRET_MASK_FIELDS catalog - SQL (REQ-3.1.3.16, REQ-4.7.11)', () => {
  it('declares exactly Password and Client Key, in that order (BE parity)', () => {
    expect(sqlCatalog()).toEqual(CANONICAL_SQL_FIELDS)
    expect(sqlCatalog().map((f) => f.key)).toEqual(['password', 'client_key'])
  })

  it('every sql field carries a lowercase key and a non-empty display label', () => {
    expect(sqlCatalog()).toHaveLength(2)
    for (const field of sqlCatalog()) {
      expect(field.key).toBe(field.key.toLowerCase())
      expect(field.label.length).toBeGreaterThan(0)
    }
  })

  it('names exactly the rows the SQL block marks secret', () => {
    const secretRows = (nodeParams.getInputParams('sql-client') ?? [])
      .filter((p) => p.secret)
      .map((p) => p.name)
    expect(secretRows).toEqual(['password', 'client_key'])
    expect(sqlCatalog().map((f) => f.key)).toEqual(secretRows)
  })
})

describe('getSecretMaskFields getter - SQL (REQ-3.1.3.16)', () => {
  it('returns the sql-client catalog', () => {
    expect(mod.getSecretMaskFields?.('sql-client')).toEqual(CANONICAL_SQL_FIELDS)
    expect(mod.getSecretMaskFields?.('sql-client')).toBe(mod.SECRET_MASK_FIELDS?.['sql-client'])
  })
})

// The OpenSearch block's four secret rows, the twin of the backend secret_mask_fields list.
const CANONICAL_OPENSEARCH_FIELDS: SecretMaskField[] = [
  { key: 'password', label: 'Password' },
  { key: 'api_key', label: 'API Key' },
  { key: 'bearer_token', label: 'Bearer Token' },
  { key: 'client_key', label: 'Client Key' },
]

function openSearchCatalog(): SecretMaskField[] {
  return mod.SECRET_MASK_FIELDS?.['opensearch'] ?? []
}

describe('SECRET_MASK_FIELDS catalog - OpenSearch (REQ-3.1.3.16, REQ-3.4.1.15)', () => {
  it('declares exactly Password, API Key, Bearer Token and Client Key, in that order (BE parity)', () => {
    expect(openSearchCatalog()).toEqual(CANONICAL_OPENSEARCH_FIELDS)
    expect(openSearchCatalog().map((f) => f.key)).toEqual(['password', 'api_key', 'bearer_token', 'client_key'])
  })

  it('every opensearch field carries a lowercase key and a non-empty display label', () => {
    expect(openSearchCatalog()).toHaveLength(4)
    for (const field of openSearchCatalog()) {
      expect(field.key).toBe(field.key.toLowerCase())
      expect(field.label.length).toBeGreaterThan(0)
    }
  })

  it('names exactly the rows the OpenSearch block marks secret', () => {
    const secretRows = (nodeParams.getInputParams('opensearch') ?? [])
      .filter((p) => p.secret)
      .map((p) => p.name)
    expect(secretRows).toEqual(['password', 'api_key', 'bearer_token', 'client_key'])
    expect(openSearchCatalog().map((f) => f.key)).toEqual(secretRows)
  })
})

describe('getSecretMaskFields getter - OpenSearch (REQ-3.1.3.16)', () => {
  it('returns the opensearch catalog', () => {
    expect(mod.getSecretMaskFields?.('opensearch')).toEqual(CANONICAL_OPENSEARCH_FIELDS)
    expect(mod.getSecretMaskFields?.('opensearch')).toBe(mod.SECRET_MASK_FIELDS?.['opensearch'])
  })
})

describe('Block secret settings declare no default (SECUI-13, REQ-3.1.3.18)', () => {
  function secretSettings(): Array<{ block: string; name: string; declaresDefault: boolean }> {
    return Object.entries(nodeParams.ALL_INPUTS).flatMap(([block, params]) =>
      params
        .filter((param) => param.secret === true)
        .map((param) => ({ block, name: param.name, declaresDefault: 'defaultValue' in param })),
    )
  }

  it('finds the secret settings of the block catalog to check', () => {
    const blocks = new Set(secretSettings().map((setting) => setting.block))
    for (const block of ['http-client', 'sql-client', 'opensearch', 'ssh-session-open', 'helm-install']) {
      expect(blocks.has(block), `${block} declares secret settings`).toBe(true)
    }
  })

  it('declares no default on any secret setting of any block', () => {
    const withDefault = secretSettings()
      .filter((setting) => setting.declaresDefault)
      .map((setting) => `${setting.block}.${setting.name}`)
    expect(withDefault).toEqual([])
  })
})
