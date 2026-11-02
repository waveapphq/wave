/**
 * HTTP Client plugin parameter schema (REQ-3.4.1.4).
 *
 * Pins the reworked schema surface: the Auth config section, the Body config
 * section with body_auto_headers + file_content_type, the retired
 * mode-conflict key rules and the reworded Content-Length block, the
 * two-choice Proxy row with its remote-host lock (HTTP-13), the TLS
 * min/max/cipher rows, and the surviving
 * Response / Connection rows. Param count, order, groups, visibility, labels,
 * and notes are exact.
 */
import { describe, it, expect } from 'vitest'
import { getInputParams, getOutputParams, getGroupMeta } from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import { isParameterVisible, type Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const inputs = () => getInputParams('http-client') ?? []

interface FileReferenceKeys {
  fileReference?: 'file' | 'file-or-folder' | 'folder' | 'save-as'
  fileReferenceArtifactsOnly?: boolean
}

function byName(): Record<string, InputParam> {
  return Object.fromEntries(inputs().map((p) => [p.name, p]))
}

/** The two picker keys read off a row without widening the row to `unknown`. */
function fileRef(row: InputParam): FileReferenceKeys {
  return row as InputParam & FileReferenceKeys
}

function outputsByName(): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams('http-client') ?? []).map((o) => [o.name, o]))
}

function visible(name: string, values: Record<string, unknown>): boolean {
  const all = inputs() as unknown as Parameter[]
  const param = all.find((p) => p.name === name)
  expect(param, `param ${name}`).toBeDefined()
  return isParameterVisible(param!, values, all)
}

const FILE_SOURCE_PLACEHOLDER = 'artifact://…, testdata://…, or /abs/path on host'
const CONTENT_LENGTH_BLOCKED =
  'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'
const PROXY_HELP =
  'Proxy: WAVE setting follows Settings > Network > Proxy; Off connects directly. ' +
  "On a remote host the block uses that host's own proxy settings."
const PROXY_REMOTE_TEXT = "Remote host's settings"
const TLS_ORDER = 'Min TLS Version cannot exceed Max TLS Version'
const TLS_VERSIONS = ['1.0', '1.1', '1.2', '1.3']

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 36 input params in the pinned order', () => {
    expect(inputs().map((p) => p.name)).toEqual([
      'url',
      'method',
      'headers',
      'auth_enabled',
      'auth_mode',
      'auth_username',
      'auth_password',
      'auth_token',
      'auth_header_name',
      'auth_key',
      'body_mode',
      'body',
      'form_fields',
      'parts',
      'file_source',
      'file_content_type',
      'body_auto_headers',
      'query_params',
      'timeout',
      'retry_count',
      'retry_delay',
      'retry_backoff_factor',
      'retryable_status_codes',
      'response_mode',
      'file_path',
      'max_size',
      'verify_ssl',
      'ca_cert',
      'client_cert',
      'client_key',
      'tls_min_version',
      'tls_max_version',
      'cipher_suites',
      'allow_redirects',
      'max_redirects',
      'proxy_mode',
    ])
    expect(inputs()).toHaveLength(36)
  })

  it('keeps url, method, headers, and query_params ungrouped', () => {
    const ungrouped = inputs().filter((p) => !p.group).map((p) => p.name)
    expect(ungrouped).toEqual(['url', 'method', 'headers', 'query_params'])
  })

  it('assigns every other param to its section', () => {
    const groupOf = Object.fromEntries(inputs().map((p) => [p.name, p.group]))
    for (const name of ['auth_enabled', 'auth_mode', 'auth_username', 'auth_password', 'auth_token', 'auth_header_name', 'auth_key']) {
      expect(groupOf[name], name).toBe('Auth')
    }
    for (const name of ['body_mode', 'body', 'form_fields', 'parts', 'file_source', 'file_content_type', 'body_auto_headers']) {
      expect(groupOf[name], name).toBe('Body')
    }
    for (const name of ['timeout', 'retry_count', 'retry_delay', 'retry_backoff_factor', 'retryable_status_codes']) {
      expect(groupOf[name], name).toBe('Timeouts & Retries')
    }
    for (const name of ['response_mode', 'file_path', 'max_size']) {
      expect(groupOf[name], name).toBe('Response')
    }
    for (const name of ['verify_ssl', 'ca_cert', 'client_cert', 'client_key', 'tls_min_version', 'tls_max_version', 'cipher_suites']) {
      expect(groupOf[name], name).toBe('TLS / Certificates')
    }
    for (const name of ['allow_redirects', 'max_redirects', 'proxy_mode']) {
      expect(groupOf[name], name).toBe('Connection')
    }
  })
})

