/**
 * Helm Rollback plugin parameter schema tests (HELM-1, HELM-2, HELM-6).
 *
 * Rollback names a release and, optionally, the revision to go back to; empty
 * means the revision before the current one. There is no chart, so no Auth & TLS
 * group and no Create Namespace, and helm rollback has no atomic flag - only
 * Cleanup on Fail sits above On error.
 */

import { describe, it, expect } from 'vitest'
import { Undo2 } from 'lucide-react'
import { getGroupMeta, getOutputParams } from '@/features/workbench/lib/node-parameters'
import {
  ADVANCED_FOOTER,
  CONNECTION_HELM_TIMEOUT_FOOTER,
  CONNECTION_PARAMS,
  FAILURE_FOOTER,
  expectConnectionRows,
  expectFamilyTail,
  expectLabelsAndTypes,
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

const ID = 'helm-rollback'

const HELM_PATH_HELP =
  "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH"

const PARAM_ORDER = [
  'session',
  'timeout',
  'release',
  'revision',
  'output_format',
  'namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
  'cleanup_on_fail',
  'cleanup_timeout',
  'on_error',
]

const ROLLBACK_PARAMS = ['release', 'revision', 'output_format']
const ADVANCED_PARAMS = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']
const FAILURE_PARAMS = ['cleanup_on_fail', 'on_error']

const GROUP_ORDER = ['Connection', 'Rollback', 'Advanced', 'Failure Handling']

const DEFAULTS: Record<string, unknown> = {
  timeout: 300,
  output_format: 'table',
  cleanup_on_fail: false,
  cleanup_timeout: 300,
  on_error: 'fail',
}

const NO_EXPRESSION_PARAMS = ['output_format', 'on_error']

const OUTPUT_ORDER = ['result', 'status', 'success', 'error', 'reason']

const ABSENT_ROWS = [
  'chart',
  'version',
  'repo',
  'values',
  'set',
  'repo_username',
  'repo_password',
  'repo_ca_cert',
  'repo_verify_ssl',
  'create_namespace',
  'atomic',
]

describe('registration', () => {
  it('registers helm-rollback in the three schema maps', () => {
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

  it('requires only the session and the release name', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].required)).toEqual(['session', 'release'])
  })

  it('leaves Revision optional with no default', () => {
    const revision = inputsByName(ID).revision
    expect(revision.type).toBe('integer')
    expect(revision.required).toBe(false)
    expect(revision.defaultValue).toBeUndefined()
  })

  it('says an empty Revision means the previous one, in the description and not a hint', () => {
    const revision = inputsByName(ID).revision
    expect(revision.description).toBe(
      'The revision to go back to. Leave empty to go back to the revision before the current one.'
    )
    expect(revision.placeholder).toBeUndefined()
  })

  it('carries the drawn defaults', () => {
    const inputs = inputsByName(ID)
    for (const [name, value] of Object.entries(DEFAULTS)) {
      expect(inputs[name].defaultValue, `default of ${name}`).toBe(value)
    }
  })

  it('hides the expression toggle on the rows that gate the sheet', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].noExpression)).toEqual(NO_EXPRESSION_PARAMS)
  })

  it('declares the session as the only secret row', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].secret)).toEqual(['session'])
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

  it('carries no wait row under any name', () => {
    expectNoWaitRow(ID)
  })

  it('carries none of the chart, repository or atomic rows', () => {
    const inputs = inputsByName(ID)
    for (const name of ABSENT_ROWS) {
      expect(inputs[name], `row ${name}`).toBeUndefined()
    }
  })
})

describe('help copy', () => {
  it('says a relative Helm Path starts at the home folder of the account the block runs as (REQ-3.4.3.12)', () => {
    expect(inputsByName(ID).helm_path.description).toBe(HELM_PATH_HELP)
  })
})

describe('groups', () => {
  it('orders the groups Connection, then Rollback, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the release and revision under Rollback', () => {
    expect(visibleInGroup(ID, 'Rollback', {})).toEqual(ROLLBACK_PARAMS)
  })

  it('files the overrides under Advanced', () => {
    expect(visibleInGroup(ID, 'Advanced', {})).toEqual(ADVANCED_PARAMS)
  })

  it('files Cleanup on Fail above On error', () => {
    expect(visibleInGroup(ID, 'Failure Handling', {})).toEqual(FAILURE_PARAMS)
  })

  it('declares no Auth & TLS group', () => {
    expect(getGroupMeta(ID)?.['Auth & TLS']).toBeUndefined()
  })

  it('says the Connection timeout is helms own operation timeout', () => {
    expect(getGroupMeta(ID)?.['Connection'].description).toBe(CONNECTION_HELM_TIMEOUT_FOOTER)
  })

  it('carries the drawn group footers', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(meta['Rollback'].description).toBe('Release and target revision')
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Rollback only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Rollback',
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
    expectOutputFormatRow(ID, 'Rollback')
  })
})

describe('visibility', () => {
  const WITHOUT_CLEANUP_TIMEOUT = PARAM_ORDER.filter((name) => name !== 'cleanup_timeout')

  it('shows every row but the cleanup room on a fresh block', () => {
    expect(visibleNames(ID, {})).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('shows the cleanup room once Cleanup on Fail is ticked', () => {
    expect(visibleNames(ID, { cleanup_on_fail: true })).toEqual(PARAM_ORDER)
  })

  it('hides the cleanup room again when Cleanup on Fail goes off', () => {
    expect(visibleNames(ID, { cleanup_on_fail: false })).toEqual(WITHOUT_CLEANUP_TIMEOUT)
  })

  it('gates the cleanup room on Cleanup on Fail alone', () => {
    expect(inputsByName(ID).cleanup_timeout.showWhenAny).toEqual([
      { field: 'cleanup_on_fail', values: ['true'] },
    ])
  })

  it('gates no row on a single-field condition', () => {
    const inputs = inputsByName(ID)
    expect(PARAM_ORDER.filter((n) => inputs[n].showWhen)).toEqual([])
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
  it('defines the Helm Rollback palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Rollback', 'Undo2', Undo2, 'undo-2')
  })
})
