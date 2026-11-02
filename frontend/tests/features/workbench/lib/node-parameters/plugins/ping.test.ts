/**
 * Ping descriptor tests (REQ-3.4.1.9, REQ-3.3.4.4, REQ-3.4.2.2).
 *
 * Design decisions: PING-1, PING-2, PING-3, PING-6, PING-7, PING-8, PING-9, PING-10, PING-12,
 *                   PING-17, PING-18
 */

import { describe, it, expect } from 'vitest'
import { Radio } from 'lucide-react'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type GroupMeta, type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  streamOutputInput,
  timeoutInput,
} from '@/features/workbench/lib/node-parameters/plugins/_shared-params'
import {
  deriveGroups,
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const ID = 'ping'
const PING_MODULE = '@/features/workbench/lib/node-parameters/plugins/ping'
const REGISTRY_MODULE = '@/features/workbench/lib/node-parameters'

const INTERVAL_LABEL = 'Interval (seconds)'
const PACKET_SIZE_LABEL = 'Packet size (bytes)'
const MIN_RATE_LABEL = 'Minimum rate (%)'
const DONT_FRAGMENT_LABEL = "Don't fragment"

const MIN_REPLIES_GATE = { field: 'pass_when', values: ['min_replies'] }
const MIN_RATE_GATE = { field: 'pass_when', values: ['min_rate'] }
const COUNT_CEILING = { field: 'count', message: 'Minimum replies cannot exceed Count' }

const ADVANCED = ['IP version', 'TTL', DONT_FRAGMENT_LABEL, 'Source address']
const FH = ['On error']

interface ExpectedRow {
  name: string
  label: string
  type: InputParam['type']
  defaultValue: unknown
  noExpression: true | undefined
  group: string | undefined
}

function row(
  name: string,
  label: string,
  type: InputParam['type'],
  defaultValue: unknown,
  noExpression: true | undefined,
  group?: string,
): ExpectedRow {
  return { name, label, type, defaultValue, noExpression, group }
}

/** The 14 descriptors in sheet order; Ping declares one per wire name. */
const EXPECTED: ExpectedRow[] = [
  row('host', 'Host', 'string', undefined, undefined),
  row('count', 'Count', 'integer', 4, undefined),
  row('interval', INTERVAL_LABEL, 'float', 1, undefined),
  row('packet_size', PACKET_SIZE_LABEL, 'integer', 56, undefined),
  row('timeout', 'Timeout', 'integer', 30, undefined),
  row('pass_when', 'Pass when', 'string', 'any', true),
  row('min_replies', 'Minimum replies', 'integer', 1, undefined),
  row('min_rate', MIN_RATE_LABEL, 'float', 100, undefined),
  row('stream_output', 'Log Output', 'boolean', false, undefined),
  row('ip_version', 'IP version', 'string', 'auto', true, 'Advanced'),
  row('ttl', 'TTL', 'integer', undefined, undefined, 'Advanced'),
  row('dont_fragment', DONT_FRAGMENT_LABEL, 'boolean', false, undefined, 'Advanced'),
  row('source_address', 'Source address', 'string', undefined, undefined, 'Advanced'),
  row('on_error', 'On error', 'string', 'fail', true, 'Failure Handling'),
]

const DESCRIPTOR_ORDER = EXPECTED.map((e) => e.name)
const TOP_LABELS = EXPECTED.filter((e) => e.group === undefined).map((e) => e.label)

/** The bounds each row declares (PING-12, PING-17, PING-18). */
interface NumericBounds {
  minimum?: number
  maximum?: number
  maximumField?: { field: string; message: string }
}

type BoundedParam = InputParam & NumericBounds

const BOUNDS: [string, NumericBounds][] = [
  ['count', { minimum: 1, maximum: 1000 }],
  ['interval', { minimum: 0.2 }],
  ['packet_size', { minimum: 0, maximum: 65507 }],
  ['timeout', { minimum: 1 }],
  ['min_replies', { minimum: 1, maximumField: COUNT_CEILING }],
  ['min_rate', { minimum: 0, maximum: 100 }],
  ['ttl', { minimum: 1, maximum: 255 }],
]

/** The rows with no numeric meaning; none of them declares a bound. */
const UNBOUNDED = [
  'host',
  'pass_when',
  'stream_output',
  'ip_version',
  'dont_fragment',
  'source_address',
  'on_error',
]

// ---------------------------------------------------------------------------
// Helpers over the registry and the functions the sheet itself uses
// ---------------------------------------------------------------------------

function inputs(): InputParam[] {
  return getInputParams(ID) ?? []
}

function outputs(): OutputParam[] {
  return getOutputParams(ID) ?? []
}

function table(): Parameter[] {
  return inputs() as unknown as Parameter[]
}

/** The one descriptor under a wire name; fails the test when there is not exactly one. */
function single(name: string): InputParam {
  const rows = inputs().filter((p) => p.name === name)
  expect(rows, `descriptors named ${name}`).toHaveLength(1)
  return rows[0]
}

/** The one output under a wire name; fails the test when there is not exactly one. */
function outputNamed(name: string): OutputParam {
  const found = outputs().filter((o) => o.name === name)
  expect(found, `outputs named ${name}`).toHaveLength(1)
  return found[0]
}

function boundsOf(entry: InputParam): NumericBounds {
  const { minimum, maximum, maximumField } = entry as BoundedParam
  return { minimum, maximum, maximumField }
}

function label(entry: { name: string; label?: string }): string {
  return entry.label ?? entry.name
}

/** The descriptors the INPUT table renders for one set of values, in order. */
function visibleRows(values: Record<string, unknown>): InputParam[] {
  const all = table()
  return inputs().filter((_, i) => isParameterVisible(all[i], values, all))
}

/** The sheet as the table derives it: ungrouped labels, then each rendered group with its labels. */
function sheet(values: Record<string, unknown>) {
  const { ungrouped, groups } = deriveGroups(
    visibleRows(values) as unknown as Parameter[],
    getGroupMeta(ID),
  )
  return {
    top: ungrouped.map(label),
    groupOrder: groups.map((g) => g.name),
    group: (name: string) => groups.find((g) => g.name === name)?.params.map(label) ?? [],
  }
}

/** Mirrors the private required resolution (required, requiredWhen) with the exported matcher. */
function requiredFor(entry: InputParam, values: Record<string, unknown>): boolean {
  const all = table()
  if (entry.required) return true
  if (entry.requiredWhen) return matchesCondition(entry.requiredWhen, values, all)
  if (entry.requiredWhenAll) {
    return entry.requiredWhenAll.every((c) => matchesCondition(c, values, all))
  }
  return false
}

function requiredNames(values: Record<string, unknown>): string[] {
  return [...new Set(inputs().filter((p) => requiredFor(p, values)).map((p) => p.name))]
}

/** The outputs the OUTPUT table offers for one set of values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const all = table()
  return outputs()
    .filter((o) => isParameterVisible(o, values, all))
    .map((o) => o.name)
}

// ---------------------------------------------------------------------------
// The sheet states, one per Pass when choice
// ---------------------------------------------------------------------------

function topRows(revealed: string[]): string[] {
  return ['Host', 'Count', INTERVAL_LABEL, PACKET_SIZE_LABEL, 'Timeout', 'Pass when', ...revealed, 'Log Output']
}

interface SheetState {
  values: Record<string, string>
  top: string[]
  required: string[]
}

function state(passWhen: string, revealed: string[], required: string[]): SheetState {
  return { values: { pass_when: passWhen }, top: topRows(revealed), required: ['host', ...required] }
}

const STATES: [string, SheetState][] = [
  ['Any reply', state('any', [], [])],
  ['All replies', state('all', [], [])],
  ['At least N replies', state('min_replies', ['Minimum replies'], ['min_replies'])],
  ['At least X% replies', state('min_rate', [MIN_RATE_LABEL], ['min_rate'])],
]

const PASS_WHEN_VALUES = ['any', 'all', 'min_replies', 'min_rate']

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers ping in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers ping in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers ping in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves ping via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
  })

  it('registers the inputs, outputs and groups the ping module exports', async () => {
    // The global afterEach resets modules, so load the registry and the module from the same graph.
    const registry = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as {
      PLUGIN_INPUTS: typeof PLUGIN_INPUTS
      PLUGIN_OUTPUTS: typeof PLUGIN_OUTPUTS
      PLUGIN_GROUPS: typeof PLUGIN_GROUPS
    }
    const ping = (await import(/* @vite-ignore */ PING_MODULE)) as {
      inputs: InputParam[]
      outputs: OutputParam[]
      groups: Record<string, GroupMeta>
    }
    expect(registry.PLUGIN_INPUTS[ID]).toBe(ping.inputs)
    expect(registry.PLUGIN_OUTPUTS[ID]).toBe(ping.outputs)
    expect(registry.PLUGIN_GROUPS[ID]).toBe(ping.groups)
  })
})