describe('group metadata', () => {
  it('registers all six groups with no Security decoy and no summary machinery', () => {
    const meta = getGroupMeta('http-client')
    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual([
      'Auth',
      'Body',
      'Timeouts & Retries',
      'Response',
      'TLS / Certificates',
      'Connection',
    ])
    for (const group of Object.keys(meta!)) {
      expect('summary' in meta![group], `groupMeta ${group} summary`).toBe(false)
    }
    expect(meta!.Security).toBeUndefined()
  })

  it('prunes every group description (including TLS / Certificates)', () => {
    const meta = getGroupMeta('http-client')
    for (const group of [
      'Auth',
      'Body',
      'Timeouts & Retries',
      'Response',
      'TLS / Certificates',
      'Connection',
    ]) {
      expect(meta![group].description, `groupMeta ${group} description`).toBeUndefined()
    }
  })
})


describe('Auth section', () => {
  it('declares auth_enabled as an always-visible no-expression boolean defaulting to false', () => {
    const p = byName().auth_enabled
    expect(p.label).toBe('Enable Auth')
    expect(p.type).toBe('boolean')
    expect(p.required).toBe(false)
    expect(p.defaultValue).toBe(false)
    expect(p.noExpression).toBe(true)
    expect(p.showWhen).toBeUndefined()
    expect(p.showWhenAll).toBeUndefined()
  })

  it('declares auth_mode as a basic/bearer/api_key enum gated by auth_enabled', () => {
    const p = byName().auth_mode
    expect(p.enumValues).toEqual(['basic', 'bearer', 'api_key'])
    expect(p.defaultValue).toBe('basic')
    expect(p.noExpression).toBe(true)
    expect(p.showWhen).toEqual({ field: 'auth_enabled', values: ['true'] })
    expect(p.enumLabels).toEqual({ basic: 'Basic', bearer: 'Bearer token', api_key: 'API key' })
  })

  it('hides auth_mode until auth is enabled', () => {
    expect(visible('auth_mode', {})).toBe(false)
    expect(visible('auth_mode', { auth_enabled: true })).toBe(true)
  })

  it.each([
    ['auth_username', 'basic'],
    ['auth_password', 'basic'],
    ['auth_token', 'bearer'],
    ['auth_header_name', 'api_key'],
    ['auth_key', 'api_key'],
  ])('gates %s by auth_enabled AND auth_mode=%s, required when visible', (name, mode) => {
    const p = byName()[name]
    const conditions = [
      { field: 'auth_enabled', values: ['true'] },
      { field: 'auth_mode', values: [mode] },
    ]
    expect(p.showWhenAll).toEqual(conditions)
    expect(p.requiredWhenAll).toEqual(conditions)
    expect(p.required).toBe(false)
    expect(p.retainOnHide).toBe(true)
  })

  it('seals auth_password, auth_token, and auth_key as credential fields', () => {
    const params = byName()
    for (const name of ['auth_password', 'auth_token', 'auth_key']) {
      expect(params[name].secret, `${name}.secret`).toBe(true)
      expect(params[name].allowedFormats, `${name}.allowedFormats`).toEqual(['plain'])
      expect(params[name].type).toBe('string')
    }
  })

  it('keeps auth_username and auth_header_name unsealed plain strings', () => {
    const params = byName()
    for (const name of ['auth_username', 'auth_header_name']) {
      expect(params[name].secret, `${name}.secret`).toBeFalsy()
      expect(params[name].allowedFormats).toEqual(['plain'])
    }
  })

  it('defaults auth_header_name to X-API-Key', () => {
    expect(byName().auth_header_name.defaultValue).toBe('X-API-Key')
  })
})

describe('headers row', () => {
  it('describes headers as carrying auth and keeps the credential catalog + editor note', () => {
    const p = byName().headers
    expect(p.description).toBe('Request headers - including auth (Authorization, API keys)')
    expect(p.credentialCatalog).toBe(true)
    expect(p.editorNote).toBe(
      'Standard headers (Host, User-Agent, Accept, ...) are sent automatically - add a row to override.',
    )
  })

  it('blocks only Content-Length, with the reworded transport message', () => {
    const policy = byName().headers.keyPolicy
    expect(policy?.keyNoun).toBe('header')
    expect(policy?.caseInsensitive).toBe(true)
    expect(policy?.blockedKeys).toEqual({ 'content-length': CONTENT_LENGTH_BLOCKED })
  })

  it('carries no mode-owned key rules (mode-conflict model retired)', () => {
    expect(byName().headers.keyPolicy).not.toHaveProperty('ownedKeysByMode')
  })

  it('carries no per-entry kind machinery on any map param', () => {
    for (const name of ['headers', 'query_params', 'form_fields']) {
      expect(byName()[name]).not.toHaveProperty('entryKinds')
    }
  })

  it('keeps query_params free of any key policy', () => {
    expect(byName().query_params.keyPolicy).toBeUndefined()
  })
})

