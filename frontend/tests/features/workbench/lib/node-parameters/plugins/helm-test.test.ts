/**
 * Helm Test plugin parameter schema tests (HELM-1, HELM-7, HELM-9).
 *
 * Test runs the chart's test hooks and reports one Result row per hook. The Logs
 * output is offered for binding only while the Logs toggle is on, so an author
 * who never asks for logs never sees a Logs variable to bind.
 */

import { describe, it, expect } from 'vitest'
import { FlaskConical } from 'lucide-react'
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
  outputsByName,
  paramNames,
  visibleInGroup,
  visibleNames,
  visibleOutputs,
} from './_helm-cases'

const ID = 'helm-test'

const HELM_PATH_HELP =
  "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH"

const PARAM_ORDER = [
  'session',
  'timeout',
  'release',
  'logs',
  'output_format',
  'namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const TEST_PARAMS = ['release', 'logs', 'output_format']
const ADVANCED_PARAMS = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']

const GROUP_ORDER = ['Connection', 'Test', 'Advanced', 'Failure Handling']

const DEFAULTS: Record<string, unknown> = {
  timeout: 300,
  logs: false,
  output_format: 'table',
  on_error: 'fail',
}

const NO_EXPRESSION_PARAMS = ['logs', 'output_format', 'on_error']

const LOGS_GATE = { field: 'logs', values: ['true'] }

const OUTPUT_ORDER = ['result', 'logs', 'success', 'error', 'reason']

describe('registration', () => {
  it('registers helm-test in the three schema maps', () => {
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

  it('starts the Logs toggle off', () => {
    const logs = inputsByName(ID).logs
    expect(logs.type).toBe('boolean')
    expect(logs.defaultValue).toBe(false)
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

  it('carries no filter row', () => {
    expect(paramNames(ID).filter((n) => n.includes('filter'))).toEqual([])
  })
})

describe('help copy', () => {
  it('says a relative Helm Path starts at the home folder of the account the block runs as (REQ-3.4.3.12)', () => {
    expect(inputsByName(ID).helm_path.description).toBe(HELM_PATH_HELP)
  })
})

describe('groups', () => {
  it('orders the groups Connection, then Test, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the release, Logs and Output Format under Test', () => {
    expect(visibleInGroup(ID, 'Test', {})).toEqual(TEST_PARAMS)
  })

  it('files the overrides under Advanced', () => {
    expect(visibleInGroup(ID, 'Advanced', {})).toEqual(ADVANCED_PARAMS)
  })

  it('carries On error alone in Failure Handling', () => {
    expect(visibleInGroup(ID, 'Failure Handling', {})).toEqual(['on_error'])
  })

  it('carries the drawn group footers', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(meta['Connection'].description).toBe(CONNECTION_HELM_TIMEOUT_FOOTER)
    expect(meta['Test'].description).toBe("Run the chart's test hooks")
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Test only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Test',
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
    expectOutputFormatRow(ID, 'Test')
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
  it('declares Result, Logs and the output core', () => {
    expect(outputNames(ID)).toEqual(OUTPUT_ORDER)
  })

  it('follows Output Format on Result', () => {
    expectResultOutput(ID)
  })

  it('offers Logs only while the Logs toggle is on', () => {
    const logs = outputsByName(ID).logs
    expect(logs.label).toBe('Logs')
    expect(logs.type).toBe('string')
    expect(logs.showWhen).toEqual(LOGS_GATE)
  })

  it('declares no Status scalar', () => {
    expect(outputsByName(ID).status).toBeUndefined()
  })

  it('gates Error and Reason on Record and continue', () => {
    expectOutputCore(ID)
  })

  it('offers Result and Success on a fresh block', () => {
    expect(visibleOutputs(ID, {})).toEqual(['result', 'success'])
  })

  it('adds Logs once the toggle is on', () => {
    expect(visibleOutputs(ID, { logs: true })).toEqual(['result', 'logs', 'success'])
  })

  it('offers every output under Record and continue with Logs on', () => {
    expect(visibleOutputs(ID, { logs: true, on_error: 'record' })).toEqual(OUTPUT_ORDER)
  })

  it('declares typeWhen on Result and nowhere else', () => {
    const withRules = (getOutputParams(ID) ?? [])
      .filter((o) => o.typeWhen !== undefined)
      .map((o) => o.name)
    expect(withRules).toEqual(['result'])
  })
})

describe('palette + icon wiring', () => {
  it('defines the Helm Test palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Test', 'FlaskConical', FlaskConical, 'flask-conical')
  })
})
