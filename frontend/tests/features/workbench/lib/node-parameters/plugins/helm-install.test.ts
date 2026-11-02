/**
 * Helm Install plugin parameter schema tests (HELM-1, HELM-2, HELM-5, HELM-6, HELM-8).
 *
 * Install is the widest Helm sheet: the chart-source rows, a chart-repository
 * Auth & TLS group of its own, Create Namespace directly under Namespace, and
 * Atomic in Failure Handling. There is no wait row anywhere on it, and Result
 * starts as a Table and follows Output Format from there.
 */

import { describe, it, expect } from 'vitest'
import { PackagePlus } from 'lucide-react'
import { getGroupMeta, getInputParams, getOutputParams } from '@/features/workbench/lib/node-parameters'
import {
  ADVANCED_FOOTER,
  AUTH_FOOTER,
  AUTH_PARAMS,
  CONNECTION_HELM_TIMEOUT_FOOTER,
  CONNECTION_PARAMS,
  FAILURE_FOOTER,
  RECORD_GATE,
  expectConnectionRows,
  expectFamilyTail,
  expectLabelsAndTypes,
  expectChartBrowses,
  expectNoStrayKeys,
  expectNoWaitRow,
  expectOutputCore,
  expectOutputFormatRow,
  expectPaletteWiring,
  expectRegistered,
  expectResultOutput,
  groupOrder,
  inputsByName,
  outputNames,
  outputsByName,
  paramNames,
  visibleInGroup,
  visibleNames,
  visibleOutputs,
} from './_helm-cases'

const ID = 'helm-install'

const HELM_PATH_HELP =
  "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH"

const REPO_CA_CERT_HELP =
  "The PEM bundle that verifies the chart repository's certificate; when set, it is the only certificate trusted. Empty trusts the certificates WAVE trusts (Settings > Network > Certificates)."

const PARAM_ORDER = [
  'session',
  'timeout',
  'release',
  'chart',
  'version',
  'repo',
  'values',
  'set',
  'output_format',
  'repo_username',
  'repo_password',
  'repo_ca_cert',
  'repo_verify_ssl',
  'namespace',
  'create_namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
  'atomic',
  'cleanup_timeout',
  'on_error',
]

const INSTALL_PARAMS = ['release', 'chart', 'version', 'repo', 'values', 'set', 'output_format']
const ADVANCED_PARAMS = [
  'namespace',
  'create_namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
]
const FAILURE_PARAMS = ['atomic', 'on_error']

const GROUP_ORDER = ['Connection', 'Install', 'Auth & TLS', 'Advanced', 'Failure Handling']

const REQUIRED_PARAMS = ['session', 'release', 'chart']

const DEFAULTS: Record<string, unknown> = {
  timeout: 300,
  output_format: 'table',
  repo_verify_ssl: true,
  create_namespace: false,
  atomic: false,
  cleanup_timeout: 300,
  on_error: 'fail',
}

const WITHOUT_CLEANUP_TIMEOUT = PARAM_ORDER.filter((name) => name !== 'cleanup_timeout')

const PLACEHOLDERS: Record<string, string> = {
  chart: 'nginx',
  version: '1.2.3',
  repo: 'https://charts.example.com',
  helm_path: 'helm',
}


const NO_EXPRESSION_PARAMS = ['output_format', 'on_error']

const OUTPUT_ORDER = ['result', 'status', 'success', 'error', 'reason']

describe('registration', () => {
  it('registers helm-install in the three schema maps', () => {
    expectRegistered(ID)
  })
})

describe('rows', () => {
  it('declares the rows in the drawn order', () => {
    expect(paramNames(ID)).toEqual(PARAM_ORDER)
  })

  it('labels and types every row as the sheet names it', () => {
    expectLabelsAndTypes(ID, PARAM_ORDER)
  })

  it('requires only the session, the release name and the chart', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].required)).toEqual(REQUIRED_PARAMS)
  })

  it('carries the drawn defaults', () => {
    const inputs = inputsByName(ID)
    for (const [name, value] of Object.entries(DEFAULTS)) {
      expect(inputs[name].defaultValue, `default of ${name}`).toBe(value)
    }
  })

  it('leaves every other row without a default', () => {
    const inputs = inputsByName(ID)
    const withDefault = PARAM_ORDER.filter((n) => inputs[n].defaultValue !== undefined)
    expect(withDefault).toEqual(Object.keys(DEFAULTS))
  })

  it('carries the drawn placeholders', () => {
    const inputs = inputsByName(ID)
    for (const [name, value] of Object.entries(PLACEHOLDERS)) {
      expect(inputs[name].placeholder, `placeholder of ${name}`).toBe(value)
    }
  })

  it('places the placeholder on those rows only', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].placeholder)).toEqual(Object.keys(PLACEHOLDERS))
  })

  it('declares the repository password as a secret', () => {
    expect(inputsByName(ID).repo_password.secret).toBe(true)
  })

  it('declares no other secret row beside the session', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].secret)).toEqual(['session', 'repo_password'])
  })

  it('hides the expression toggle on the rows that gate the sheet', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].noExpression)).toEqual(NO_EXPRESSION_PARAMS)
  })

  it('gives every row a description', () => {
    const inputs = inputsByName(ID)
    for (const name of PARAM_ORDER) {
      expect(inputs[name].description, `description of ${name}`).toBeTruthy()
    }
  })

  it('declares no key the family never uses', () => {
    expectNoStrayKeys(ID)
  })

  it('browses for the chart (TDATA-10)', () => {
    expectChartBrowses(ID)
  })

  it('carries no wait row under any name', () => {
    expectNoWaitRow(ID)
  })

  it('says what helm does with the timeout', () => {
    expect(inputsByName(ID).timeout.description).toMatch(/helm/)
  })

  it('does not say the namespace is read from anywhere', () => {
    expect(inputsByName(ID).namespace.description).not.toMatch(/read from/)
  })
})

