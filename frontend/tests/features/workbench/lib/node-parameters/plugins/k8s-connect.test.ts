/**
 * K8s Connect plugin parameter schema tests (REQ-5.1.1, REQ-4.6.3, K8SCON-1..6).
 *
 * Connect renders three expanded groups in declaration order: Connection,
 * Authentication, TLS / Certificates (K8SCON-2). Credentials are MODELESS
 * (K8SCON-1): optional Bearer Token and/or optional client cert pair, any
 * combination. The TLS / Certificates section mirrors the HTTP plugin
 * plus tls_server_name, with a PEM-only CA help. The session output is
 * schema-secret (K8SCON-4).
 */

import { describe, it, expect } from 'vitest'
import { Cable } from 'lucide-react'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import { isValidIconName } from '@/features/workbench/lib/icon-registry'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

type MaybeSecretOutput = OutputParam & { secret?: boolean }

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

function outputsByName(nodeId: string): Record<string, MaybeSecretOutput> {
  const outputs = (getOutputParams(nodeId) ?? []) as MaybeSecretOutput[]
  return Object.fromEntries(outputs.map((o) => [o.name, o]))
}

const CONNECT_PARAM_ORDER = [
  'api_url',
  'namespace',
  'timeout',
  'token',
  'acquire_run_token',
  'run_token_service_account',
  'run_token_namespace',
  'run_token_duration',
  'verify_ssl',
  'ca_cert',
  'tls_server_name',
  'client_cert',
  'client_key',
  'tls_min_version',
  'tls_max_version',
  'cipher_suites',
]

const CONNECTION_PARAMS = ['api_url', 'namespace', 'timeout']

const AUTHENTICATION_PARAMS = [
  'token',
  'acquire_run_token',
  'run_token_service_account',
  'run_token_namespace',
  'run_token_duration',
]

const TLS_PARAMS = [
  'verify_ssl',
  'ca_cert',
  'tls_server_name',
  'client_cert',
  'client_key',
  'tls_min_version',
  'tls_max_version',
  'cipher_suites',
]

// The seven rows copied verbatim from the HTTP plugin; tls_server_name is
// the one k8s-only addition to the group.
const TLS_SHARED_PARAMS = [
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
  'tls_min_version',
  'tls_max_version',
  'cipher_suites',
]

const RUN_TOKEN_GATE = { field: 'acquire_run_token', values: ['true'] }
const TLS_VERSIONS = ['1.0', '1.1', '1.2', '1.3']
const TLS_ORDER = 'Min TLS Version cannot exceed Max TLS Version'

