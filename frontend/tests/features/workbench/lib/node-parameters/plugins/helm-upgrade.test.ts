/**
 * Helm Upgrade plugin parameter schema tests (HELM-3, HELM-4, HELM-8).
 *
 * Upgrade is Install plus helm's values rules. Reuse Values and Reset Values
 * untick each other: both rows stay enabled, both may be off, never both on.
 * Create Namespace renders only while Install if missing is on, because that is
 * the only state in which helm applies it.
 */

import { describe, it, expect } from 'vitest'
import { CircleArrowUp } from 'lucide-react'
import { getGroupMeta, getOutputParams } from '@/features/workbench/lib/node-parameters'
import {
  ADVANCED_FOOTER,
  AUTH_FOOTER,
  AUTH_PARAMS,
  CONNECTION_HELM_TIMEOUT_FOOTER,
  CONNECTION_PARAMS,
  FAILURE_FOOTER,
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
  paramNames,
  visibleInGroup,
  visibleNames,
  visibleOutputs,
} from './_helm-cases'

const ID = 'helm-upgrade'

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
  'install',
  'reuse_values',
  'reset_values',
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
  'cleanup_on_fail',
  'cleanup_timeout',
  'on_error',
]

const UPGRADE_PARAMS = [
  'release',
  'chart',
  'version',
  'repo',
  'values',
  'set',
  'install',
  'reuse_values',
  'reset_values',
  'output_format',
]
const ADVANCED_CLOSED = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']
const ADVANCED_OPEN = [
  'namespace',
  'create_namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
]
const FAILURE_PARAMS = ['atomic', 'cleanup_on_fail', 'on_error']

const GROUP_ORDER = ['Connection', 'Upgrade', 'Auth & TLS', 'Advanced', 'Failure Handling']

const REQUIRED_PARAMS = ['session', 'release', 'chart']

/** Create Namespace is gated on Install if missing, so it is out of every fresh-sheet list. */
const WITH_CLEANUP_TIMEOUT = PARAM_ORDER.filter((name) => name !== 'create_namespace')
const WITHOUT_CLEANUP_TIMEOUT = WITH_CLEANUP_TIMEOUT.filter((name) => name !== 'cleanup_timeout')

const DEFAULTS: Record<string, unknown> = {
  timeout: 300,
  install: false,
  reuse_values: false,
  reset_values: false,
  output_format: 'table',
  repo_verify_ssl: true,
  create_namespace: false,
  atomic: false,
  cleanup_on_fail: false,
  cleanup_timeout: 300,
  on_error: 'fail',
}

const NO_EXPRESSION_PARAMS = [
  'install',
  'reuse_values',
  'reset_values',
  'output_format',
  'on_error',
]

const INSTALL_GATE = { field: 'install', values: ['true'] }

const OUTPUT_ORDER = ['result', 'status', 'success', 'error', 'reason']

describe('registration', () => {
  it('registers helm-upgrade in the three schema maps', () => {
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

  it('starts every values-rule toggle off', () => {
    const inputs = inputsByName(ID)
    for (const name of ['install', 'reuse_values', 'reset_values']) {
      expect(inputs[name].type, `type of ${name}`).toBe('boolean')
      expect(inputs[name].defaultValue, `default of ${name}`).toBe(false)
    }
  })

  it('hides the expression toggle on the rows that gate the sheet', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].noExpression)).toEqual(NO_EXPRESSION_PARAMS)
  })

  it('declares the repository password as a secret', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].secret)).toEqual(['session', 'repo_password'])
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
})

describe('the Reuse / Reset exclusion (HELM-4)', () => {
  it('points Reuse Values at Reset Values', () => {
    expect(inputsByName(ID).reuse_values.exclusiveWith).toEqual(['reset_values'])
  })

  it('points Reset Values at Reuse Values', () => {
    expect(inputsByName(ID).reset_values.exclusiveWith).toEqual(['reuse_values'])
  })

  it('declares the exclusion on that pair and nowhere else', () => {
    const inputs = inputsByName(ID)
    const paired = PARAM_ORDER.filter((n) => inputs[n].exclusiveWith)
    expect(paired).toEqual(['reuse_values', 'reset_values'])
  })

  it('never disables or hides either row', () => {
    const inputs = inputsByName(ID)
    for (const name of ['reuse_values', 'reset_values']) {
      expect(inputs[name].lockedWhen, `lockedWhen of ${name}`).toBeUndefined()
      expect(inputs[name].showWhen, `showWhen of ${name}`).toBeUndefined()
    }
  })

  it('keeps both rows visible while either one is ticked', () => {
    expect(visibleNames(ID, { reuse_values: true })).toContain('reset_values')
    expect(visibleNames(ID, { reset_values: true })).toContain('reuse_values')
  })
})