describe('headers scaffolds', () => {
  it('declares only the + Content-Type menu (the + Auth scaffold is gone)', () => {
    const menus = byName().headers.quickInserts ?? []
    expect(menus.map((m) => m.label)).toEqual(['+ Content-Type'])
  })

  it('lists the wireframe media types and Custom…, always visible, never focus-stealing', () => {
    const ct = (byName().headers.quickInserts ?? [])[0]
    expect(ct.items.map((i) => i.label)).toEqual([
      'application/json',
      'application/xml',
      'text/plain',
      'text/html',
      'application/yaml',
      'application/octet-stream',
      'Custom…',
    ])
    for (const item of ct.items) {
      expect(item.key).toBe('Content-Type')
      if (item.label === 'Custom…') {
        expect(item.value).toBe('')
        expect(item.sublabel).toBe('empty row, key prefilled')
      } else {
        expect(item.value).toBe(item.label)
      }
    }
    expect(ct).not.toHaveProperty('hideWhen')
    expect(ct).not.toHaveProperty('focusExisting')
  })
})

describe('Body section', () => {
  it('declares the four body modes with text default and no expression toggle', () => {
    const p = byName().body_mode
    expect(p.type).toBe('string')
    expect(p.required).toBe(false)
    expect(p.enumValues).toEqual(['text', 'form', 'multipart', 'file'])
    expect(p.defaultValue).toBe('text')
    expect(p.noExpression).toBe(true)
    expect(p.enumLabels).toEqual({
      text: 'Text',
      form: 'Form (URL-encoded)',
      multipart: 'Multipart (form-data)',
      file: 'File',
    })
    expect(p.enumSublabels).toEqual({ multipart: 'file upload', file: 'file as body' })
  })

  it('gates the per-mode rows by body_mode and keeps them draft-retained', () => {
    const params = byName()
    expect(params.body.showWhen).toEqual({ field: 'body_mode', values: ['text'] })
    expect(params.body.contentTypeAdvisory).toBe(true)
    expect(params.form_fields.showWhen).toEqual({ field: 'body_mode', values: ['form'] })
    expect(params.form_fields.type).toBe('map')
    expect(params.parts.showWhen).toEqual({ field: 'body_mode', values: ['multipart'] })
    expect(params.parts.type).toBe('array')
    expect(params.parts.partsEditor).toBe(true)
    expect(params.file_source.showWhen).toEqual({ field: 'body_mode', values: ['file'] })
    expect(params.file_source.requiredWhen).toEqual({ field: 'body_mode', values: ['file'] })
    expect(params.file_source.placeholder).toBe(FILE_SOURCE_PLACEHOLDER)
    for (const name of ['body', 'form_fields', 'parts', 'file_source', 'file_content_type']) {
      expect(params[name].retainOnHide, `${name}.retainOnHide`).toBe(true)
    }
  })

  it('declares file_content_type as the file-mode Type enum defaulting to auto', () => {
    const p = byName().file_content_type
    expect(p.label).toBe('Type')
    expect(p.enumValues).toEqual([
      'auto',
      'application/json',
      'application/xml',
      'text/plain',
      'text/html',
      'application/yaml',
      'application/octet-stream',
    ])
    expect(p.defaultValue).toBe('auto')
    expect(p.noExpression).toBe(true)
    expect(p.showWhen).toEqual({ field: 'body_mode', values: ['file'] })
    expect(p.enumLabels).toEqual({ auto: 'Auto' })
  })

  it('declares body_auto_headers checked by default, no-expression, locked under multipart', () => {
    const p = byName().body_auto_headers
    expect(p.label).toBe('Auto Headers')
    expect(p.type).toBe('boolean')
    expect(p.defaultValue).toBe(true)
    expect(p.noExpression).toBe(true)
    expect(p.showWhen).toBeUndefined()
    expect(p.lockedWhen).toEqual({ field: 'body_mode', values: ['multipart'], value: true })
  })

  it('carries the generated-header notes on form and multipart rows only', () => {
    const params = byName()
    expect(params.form_fields.note).toBe(
      'Content-Type: application/x-www-form-urlencoded - set automatically; with body headers off, the transport default applies',
    )
    expect(params.parts.note).toBe(
      'Content-Type: multipart/form-data; boundary=(generated) - set automatically',
    )
    expect(params.file_source.note).toBeUndefined()
  })

  it('browses for the file sent as the body (TDATA-10)', () => {
    expect(fileRef(byName().file_source).fileReference).toBe('file')
    expect(fileRef(byName().file_source).fileReferenceArtifactsOnly).toBeUndefined()
  })

  it('puts the picker on File Source and File Path and nowhere else', () => {
    const withPicker = inputs().filter((p) => fileRef(p).fileReference !== undefined)
    expect(withPicker.map((p) => p.name)).toEqual(['file_source', 'file_path'])
  })
})