describe('help copy', () => {
  it('says a relative Helm Path starts at the home folder of the account the block runs as (REQ-3.4.3.12)', () => {
    expect(inputsByName(ID).helm_path.description).toBe(HELM_PATH_HELP)
  })

  it('says a set Repository CA Certificate is the only certificate trusted (REQ-4.5.16)', () => {
    expect(inputsByName(ID).repo_ca_cert.description).toBe(REPO_CA_CERT_HELP)
  })
})

describe('groups', () => {
  it('orders the groups Connection, then Install, Auth & TLS, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the chart rows under Install', () => {
    expect(visibleInGroup(ID, 'Install', {})).toEqual(INSTALL_PARAMS)
  })

  it('files the repository credentials under Auth & TLS', () => {
    expect(visibleInGroup(ID, 'Auth & TLS', {})).toEqual(AUTH_PARAMS)
  })

  it('files the overrides under Advanced', () => {
    expect(visibleInGroup(ID, 'Advanced', {})).toEqual(ADVANCED_PARAMS)
  })

  it('files Atomic beside On error under Failure Handling', () => {
    expect(visibleInGroup(ID, 'Failure Handling', {})).toEqual(FAILURE_PARAMS)
  })

  it('says the Connection timeout is helms own operation timeout', () => {
    expect(getGroupMeta(ID)?.['Connection'].description).toBe(CONNECTION_HELM_TIMEOUT_FOOTER)
  })

  it('carries the drawn group footers', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(meta['Install'].description).toBe('Chart, release and values')
    expect(meta['Auth & TLS'].description).toBe(AUTH_FOOTER)
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Install only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Install',
    ])
  })
})

describe('connection and tail', () => {
  it('opens with the session and a 300 second timeout', () => {
    expectConnectionRows(ID, 300)
  })

  it('closes with the family Advanced tail and Failure Handling enum', () => {
    expectFamilyTail(ID)
  })

  it('offers the four output formats and starts on Table', () => {
    expectOutputFormatRow(ID, 'Install')
  })
})

describe('visibility', () => {
  it('shows every row but the cleanup room on a fresh block', () => {
    expect(visibleNames(ID, {})).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('keeps the same rows visible under Record and continue', () => {
    expect(visibleNames(ID, { on_error: 'record' })).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('shows the cleanup room once Atomic is ticked', () => {
    expect(visibleNames(ID, { atomic: true })).toEqual(PARAM_ORDER)
  })

  it('hides the cleanup room again when Atomic goes off', () => {
    expect(visibleNames(ID, { atomic: false })).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('gates the cleanup room on Atomic alone', () => {
    expect(inputsByName(ID).cleanup_timeout.showWhenAny).toEqual([
      { field: 'atomic', values: ['true'] },
    ])
  })

  it('never keeps a cleanup room the block cannot use', () => {
    expect(inputsByName(ID).cleanup_timeout.retainOnHide).toBeUndefined()
  })

  it('shows Create Namespace without any condition', () => {
    expect(inputsByName(ID).create_namespace.showWhen).toBeUndefined()
  })
})

describe('outputs', () => {
  it('declares Result, Status and the output core', () => {
    expect(outputNames(ID)).toEqual(OUTPUT_ORDER)
  })

  it('follows Output Format on Result', () => {
    expectResultOutput(ID)
  })

  it('reports the release state as a plain string', () => {
    const status = outputsByName(ID).status
    expect(status.label).toBe('Status')
    expect(status.type).toBe('string')
    expect(status.typeWhen).toBeUndefined()
  })

  it('gates Error and Reason on Record and continue', () => {
    expectOutputCore(ID)
  })

  it('offers Result, Status and Success while On error is Fail the block', () => {
    expect(visibleOutputs(ID, {})).toEqual(['result', 'status', 'success'])
  })

  it('offers all five outputs under Record and continue', () => {
    expect(visibleOutputs(ID, { on_error: 'record' })).toEqual(OUTPUT_ORDER)
  })

  it('gates Error and Reason and no other output', () => {
    const gated = (getOutputParams(ID) ?? [])
      .filter((o) => o.showWhen !== undefined)
      .map((o) => o.name)
    expect(gated).toEqual(['error', 'reason'])
    expect(outputsByName(ID).error.showWhen).toEqual(RECORD_GATE)
  })

  it('declares no revision output', () => {
    expect(outputsByName(ID).revision).toBeUndefined()
  })

  it('gives every output a description', () => {
    for (const output of getOutputParams(ID) ?? []) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('declares typeWhen on Result and nowhere else', () => {
    const withRules = (getOutputParams(ID) ?? [])
      .filter((o) => o.typeWhen !== undefined)
      .map((o) => o.name)
    expect(withRules).toEqual(['result'])
  })
})

describe('palette + icon wiring', () => {
  it('defines the Helm Install palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Install', 'PackagePlus', PackagePlus, 'package-plus')
  })

  it('declares exactly the rows the config sheet renders', () => {
    expect(getInputParams(ID)).toHaveLength(PARAM_ORDER.length)
  })
})

describe('plain-text rows', () => {
  it('locks Repository URL to plain text, so its editor has no Format picker', () => {
    const repo = (getInputParams(ID) ?? []).find((row) => row.name === 'repo')
    expect(repo?.allowedFormats).toEqual(['plain'])
  })
})
