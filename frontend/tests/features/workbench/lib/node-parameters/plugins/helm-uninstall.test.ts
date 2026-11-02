/**
 * Helm Uninstall plugin parameter schema tests (HELM-1, HELM-2, HELM-10).
 *
 * Uninstall carries the three controls K8s Delete carries where helm has the
 * flag - Keep History, Ignore Not Found and Cascade - and reports the shared
 * output core alone. There is no release left to describe, so no Result, no
 * Status and no Output Format row.
 */

import { describe, it, expect } from 'vitest'
import { PackageMinus } from 'lucide-react'
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
  expectPaletteWiring,
  expectRegistered,
  groupOrder,
  inputsByName,
  outputNames,
  outputsByName,
  paramNames,
  visibleInGroup,
  visibleNames,
  visibleOutputs,
} from './_helm-cases'

const ID = 'helm-uninstall'

const HELM_PATH_HELP =
  "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH"

const PARAM_ORDER = [
  'session',
  'timeout',
  'release',
  'keep_history',
  'ignore_not_found',
  'cascade',
  'namespace',
  'helm_path',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const UNINSTALL_PARAMS = ['release', 'keep_history', 'ignore_not_found', 'cascade']
const ADVANCED_PARAMS = ['namespace', 'helm_path', 'impersonate_user', 'impersonate_groups']

const GROUP_ORDER = ['Connection', 'Uninstall', 'Advanced', 'Failure Handling']

const DEFAULTS: Record<string, unknown> = {
  timeout: 300,
  keep_history: false,
  ignore_not_found: false,
  cascade: 'background',
  on_error: 'fail',
}

const CASCADE_VALUES = ['background', 'foreground', 'orphan']

const NO_EXPRESSION_PARAMS = ['cascade', 'on_error']

const OUTPUT_ORDER = ['success', 'error', 'reason']

describe('registration', () => {
  it('registers helm-uninstall in the three schema maps', () => {
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

  it('offers helms three cascade modes, starting on background', () => {
    const cascade = inputsByName(ID).cascade
    expect(cascade.enumValues).toEqual(CASCADE_VALUES)
    expect(cascade.defaultValue).toBe('background')
  })

  it('labels the cascade values as K8s Delete does', () => {
    expect(inputsByName(ID).cascade.enumLabels).toEqual({
      background: 'Background',
      foreground: 'Foreground',
      orphan: 'Orphan',
    })
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

  it('carries no Output Format row', () => {
    expect(inputsByName(ID).output_format).toBeUndefined()
  })
})

describe('help copy', () => {
  it('says a relative Helm Path starts at the home folder of the account the block runs as (REQ-3.4.3.12)', () => {
    expect(inputsByName(ID).helm_path.description).toBe(HELM_PATH_HELP)
  })
})

describe('groups', () => {
  it('orders the groups Connection, then Uninstall, Advanced and Failure Handling', () => {
    expect(groupOrder(ID)).toEqual(GROUP_ORDER)
  })

  it('declares group metadata in the same order', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual(GROUP_ORDER)
  })

  it('files the connection rows under Connection', () => {
    expect(visibleInGroup(ID, 'Connection', {})).toEqual(CONNECTION_PARAMS)
  })

  it('files the release and its options under Uninstall', () => {
    expect(visibleInGroup(ID, 'Uninstall', {})).toEqual(UNINSTALL_PARAMS)
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
    expect(meta['Uninstall'].description).toBe('Release to remove')
    expect(meta['Advanced'].description).toBe(ADVANCED_FOOTER)
    expect(meta['Failure Handling'].description).toBe(FAILURE_FOOTER)
  })

  it('opens Connection and Uninstall only, collapsing every other group', () => {
    const meta = getGroupMeta(ID) ?? {}
    expect(GROUP_ORDER.filter((name) => meta[name].defaultExpanded)).toEqual([
      'Connection',
      'Uninstall',
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
})

describe('visibility', () => {
  it('shows every row on a fresh block', () => {
    expect(visibleNames(ID, {})).toEqual(PARAM_ORDER)
  })
})

describe('outputs', () => {
  it('declares the output core alone', () => {
    expect(outputNames(ID)).toEqual(OUTPUT_ORDER)
  })

  it('declares no Result and no Status', () => {
    const outputs = outputsByName(ID)
    expect(outputs.result).toBeUndefined()
    expect(outputs.status).toBeUndefined()
  })

  it('gates Error and Reason on Record and continue', () => {
    expectOutputCore(ID)
  })

  it('offers Success alone while On error is Fail the block', () => {
    expect(visibleOutputs(ID, {})).toEqual(['success'])
  })

  it('offers all three outputs under Record and continue', () => {
    expect(visibleOutputs(ID, { on_error: 'record' })).toEqual(OUTPUT_ORDER)
  })

  it('declares no output type rules at all', () => {
    for (const output of getOutputParams(ID) ?? []) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the Helm Uninstall palette row in the helm category', () => {
    expectPaletteWiring(ID, 'Helm Uninstall', 'PackageMinus', PackageMinus, 'package-minus')
  })
})