describe('body area visibility matrix', () => {
  it('text mode shows only the Body row', () => {
    const values = { body_mode: 'text' }
    expect(visible('body', values)).toBe(true)
    expect(visible('form_fields', values)).toBe(false)
    expect(visible('parts', values)).toBe(false)
    expect(visible('file_source', values)).toBe(false)
    expect(visible('file_content_type', values)).toBe(false)
  })

  it('form mode shows only Form Fields', () => {
    const values = { body_mode: 'form' }
    expect(visible('body', values)).toBe(false)
    expect(visible('form_fields', values)).toBe(true)
  })

  it('multipart mode shows only Parts', () => {
    const values = { body_mode: 'multipart' }
    expect(visible('parts', values)).toBe(true)
    expect(visible('body', values)).toBe(false)
  })

  it('file mode shows File Source and its Type row', () => {
    const values = { body_mode: 'file' }
    expect(visible('file_source', values)).toBe(true)
    expect(visible('file_content_type', values)).toBe(true)
    expect(visible('body', values)).toBe(false)
  })

  it('GET shows the Body row via the text default (GET-with-body)', () => {
    expect(visible('body', { method: 'GET' })).toBe(true)
    expect(visible('body_mode', { method: 'GET' })).toBe(true)
  })
})

describe('Response group', () => {
  it('declares response_mode as a required no-expression body/file enum defaulting to body', () => {
    const p = byName().response_mode
    expect(p.required).toBe(true)
    expect(p.enumValues).toEqual(['body', 'file'])
    expect(p.defaultValue).toBe('body')
    expect(p.noExpression).toBe(true)
  })

  it('shows file_path only in file mode', () => {
    const p = byName().file_path
    expect(p.showWhen).toEqual({ field: 'response_mode', values: ['file'] })
    expect(visible('file_path', {})).toBe(false)
    expect(visible('file_path', { response_mode: 'file' })).toBe(true)
  })

  it('names the download target File Path and browses for a save target (TDATA-10)', () => {
    const p = byName().file_path
    expect(p.label).toBe('File Path')
    expect(p.type).toBe('string')
    expect(p.required).toBe(false)
    expect(p.allowedFormats).toEqual(['plain'])
    expect(fileRef(p).fileReference).toBe('save-as')
    expect(fileRef(p).fileReferenceArtifactsOnly).toBeUndefined()
    expect(p.description).toBe(
      'Where the download is saved: artifact:// or an absolute or relative path where the block runs; empty keeps the automatic name and location',
    )
  })

  it('retires the File Name descriptor - the path replaces it, with no alias', () => {
    expect(inputs().map((p) => p.name)).not.toContain('file_name')
    expect(byName().file_name).toBeUndefined()
  })

  it('declares max_size in bytes with no default (mode-dependent empty semantics)', () => {
    const p = byName().max_size
    expect(p.type).toBe('integer')
    expect(p.required).toBe(false)
    expect(p.defaultValue).toBeUndefined()
    expect(visible('max_size', {})).toBe(true)
  })
})

