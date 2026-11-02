/**
 * Helm Status plugin parameter schema tests (HELM-1, HELM-6, HELM-9).
 *
 * Status is the read of the family: a release, current or by revision, into
 * Result and into the scalar Wait Until polls. Its Timeout is WAVE's bound on
 * the read, not helm's operation timeout, so the Connection footer keeps the
 * family wording and the timeout starts at 30 seconds.
 */

import { describe, it, expect } from 'vitest'
import { Activity } from 'lucide-react'
import { getGroupMeta, getOutputParams } from '@/features/workbench/lib/node-parameters'
import {
  ADVANCED_FOOTER,
  CONNECTION_PARAMS,
  CONNECTION_REQUEST_TIMEOUT_FOOTER,
  FAILURE_FOOTER,
  REQUEST_TIMEOUT_DESCRIPTION,
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
  outputsByName,
  paramNames,
  visibleInGroup,
  visibleNames,
  visibleOutputs,
} from './_helm-cases'

const ID = 'helm-status'

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
  'on_error',
]

const STATUS_PARAMS = ['release', 'revision', 'output_format']
const ADVANCED_PARAMS = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']

const GROUP_ORDER = ['Connection', 'Status', 'Advanced', 'Failure Handling']

const DEFAULTS: Record<string, unknown> = {
  timeout: 30,
  output_format: 'table',
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
  'create_namespace',
  'atomic',
  'cleanup_on_fail',
  'cleanup_timeout',
]

describe('registration', () => {
  it('registers helm-status in the three schema maps', () => {
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

  it('carries the drawn defaults', () => {
    const inputs = inputsByName(ID)
    for (const [name, value] of Object.entries(DEFAULTS)) {
      expect(inputs[name].defaultValue, `default of ${name}`).toBe(value)
    }
  })

  it('says an empty Revision means the current one, in the description and not a hint', () => {
    const revision = inputsByName(ID).revision
    expect(revision.type).toBe('integer')
    expect(revision.required).toBe(false)
    expect(revision.description).toBe('The revision to read. Leave empty to read the current one.')
    expect(revision.placeholder).toBeUndefined()
  })

  it('keeps the family wording on the timeout row', () => {
    expect(inputsByName(ID).timeout.description).toBe(REQUEST_TIMEOUT_DESCRIPTION)
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

  it('carries no wait row under any name', () => {
    expectNoWaitRow(ID)
  })

  it('carries none of the write-side rows', () => {
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
  it('orders the groups Connection, then Status, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the release and revision under Status', () => {
    expect(visibleInGroup(ID, 'Status', {})).toEqual(STATUS_PARAMS)
  })

  it('files the overrides under Advanced', () => {
    expect(visibleInGroup(ID, 'Advanced', {})).toEqual(ADVANCED_PARAMS)
  })

  it('carries On error alone in Failure Handling', () => {
    expect(visibleInGroup(ID, 'Failure Handling', {})).toEqual(['on_error'])
  })

  it('keeps the family Connection footer', () => {
    expect(getGroupMeta(ID)?.['Connection'].description).toBe(CONNECTION_REQUEST_TIMEOUT_FOOTER)
  })

  it('carries the drawn group footers', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(meta['Status'].description).toBe('Release to read')
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Status only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Status',
    ])
  })
})

describe('connection and tail', () => {
  it('opens with the session and a 30 second read bound', () => {
    expectConnectionRows(ID, 30)
  })

  it('closes with the family Advanced tail and Failure Handling enum', () => {
    expectFamilyTail(ID)
  })

  it('offers the four output formats and starts on Table', () => {
    expectOutputFormatRow(ID, 'Status')
  })
})

describe('visibility', () => {
  it('shows every row on a fresh block', () => {
    expect(visibleNames(ID, {})).toEqual(PARAM_ORDER)
  })

  it('gates no input row at all', () => {
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

  it('reports the release state as a plain string Wait Until can poll', () => {
    const status = outputsByName(ID).status
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

  it('declares typeWhen on Result and nowhere else', () => {
    const withRules = (getOutputParams(ID) ?? [])
      .filter((o) => o.typeWhen !== undefined)
      .map((o) => o.name)
    expect(withRules).toEqual(['result'])
  })
})

describe('palette + icon wiring', () => {
  it('defines the Helm Status palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Status', 'Activity', Activity, 'activity')
  })
})