describe('the cleanup room (HELM-12)', () => {
  it('is hidden while neither cleanup flag is ticked', () => {
    expect(visibleNames(ID, {})).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('shows on Atomic alone', () => {
    expect(visibleNames(ID, { atomic: true })).toEqual(WITH_CLEANUP_TIMEOUT)
  })

  it('shows on Cleanup on Fail alone', () => {
    expect(visibleNames(ID, { cleanup_on_fail: true })).toEqual(WITH_CLEANUP_TIMEOUT)
  })

  it('shows once, not twice, with both ticked', () => {
    expect(visibleNames(ID, { atomic: true, cleanup_on_fail: true })).toEqual(
      WITH_CLEANUP_TIMEOUT,
    )
  })

  it('hides again when the last flag goes off', () => {
    expect(visibleNames(ID, { atomic: false, cleanup_on_fail: false })).toEqual(
      WITHOUT_CLEANUP_TIMEOUT,
    )
  })

  it('gates on either flag, never on both at once', () => {
    const cleanupTimeout = inputsByName(ID).cleanup_timeout
    expect(cleanupTimeout.showWhenAny).toEqual([
      { field: 'atomic', values: ['true'] },
      { field: 'cleanup_on_fail', values: ['true'] },
    ])
    expect(cleanupTimeout.showWhenAll).toBeUndefined()
    expect(cleanupTimeout.showWhen).toBeUndefined()
  })

  it('is never retained once it is hidden', () => {
    expect(inputsByName(ID).cleanup_timeout.retainOnHide).toBeUndefined()
  })
})

describe('the Create Namespace gate (HELM-8)', () => {
  it('shows Create Namespace only while Install if missing is on', () => {
    expect(inputsByName(ID).create_namespace.showWhen).toEqual(INSTALL_GATE)
  })

  it('hides it on a fresh block', () => {
    expect(visibleInGroup(ID, 'Advanced', {})).toEqual(ADVANCED_CLOSED)
  })

  it('shows it directly under Namespace once Install if missing is on', () => {
    expect(visibleInGroup(ID, 'Advanced', { install: true })).toEqual(ADVANCED_OPEN)
  })

  it('gates that row and no other', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].showWhen)).toEqual(['create_namespace'])
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
  it('orders the groups Connection, then Upgrade, Auth & TLS, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the chart and values rows under Upgrade', () => {
    expect(visibleInGroup(ID, 'Upgrade', {})).toEqual(UPGRADE_PARAMS)
  })

  it('files the repository credentials under Auth & TLS', () => {
    expect(visibleInGroup(ID, 'Auth & TLS', {})).toEqual(AUTH_PARAMS)
  })

  it('files Atomic and Cleanup on Fail above On error', () => {
    expect(visibleInGroup(ID, 'Failure Handling', {})).toEqual(FAILURE_PARAMS)
  })

  it('says the Connection timeout is helms own operation timeout', () => {
    expect(getGroupMeta(ID)?.['Connection'].description).toBe(CONNECTION_HELM_TIMEOUT_FOOTER)
  })

  it('carries the drawn group footers', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(meta['Upgrade'].description).toBe('Chart, release and values')
    expect(meta['Auth & TLS'].description).toBe(AUTH_FOOTER)
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Upgrade only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Upgrade',
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
    expectOutputFormatRow(ID, 'Upgrade')
  })
})

describe('outputs', () => {
  it('declares Result, Status and the output core', () => {
    expect(outputNames(ID)).toEqual(OUTPUT_ORDER)
  })

  it('follows Output Format on Result', () => {
    expectResultOutput(ID)
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

  it('declares typeWhen on Result and nowhere else', () => {
    const withRules = (getOutputParams(ID) ?? [])
      .filter((o) => o.typeWhen !== undefined)
      .map((o) => o.name)
    expect(withRules).toEqual(['result'])
  })
})

describe('palette + icon wiring', () => {
  it('defines the Helm Upgrade palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Upgrade', 'CircleArrowUp', CircleArrowUp, 'circle-arrow-up')
  })
})