describe('registration', () => {
  it('registers k8s-connect in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-connect']).toBeDefined()
  })

  it('registers k8s-connect in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-connect']).toBeDefined()
  })

  it('registers k8s-connect in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-connect']).toBeDefined()
  })

  it('resolves k8s-connect via hasNodeParams', () => {
    expect(hasNodeParams('k8s-connect')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 16 input params in the pinned order', () => {
    expect((getInputParams('k8s-connect') ?? []).map((p) => p.name)).toEqual(
      CONNECT_PARAM_ORDER,
    )
    expect(getInputParams('k8s-connect') ?? []).toHaveLength(16)
  })

  it('assigns the Connection group to connection params', () => {
    const params = inputsByName('k8s-connect')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Authentication group to credential params', () => {
    const params = inputsByName('k8s-connect')

    for (const name of AUTHENTICATION_PARAMS) {
      expect(params[name].group, name).toBe('Authentication')
    }
  })

  it('assigns the TLS / Certificates group to trust params', () => {
    const params = inputsByName('k8s-connect')

    for (const name of TLS_PARAMS) {
      expect(params[name].group, name).toBe('TLS / Certificates')
    }
  })

  it('marks only api_url required', () => {
    const params = inputsByName('k8s-connect')

    expect(params.api_url.required).toBe(true)
    for (const name of CONNECT_PARAM_ORDER) {
      if (name === 'api_url') continue
      expect(params[name].required, name).toBe(false)
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-connect') ?? []

    expect(inputs).toHaveLength(CONNECT_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-connect')

    expect(params.api_url.label).toBe('API URL')
    expect(params.namespace.label).toBe('Namespace')
    expect(params.timeout.label).toBe('Timeout')
    expect(params.token.label).toBe('Bearer Token')
    expect(params.acquire_run_token.label).toBe('Get SA Token')
    expect(params.run_token_service_account.label).toBe('Service Account')
    expect(params.run_token_namespace.label).toBe('SA Namespace')
    expect(params.run_token_duration.label).toBe('Duration (s)')
    expect(params.verify_ssl.label).toBe('Verify Server Certificate')
    expect(params.ca_cert.label).toBe('CA Certificate')
    expect(params.tls_server_name.label).toBe('TLS Server Name')
    expect(params.client_cert.label).toBe('Client Certificate')
    expect(params.client_key.label).toBe('Client Key')
    expect(params.tls_min_version.label).toBe('Min TLS Version')
    expect(params.tls_max_version.label).toBe('Max TLS Version')
    expect(params.cipher_suites.label).toBe('Cipher Suites')
  })
})

describe('Connection group', () => {
  it('declares api_url as a required expression-resolvable plain-text string', () => {
    const apiUrl = inputsByName('k8s-connect').api_url

    expect(apiUrl.type).toBe('string')
    expect(apiUrl.required).toBe(true)
    expect(apiUrl.noExpression).toBeUndefined()
    expect(apiUrl.allowedFormats).toEqual(['plain'])
  })

  it('declares namespace defaulting to default', () => {
    const namespace = inputsByName('k8s-connect').namespace

    expect(namespace.type).toBe('string')
    expect(namespace.defaultValue).toBe('default')
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-connect').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
  })
})

describe('Authentication group', () => {
  it('declares token as an optional secret locked to plain', () => {
    const token = inputsByName('k8s-connect').token

    expect(token.type).toBe('string')
    expect(token.required).toBe(false)
    expect(token.secret).toBe(true)
    expect(token.allowedFormats).toEqual(['plain'])
  })

  it('declares the Get SA Token toggle as a boolean defaulting to false (K8SCON-2)', () => {
    const toggle = inputsByName('k8s-connect').acquire_run_token

    expect(toggle.type).toBe('boolean')
    expect(toggle.defaultValue).toBe(false)
  })

  it('gates the three run-token sub-params behind the toggle', () => {
    const params = inputsByName('k8s-connect')

    for (const name of [
      'run_token_service_account',
      'run_token_namespace',
      'run_token_duration',
    ]) {
      expect(params[name].showWhen, name).toEqual(RUN_TOKEN_GATE)
    }
  })

  it('requires the service account only while the toggle is on', () => {
    const params = inputsByName('k8s-connect')

    expect(params.run_token_service_account.requiredWhen).toEqual(RUN_TOKEN_GATE)
    expect(params.run_token_namespace.requiredWhen).toBeUndefined()
    expect(params.run_token_duration.requiredWhen).toBeUndefined()
  })

  it('retains the run-token sub-param values while hidden', () => {
    const params = inputsByName('k8s-connect')

    for (const name of [
      'run_token_service_account',
      'run_token_namespace',
      'run_token_duration',
    ]) {
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('declares the run-token sub-param types and defaults', () => {
    const params = inputsByName('k8s-connect')

    expect(params.run_token_service_account.type).toBe('string')
    expect(params.run_token_service_account.defaultValue).toBeUndefined()
    expect(params.run_token_namespace.type).toBe('string')
    expect(params.run_token_namespace.defaultValue).toBe('default')
    expect(params.run_token_duration.type).toBe('integer')
    expect(params.run_token_duration.defaultValue).toBe(14400)
  })
})

describe('TLS / Certificates group', () => {
  it('declares verify_ssl as a boolean defaulting to true with the renamed label (K8SCON-3)', () => {
    const verifySsl = inputsByName('k8s-connect').verify_ssl

    expect(verifySsl.type).toBe('boolean')
    expect(verifySsl.defaultValue).toBe(true)
    expect(verifySsl.label).toBe('Verify Server Certificate')
    expect(verifySsl.noExpression).toBeUndefined()
    expect(verifySsl.allowedFormats).toBeUndefined()
    expect(verifySsl.description).toBe(
      'Verify the server certificate: against CA Certificate when it is set, otherwise against the certificates WAVE trusts (Settings > Network > Certificates)',
    )
  })

  it('describes ca_cert as PEM text only, with no file path', () => {
    expect(inputsByName('k8s-connect').ca_cert.description).toBe(
      'CA certificate (variable reference or PEM string); when set, it is the only certificate this block trusts',
    )
  })

  it('renders the PEM fields as plain strings', () => {
    const params = inputsByName('k8s-connect')

    for (const name of ['ca_cert', 'client_cert', 'client_key']) {
      expect(params[name].allowedFormats, name).toEqual(['plain'])
    }
  })

  it('seals client_key and leaves ca_cert and client_cert readable', () => {
    const params = inputsByName('k8s-connect')

    expect(params.client_key.secret).toBe(true)
    expect(params.ca_cert.secret).not.toBe(true)
    expect(params.client_cert.secret).not.toBe(true)
  })

  it('declares tls_server_name as an optional string', () => {
    const serverName = inputsByName('k8s-connect').tls_server_name

    expect(serverName.type).toBe('string')
    expect(serverName.required).toBe(false)
    expect(serverName.label).toBe('TLS Server Name')
  })

  it.each([
    ['tls_min_version', '1.2'],
    ['tls_max_version', '1.3'],
  ])('%s spans 1.0-1.3 defaulting to %s with TLS-prefixed labels', (name, defaultValue) => {
    const p = inputsByName('k8s-connect')[name]

    expect(p.enumValues).toEqual(TLS_VERSIONS)
    expect(p.defaultValue).toBe(defaultValue)
    expect(p.noExpression).toBe(true)
    expect(p.enumLabels).toEqual({
      '1.0': 'TLS 1.0',
      '1.1': 'TLS 1.1',
      '1.2': 'TLS 1.2',
      '1.3': 'TLS 1.3',
    })
  })

  it('carries the min-not-above-max rule as data with the exact message', () => {
    const params = inputsByName('k8s-connect')

    expect(params.tls_min_version.notAbove).toEqual({
      field: 'tls_max_version',
      message: TLS_ORDER,
    })
    expect(params.tls_max_version.notAbove).toBeUndefined()
  })

  it('clamps the version selects against each other on change', () => {
    const params = inputsByName('k8s-connect')

    expect(params.tls_min_version.clampsSibling).toEqual({
      field: 'tls_max_version',
      keep: 'atLeast',
    })
    expect(params.tls_max_version.clampsSibling).toEqual({
      field: 'tls_min_version',
      keep: 'atMost',
    })
  })

  it('declares cipher_suites as an ordered array edited through the cipher picker', () => {
    const cipherSuites = inputsByName('k8s-connect').cipher_suites

    expect(cipherSuites.type).toBe('array')
    expect(cipherSuites.defaultValue).toBeUndefined()
    expect(cipherSuites.cipherPicker).toBe(true)
    expect(cipherSuites.description).toBe(
      'Cipher suites offered to the server, in client preference order per protocol family. ' +
        'Unset offers every suite WAVE supports for the selected TLS version range; ' +
        'an empty selection offers no ciphers. The K8s Session always carries the exact ' +
        'suites offered. OpenSSL and IANA names accepted',
    )
  })

  it('keeps the seven shared rows identical to the HTTP plugin section', () => {
    const http = Object.fromEntries(
      (getInputParams('http-client') ?? []).map((p) => [p.name, p]),
    )
    const k8s = inputsByName('k8s-connect')
    const pick = (p: InputParam) => ({
      label: p.label,
      type: p.type,
      description: p.description,
      defaultValue: p.defaultValue,
      enumValues: p.enumValues,
      enumLabels: p.enumLabels,
      allowedFormats: p.allowedFormats,
      secret: p.secret,
      noExpression: p.noExpression,
      notAbove: p.notAbove,
      clampsSibling: p.clampsSibling,
      cipherPicker: p.cipherPicker,
      group: p.group,
    })

    for (const name of TLS_SHARED_PARAMS) {
      const k8sRow = pick(k8s[name])
      const httpRow = pick(http[name])
      if (name === 'cipher_suites' || name === 'ca_cert') {
        // Unset-cipher behavior and PEM-only CA input diverge from HTTP, so these descriptions do too
        delete (k8sRow as { description?: string }).description
        delete (httpRow as { description?: string }).description
      }
      expect(k8sRow, name).toEqual(httpRow)
    }
  })
})

describe('secret flags', () => {
  it('flags the credential params secret', () => {
    const params = inputsByName('k8s-connect')

    expect(params.token.secret).toBe(true)
    expect(params.client_key.secret).toBe(true)
  })

  it('does not flag non-credential params secret', () => {
    const params = inputsByName('k8s-connect')

    for (const name of CONNECT_PARAM_ORDER) {
      if (name === 'token' || name === 'client_key') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the three groups in declaration order, all expanded (K8SCON-2)', () => {
    const meta = getGroupMeta('k8s-connect')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(['Connection', 'Authentication', 'TLS / Certificates'])
    for (const group of Object.keys(meta!)) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-connect')!.Connection.description).toBe(
      'API server URL, default namespace, and request timeout',
    )
  })

  it('carries the exact Authentication footer (K8SCON-6)', () => {
    expect(getGroupMeta('k8s-connect')!.Authentication.description).toBe(
      'How WAVE identifies itself to the cluster: an optional bearer token, a TLS client certificate, or neither (anonymous or proxied access)',
    )
  })

  it('carries the exact TLS / Certificates footer (K8SCON-6)', () => {
    expect(getGroupMeta('k8s-connect')!['TLS / Certificates'].description).toBe(
      "Server trust and TLS behavior. A client certificate the cluster's client CA recognizes is also the identity WAVE presents",
    )
  })
})

describe('outputs', () => {
  it('declares session then cluster_version, both strings, always offered (K8SCON-5)', () => {
    const outputs = getOutputParams('k8s-connect') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['session', 'string'],
      ['cluster_version', 'string'],
    ])
    for (const output of outputs) {
      expect(output.showWhen, `showWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('displays the session output as K8s Session (K8SCON-5)', () => {
    const outputs = outputsByName('k8s-connect')

    expect(outputs.session.label).toBe('K8s Session')
    expect(outputs.cluster_version.label).toBe('Cluster Version')
  })

  it('declares the session output schema-secret and cluster_version not (K8SCON-4)', () => {
    const outputs = outputsByName('k8s-connect')

    expect(outputs.session.secret).toBe(true)
    expect(outputs.cluster_version.secret).toBeUndefined()
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-connect') ?? []

    expect(outputs).toHaveLength(2)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Connect palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-connect')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Connect')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Cable')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-connect')?.remotable).toBe(true)
  })

  it('keeps Cable registered in the palette icon registry', () => {
    expect(isValidIconName('Cable')).toBe(true)
  })

  it('registers all three canvas maps for k8s-connect', () => {
    expect(getIcon('k8s-connect')).toBe(Cable)
    expect(getIconName('k8s-connect')).toBe('cable')
    expect(getColorClass('k8s-connect')).toBe('text-sky-500')
  })
})