describe('schema surface (PING-6, PING-7)', () => {
  it('declares the 14 descriptors in sheet order', () => {
    expect(inputs().map((p) => p.name)).toEqual(DESCRIPTOR_ORDER)
  })

  it('declares exactly one descriptor per wire name (PING-2)', () => {
    const names = inputs().map((p) => p.name)
    expect(names).toHaveLength(14)
    expect(names).toEqual([...new Set(names)])
  })

  it('labels every descriptor', () => {
    expect(inputs().map(label)).toEqual(EXPECTED.map((e) => e.label))
  })

  it('types every descriptor', () => {
    expect(inputs().map((p) => p.type)).toEqual(EXPECTED.map((e) => e.type))
  })

  it('defaults every descriptor', () => {
    expect(inputs().map((p) => p.defaultValue)).toEqual(EXPECTED.map((e) => e.defaultValue))
  })

  it('marks only Host required outright (PING-6)', () => {
    expect(inputs().map((p) => p.required)).toEqual(EXPECTED.map((e) => e.name === 'host'))
  })

  it('marks no descriptor secret', () => {
    expect(inputs()).toHaveLength(14)
    expect(inputs().filter((p) => p.secret === true).map((p) => p.name)).toEqual([])
  })

  it('gives every descriptor a description that is more than its label', () => {
    expect(inputs()).toHaveLength(14)
    for (const p of inputs()) {
      const description = (p.description ?? '').trim()
      expect(description, `description of ${p.name}`).not.toBe('')
      expect(description.toLowerCase(), `description of ${p.name}`).not.toBe(
        label(p).trim().toLowerCase(),
      )
    }
  })

  it('gives every output a description that is more than its label', () => {
    expect(outputs()).toHaveLength(5)
    for (const o of outputs()) {
      const description = (o.description ?? '').trim()
      expect(description, `description of ${o.name}`).not.toBe('')
      expect(description.toLowerCase(), `description of ${o.name}`).not.toBe(
        label(o).trim().toLowerCase(),
      )
    }
  })
})