describe('TLS / Certificates group', () => {
  it('keeps the certificate rows with client_key sealed', () => {
    const params = byName()
    expect(params.verify_ssl.defaultValue).toBe(true)
    expect(params.client_cert.secret).toBeFalsy()
    expect(params.client_key.secret).toBe(true)
  })

  it.each([
    ['tls_min_version', '1.2'],
    ['tls_max_version', '1.3'],
  ])('%s spans 1.0-1.3 defaulting to %s with TLS-prefixed labels', (name, defaultValue) => {
    const p = byName()[name]
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

  it('labels the version rows Min TLS Version and Max TLS Version', () => {
    expect(byName().tls_min_version.label).toBe('Min TLS Version')
    expect(byName().tls_max_version.label).toBe('Max TLS Version')
  })

  it('carries the min-not-above-max rule as data with the exact message', () => {
    expect(byName().tls_min_version.notAbove).toEqual({
      field: 'tls_max_version',
      message: TLS_ORDER,
    })
    expect(byName().tls_max_version.notAbove).toBeUndefined()
  })

  it('clamps the version selects against each other on change (min raises max, max lowers min)', () => {
    expect(byName().tls_min_version.clampsSibling).toEqual({
      field: 'tls_max_version',
      keep: 'atLeast',
    })
    expect(byName().tls_max_version.clampsSibling).toEqual({
      field: 'tls_min_version',
      keep: 'atMost',
    })
  })

  it('declares cipher_suites as an ordered array edited through the cipher picker', () => {
    const p = byName().cipher_suites
    expect(p.label).toBe('Cipher Suites')
    expect(p.type).toBe('array')
    expect(p.required).toBe(false)
    // No default: unset = every suite of the TLS versions, [] = zero ciphers (distinct states).
    expect(p.defaultValue).toBeUndefined()
    expect(p.cipherPicker).toBe(true)
    expect(p.description).toBe(
      'Cipher suites offered to the server, in client preference order per protocol family. ' +
        'Unset offers every suite WAVE supports for the selected TLS version range; ' +
        'an empty selection offers no ciphers. ' +
        'OpenSSL and IANA names accepted',
    )
  })
})

describe('Connection group (HTTP-13)', () => {
  it('declares proxy_mode wave-setting/off defaulting to wave-setting without expressions', () => {
    const p = byName().proxy_mode
    expect(p.label).toBe('Proxy')
    expect(p.type).toBe('string')
    expect(p.required).toBe(false)
    expect(p.enumValues).toEqual(['wave-setting', 'off'])
    expect(p.defaultValue).toBe('wave-setting')
    expect(p.noExpression).toBe(true)
  })

  it('labels the two choices "WAVE setting" and "Off"', () => {
    expect(byName().proxy_mode.enumLabels).toEqual({ 'wave-setting': 'WAVE setting', off: 'Off' })
  })

  it('carries the exact Proxy help text', () => {
    expect(byName().proxy_mode.description).toBe(PROXY_HELP)
  })

  it('locks the Proxy row on a remote host behind the remote display text', () => {
    const p = byName().proxy_mode
    expect(p.lockedOnRemoteHost).toEqual({ displayText: PROXY_REMOTE_TEXT })
    expect(p.lockedWhen).toBeUndefined()
  })

  it('locks no other row on a remote host', () => {
    expect(inputs().filter((p) => p.lockedOnRemoteHost !== undefined).map((p) => p.name)).toEqual([
      'proxy_mode',
    ])
  })

  it('declares no proxy_url row and no Proxy URL required message', () => {
    expect(byName().proxy_url).toBeUndefined()
    expect(inputs().map((p) => p.label)).not.toContain('Proxy URL')
    expect(inputs().map((p) => p.requiredMessage)).not.toContain(
      'Proxy mode "explicit" requires a Proxy URL',
    )
  })

  it.each(['wave-setting', 'off'])('shows no extra Connection row while proxy_mode is %s', (mode) => {
    const shown = inputs()
      .filter((p) => p.group === 'Connection' && visible(p.name, { proxy_mode: mode }))
      .map((p) => p.name)
    expect(shown).toEqual(['allow_redirects', 'max_redirects', 'proxy_mode'])
  })

  it('keeps the redirect rows unchanged and declares no http2 row (HTTP/1.1 only)', () => {
    const params = byName()
    expect(params.allow_redirects.defaultValue).toBe(true)
    expect(params.max_redirects.defaultValue).toBe(10)
    expect(params.http2).toBeUndefined()
  })
})

describe('outputs', () => {
  it('keeps the full output surface with size, sha256, and trace', () => {
    const outputs = outputsByName()
    expect(Object.keys(outputs)).toEqual([
      'status_code',
      'body',
      'headers',
      'content_type',
      'response_time',
      'final_url',
      'size',
      'sha256',
      'trace',
    ])
    expect(outputs.size.type).toBe('integer')
    expect(outputs.sha256.type).toBe('string')
    expect(outputs.trace.type).toBe('map')
  })

  it('describes every output for the (i) tooltip and documents the file-mode path meaning', () => {
    const outputs = outputsByName()
    for (const output of Object.values(outputs)) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
    expect(outputs.body.description ?? '').toMatch(/path/i)
  })
})