describe('selects (PING-3, PING-7)', () => {
  it('offers the four Pass when rules (PING-3)', () => {
    const passWhen = single('pass_when')
    expect(passWhen.enumValues).toEqual(PASS_WHEN_VALUES)
    expect(passWhen.enumLabels).toEqual({
      any: 'Any reply',
      all: 'All replies',
      min_replies: 'At least N replies',
      min_rate: 'At least X% replies',
    })
  })

  it('offers Auto, IPv4 and IPv6 under IP version (PING-7)', () => {
    const ipVersion = single('ip_version')
    expect(ipVersion.enumValues).toEqual(['auto', 'v4', 'v6'])
    expect(ipVersion.enumLabels).toEqual({ auto: 'Auto', v4: 'IPv4', v6: 'IPv6' })
  })

  it('takes the On error choices from the shared builder and adds nothing', () => {
    expect(single('on_error')).toEqual(failureHandlingOnErrorInput())
  })

  it('hides the expression toggle on the selects only', () => {
    expect(inputs().map((p) => [p.name, p.noExpression])).toEqual(
      EXPECTED.map((e) => [e.name, e.noExpression]),
    )
  })

  it('renders a select only for the choices', () => {
    expect(inputs().filter((p) => p.enumValues !== undefined).map((p) => p.name)).toEqual([
      'pass_when',
      'ip_version',
      'on_error',
    ])
    expect(inputs().filter((p) => p.enumSearchable === true).map((p) => p.name)).toEqual([])
  })
})

describe('revealed rows (PING-3)', () => {
  it('reveals Minimum replies only under At least N replies', () => {
    const minReplies = single('min_replies')
    expect(minReplies.showWhen).toEqual(MIN_REPLIES_GATE)
    expect(
      PASS_WHEN_VALUES.map((pass_when) => isParameterVisible(minReplies, { pass_when }, table())),
    ).toEqual([false, false, true, false])
  })

  it('reveals Minimum rate only under At least X% replies', () => {
    const minRate = single('min_rate')
    expect(minRate.showWhen).toEqual(MIN_RATE_GATE)
    expect(
      PASS_WHEN_VALUES.map((pass_when) => isParameterVisible(minRate, { pass_when }, table())),
    ).toEqual([false, false, false, true])
  })

  it('hides both revealed rows on a fresh node, where Pass when is Any reply', () => {
    expect(isParameterVisible(single('min_replies'), {}, table())).toBe(false)
    expect(isParameterVisible(single('min_rate'), {}, table())).toBe(false)
  })

  it('requires each revealed row exactly while it is shown', () => {
    expect(single('min_replies').requiredWhen).toEqual(MIN_REPLIES_GATE)
    expect(single('min_rate').requiredWhen).toEqual(MIN_RATE_GATE)
  })

  it('keeps the values of the two revealed rows across a Pass when change', () => {
    expect(inputs().filter((p) => p.retainOnHide === true).map((p) => p.name)).toEqual([
      'min_replies',
      'min_rate',
    ])
  })
})

describe('numeric bounds (PING-12, PING-17, PING-18)', () => {
  it.each(BOUNDS)('declares the bounds of %s', (name, expected) => {
    expect(boundsOf(single(name))).toEqual(expected)
  })

  it('takes the lowest Timeout from the shared builder', () => {
    expect(boundsOf(single('timeout'))).toEqual(boundsOf(timeoutInput(30, 'x')))
  })

  it('leaves Interval with no highest value', () => {
    expect(boundsOf(single('interval')).maximum).toBeUndefined()
  })

  it('caps Minimum replies at Count with its own message (PING-18)', () => {
    expect(boundsOf(single('min_replies')).maximumField).toEqual(COUNT_CEILING)
  })

  it('names Count as the only cross-field ceiling', () => {
    expect(
      inputs().filter((p) => boundsOf(p).maximumField !== undefined).map((p) => p.name),
    ).toEqual(['min_replies'])
  })

  it.each(UNBOUNDED)('declares no bound on %s', (name) => {
    expect(boundsOf(single(name))).toEqual({})
  })
})

describe('groups (PING-7)', () => {
  it('declares Advanced and Failure Handling in that order, and no Secrets group', () => {
    const keys = Object.keys(getGroupMeta(ID) ?? {})
    expect(keys).toEqual(['Advanced', 'Failure Handling'])
    expect(keys).not.toContain('Secrets')
  })

  it('keeps Advanced collapsed and gives it no footer line', () => {
    const advanced = getGroupMeta(ID)?.Advanced
    expect(advanced).toEqual({ name: 'Advanced' })
    expect(advanced?.description).toBeUndefined()
    expect(advanced?.defaultExpanded).toBeUndefined()
  })

  it('uses the shared Failure Handling group, collapsed with its footer line', () => {
    const failureHandling = getGroupMeta(ID)?.['Failure Handling']
    expect(failureHandling).toEqual(failureHandlingGroup())
    expect(failureHandling?.name).toBe(FAILURE_HANDLING_GROUP)
    expect(failureHandling?.description).toBeTruthy()
    expect(failureHandling?.defaultExpanded).toBeUndefined()
  })

  it("puts IP version, TTL, Don't fragment and Source address in Advanced", () => {
    expect(inputs().filter((p) => p.group === 'Advanced').map((p) => p.name)).toEqual([
      'ip_version',
      'ttl',
      'dont_fragment',
      'source_address',
    ])
  })

  it('puts only the shared On error row in Failure Handling', () => {
    expect(inputs().filter((p) => p.group === 'Failure Handling').map((p) => p.name)).toEqual([
      'on_error',
    ])
  })

  it('leaves the nine top rows ungrouped, groups the rest, and declares no Secrets row', () => {
    expect(inputs().map((p) => [p.name, p.group])).toEqual(EXPECTED.map((e) => [e.name, e.group]))
    expect(inputs().filter((p) => p.group === 'Secrets').map((p) => p.name)).toEqual([])
  })

  it('derives nine top rows, four Advanced rows and On error from the schema', () => {
    const { ungrouped, groups } = deriveGroups(table(), getGroupMeta(ID))
    expect(ungrouped.map(label)).toEqual(TOP_LABELS)
    expect(ungrouped).toHaveLength(9)
    expect(groups.map((g) => g.name)).toEqual(['Advanced', 'Failure Handling'])
    expect(groups[0].params.map(label)).toEqual(ADVANCED)
    expect(groups[1].params.map(label)).toEqual(FH)
  })
})

describe('sheet per Pass when state (PING-3, PING-6, PING-7)', () => {
  it.each(STATES)('shows the top rows of %s in order', (_title, sheetState) => {
    expect(sheet(sheetState.values).top).toEqual(sheetState.top)
  })

  it.each(STATES)('fills the Advanced group of %s', (_title, sheetState) => {
    expect(sheet(sheetState.values).group('Advanced')).toEqual(ADVANCED)
  })

  it.each(STATES)('keeps On error in Failure Handling in %s', (_title, sheetState) => {
    expect(sheet(sheetState.values).group('Failure Handling')).toEqual(FH)
  })

  it.each(STATES)('renders the groups of %s in order', (_title, sheetState) => {
    expect(sheet(sheetState.values).groupOrder).toEqual(['Advanced', 'Failure Handling'])
  })

  it.each(STATES)('requires only visible rows in %s', (_title, sheetState) => {
    const visible = visibleRows(sheetState.values)
    expect(visible.length).toBeGreaterThan(0)
    for (const p of inputs().filter((entry) => requiredFor(entry, sheetState.values))) {
      expect(visible, `required row ${p.name}`).toContain(p)
    }
  })

  it.each(STATES)('requires exactly the rows of %s', (_title, sheetState) => {
    expect(requiredNames(sheetState.values)).toEqual(sheetState.required)
  })

  it('opens a fresh node on Any reply', () => {
    expect(sheet({}).top).toEqual(topRows([]))
    expect(requiredNames({})).toEqual(['host'])
  })

  it('requires Host in every state', () => {
    const host = single('host')
    expect(requiredFor(host, {})).toBe(true)
    expect(STATES.map(([, s]) => requiredFor(host, s.values))).toEqual(STATES.map(() => true))
  })
})

describe('shared builders', () => {
  it('builds the Timeout row from the shared builder, defaulting to 30 seconds', () => {
    const timeout = single('timeout')
    expect(timeout).toEqual(timeoutInput(30, timeout.description ?? ''))
    expect(timeout.group).toBeUndefined()
  })

  it('builds the Log Output row from the promoted shared builder, in no group', () => {
    const streamOutput = single('stream_output')
    expect(streamOutput).toEqual(streamOutputInput(streamOutput.description ?? ''))
    expect(streamOutput.group).toBeUndefined()
  })

  it('builds the On error row from the shared failure-handling builder', () => {
    expect(single('on_error')).toEqual(failureHandlingOnErrorInput())
  })

  it('builds Success, Error and Reason from the shared output core', () => {
    const success = outputNamed('success')
    const reason = outputNamed('reason')
    const [sharedSuccess, sharedError, sharedReason] = outputCore({
      successDescription: success.description ?? '',
      reasonDescription: reason.description ?? '',
    })
    expect(success).toEqual(sharedSuccess)
    expect(outputNamed('error')).toEqual(sharedError)
    expect(reason).toEqual(sharedReason)
  })
})

describe('outputs (PING-9, PING-10)', () => {
  it('declares Success, Summary, Replies, Error and Reason with their types', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual([
      ['success', 'boolean'],
      ['summary', 'table'],
      ['replies', 'table'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
  })

  it('labels every output', () => {
    expect(outputs().map(label)).toEqual(['Success', 'Summary', 'Replies', 'Error', 'Reason'])
  })

  it('offers Summary as a table rather than a map (PING-10)', () => {
    expect(outputNamed('summary').type).toBe('table')
    expect(outputNamed('summary').type).not.toBe('map')
  })

  it('gates Error and Reason on Record and continue, and nothing else', () => {
    expect(outputs().filter((o) => o.showWhen !== undefined).map((o) => o.name)).toEqual([
      'error',
      'reason',
    ])
    for (const name of ['error', 'reason']) {
      expect(outputNamed(name).showWhen).toEqual({ field: 'on_error', values: ['record'] })
    }
  })

  it.each([
    [{}, ['success', 'summary', 'replies']],
    [{ on_error: 'fail' }, ['success', 'summary', 'replies']],
    [{ on_error: 'record' }, ['success', 'summary', 'replies', 'error', 'reason']],
  ])('offers the outputs for %o', (values, expected) => {
    expect(visibleOutputs(values)).toEqual(expected)
  })

  it('marks no output secret and gives none a type rule', () => {
    expect(outputs()).toHaveLength(5)
    expect(outputs().filter((o) => o.secret === true).map((o) => o.name)).toEqual([])
    expect(outputs().filter((o) => o.typeWhen !== undefined).map((o) => o.name)).toEqual([])
  })
})

describe('palette and icon (PING-1)', () => {
  it('keeps the Ping palette row in the Network category', () => {
    const def = getPluginById(ID)
    expect(def).toBeDefined()
    expect(def!.name).toBe('Ping')
    expect(def!.category).toBe('network')
    expect(def!.iconName).toBe('Radio')
    expect(def!.colorClass).toBe('text-blue-500')
  })

  it('runs on a remote host inside a Remote Execution body (PING-1)', () => {
    expect(getPluginById(ID)?.remotable).toBe(true)
  })

  it('keeps the Radio glyph and the blue color on the canvas', () => {
    expect(getIcon(ID)).toBe(Radio)
    expect(getIconName(ID)).toBe('radio')
    expect(getColorClass(ID)).toBe('text-blue-500')
  })
})

describe('plain-text rows', () => {
  it.each(['host', 'source_address'])('locks %s to plain text, so its editor has no Format picker', (name) => {
    expect(single(name).allowedFormats).toEqual(['plain'])
  })
})
