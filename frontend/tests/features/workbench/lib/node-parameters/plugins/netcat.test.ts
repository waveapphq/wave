/**
 * Netcat descriptor tests (REQ-3.4.1.9, REQ-3.3.4.3, REQ-3.4.2.2).
 *
 * Design decisions: NETCAT-1, NETCAT-2, NETCAT-3, NETCAT-4, NETCAT-5, NETCAT-7, NETCAT-10,
 *                   NETCAT-12, NETCAT-14, NETCAT-16
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
import { type GroupMeta, type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
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

const ID = 'netcat'
const NETCAT_MODULE = '@/features/workbench/lib/node-parameters/plugins/netcat'
const REGISTRY_MODULE = '@/features/workbench/lib/node-parameters'
const PYTHON = 'python'
const MAX_REPLY_LABEL = 'Max reply size (bytes)'
const FILE_PLACEHOLDER = 'testdata://…, artifact://…, or /abs/path'
const ADVANCED_FOOTER = 'Line endings, closing and reply size for Talk'

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

/** The 16 descriptors in sheet order; the first Send is the TCP variant, the second the UDP one. */
const EXPECTED: ExpectedRow[] = [
  row('host', 'Host', 'string', undefined, undefined),
  row('ports', 'Ports', 'string', 'single', true),
  row('port', 'Port', 'integer', undefined, undefined),
  row('port_range', 'Port range', 'string', undefined, undefined),
  row('pass_when', 'Pass when', 'string', 'one', true),
  row('protocol', 'Protocol', 'string', 'tcp', true),
  row('mode', 'Mode', 'string', 'check', true),
  row('send', 'Send', 'string', 'text', true),
  row('send', 'Send', 'string', 'text', true),
  row('text', 'Text', 'string', undefined, undefined),
  row('file', 'File', 'string', undefined, undefined),
  row('timeout', 'Timeout', 'integer', 10, undefined),
  row('crlf', 'CRLF line endings', 'boolean', false, undefined, 'Advanced'),
  row('close_after_send', 'Close after sending', 'boolean', false, undefined, 'Advanced'),
  row('max_reply_bytes', MAX_REPLY_LABEL, 'integer', 16777216, undefined, 'Advanced'),
  row('on_error', 'On error', 'string', 'fail', true, 'Failure Handling'),
]

const DESCRIPTOR_ORDER = EXPECTED.map((e) => e.name)

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

function inputsNamed(name: string): InputParam[] {
  return inputs().filter((p) => p.name === name)
}

/** The one descriptor under a wire name; fails the test when there is not exactly one. */
function single(name: string): InputParam {
  const rows = inputsNamed(name)
  expect(rows, `descriptors named ${name}`).toHaveLength(1)
  return rows[0]
}

/** Both Send descriptors, told apart by the Nothing option only the TCP variant offers. */
function sendVariants(): { tcp: InputParam; udp: InputParam } {
  const rows = inputsNamed('send')
  expect(rows, 'descriptors named send').toHaveLength(2)
  const tcp = rows.find((p) => p.enumValues?.includes('nothing'))
  expect(tcp, 'the Send variant that offers Nothing').toBeDefined()
  return { tcp: tcp!, udp: rows.find((p) => p !== tcp)! }
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

/** The option labels of each visible Send descriptor. */
function sendOptions(values: Record<string, unknown>): string[][] {
  return visibleRows(values)
    .filter((p) => p.name === 'send')
    .map((p) => (p.enumValues ?? []).map((v) => p.enumLabels?.[v] ?? String(v)))
}

/** Mirrors the private required resolution (required, requiredWhen, requiredWhenAll) with the exported matcher. */
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
// The sheet states
// ---------------------------------------------------------------------------

const SINGLE_CHECK_TOP = ['Host', 'Ports', 'Port', 'Protocol', 'Mode', 'Timeout']
const RANGE_CHECK_TOP = ['Host', 'Ports', 'Port range', 'Pass when', 'Protocol', 'Mode', 'Timeout']
const SINGLE_TALK_HEAD = ['Host', 'Ports', 'Port', 'Protocol', 'Mode', 'Send']
const RANGE_TALK_HEAD = ['Host', 'Ports', 'Port range', 'Pass when', 'Protocol', 'Mode', 'Send']
const TCP_SEND = ['Nothing', 'Text', 'File']
const UDP_SEND = ['Text', 'File']
const ADV_TCP = ['CRLF line endings', 'Close after sending', MAX_REPLY_LABEL]
const ADV_UDP = ['CRLF line endings', MAX_REPLY_LABEL]
const FH = ['On error']

interface SheetState {
  values: Record<string, string>
  top: string[]
  send: string[][]
  advanced: string[]
  groupOrder: string[]
  required: string[]
}

function check(ports: 'single' | 'range', protocol: 'tcp' | 'udp'): SheetState {
  return {
    values: { ports, mode: 'check', protocol },
    top: ports === 'single' ? SINGLE_CHECK_TOP : RANGE_CHECK_TOP,
    send: [],
    advanced: [],
    groupOrder: ['Failure Handling'],
    required: ['host', ports === 'single' ? 'port' : 'port_range'],
  }
}

function talk(
  ports: 'single' | 'range',
  protocol: 'tcp' | 'udp',
  send: 'nothing' | 'text' | 'file',
): SheetState {
  const head = ports === 'single' ? SINGLE_TALK_HEAD : RANGE_TALK_HEAD
  const payload = { nothing: [], text: ['Text'], file: ['File'] }[send]
  const portRow = ports === 'single' ? 'port' : 'port_range'
  return {
    values: { ports, mode: 'talk', protocol, send },
    top: [...head, ...payload, 'Timeout'],
    send: [protocol === 'tcp' ? TCP_SEND : UDP_SEND],
    advanced: protocol === 'tcp' ? ADV_TCP : ADV_UDP,
    groupOrder: ['Advanced', 'Failure Handling'],
    required: send === 'file' ? ['host', portRow, 'file'] : ['host', portRow],
  }
}

const STATES: [string, SheetState][] = [
  ['Single, Check, TCP', check('single', 'tcp')],
  ['Single, Check, UDP', check('single', 'udp')],
  ['Range, Check, TCP', check('range', 'tcp')],
  ['Range, Check, UDP', check('range', 'udp')],
  ['Single, Talk, TCP, Nothing', talk('single', 'tcp', 'nothing')],
  ['Single, Talk, TCP, Text', talk('single', 'tcp', 'text')],
  ['Single, Talk, TCP, File', talk('single', 'tcp', 'file')],
  ['Single, Talk, UDP, Text', talk('single', 'udp', 'text')],
  ['Single, Talk, UDP, File', talk('single', 'udp', 'file')],
  ['Range, Talk, TCP, Nothing', talk('range', 'tcp', 'nothing')],
  ['Range, Talk, TCP, Text', talk('range', 'tcp', 'text')],
  ['Range, Talk, TCP, File', talk('range', 'tcp', 'file')],
  ['Range, Talk, UDP, Text', talk('range', 'udp', 'text')],
  ['Range, Talk, UDP, File', talk('range', 'udp', 'file')],
]

const PROTOCOL_MODES: Record<string, string>[] = [
  { mode: 'talk', protocol: 'tcp' },
  { mode: 'talk', protocol: 'udp' },
  { mode: 'check', protocol: 'tcp' },
  { mode: 'check', protocol: 'udp' },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers netcat in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers netcat in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers netcat in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves netcat via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
  })

  it('registers the inputs, outputs and groups the netcat module exports', async () => {
    // The global afterEach resets modules, so load the registry and the module from the same graph.
    const registry = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as {
      PLUGIN_INPUTS: typeof PLUGIN_INPUTS
      PLUGIN_OUTPUTS: typeof PLUGIN_OUTPUTS
      PLUGIN_GROUPS: typeof PLUGIN_GROUPS
    }
    const netcat = (await import(/* @vite-ignore */ NETCAT_MODULE)) as {
      inputs: InputParam[]
      outputs: OutputParam[]
      groups: Record<string, GroupMeta>
    }
    expect(registry.PLUGIN_INPUTS[ID]).toBe(netcat.inputs)
    expect(registry.PLUGIN_OUTPUTS[ID]).toBe(netcat.outputs)
    expect(registry.PLUGIN_GROUPS[ID]).toBe(netcat.groups)
  })
})

describe('schema surface (NETCAT-12)', () => {
  it('declares the 16 descriptors in sheet order, Send twice', () => {
    expect(inputs().map((p) => p.name)).toEqual(DESCRIPTOR_ORDER)
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

  it('marks only Host required outright', () => {
    expect(inputs().map((p) => p.required)).toEqual(EXPECTED.map((e) => e.name === 'host'))
  })

  it('marks no descriptor secret', () => {
    expect(inputs()).toHaveLength(16)
    expect(inputs().filter((p) => p.secret === true).map((p) => p.name)).toEqual([])
  })

  it('gives every descriptor a description that is more than its label', () => {
    expect(inputs()).toHaveLength(16)
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

describe('numeric bounds (PING-17)', () => {
  it('declares a lowest value of 1 and no highest value on Max reply size', () => {
    const maxReply = single('max_reply_bytes')
    expect(maxReply.minimum).toBe(1)
    expect(maxReply.maximum).toBeUndefined()
    expect(maxReply.maximumField).toBeUndefined()
  })

  it('takes the Timeout row bounds from the shared builder, adding none of its own', () => {
    const timeout = single('timeout')
    const built = timeoutInput(10, timeout.description ?? '')
    expect(timeout.minimum).toBe(built.minimum)
    expect(timeout.maximum).toBe(built.maximum)
    expect(timeout.maximumField).toBe(built.maximumField)
  })

  it('leaves every other row unbounded', () => {
    const others = inputs().filter((p) => p.name !== 'timeout' && p.name !== 'max_reply_bytes')
    expect(others).toHaveLength(14)
    for (const p of others) {
      expect(p.minimum, `minimum of ${p.name}`).toBeUndefined()
      expect(p.maximum, `maximum of ${p.name}`).toBeUndefined()
      expect(p.maximumField, `maximumField of ${p.name}`).toBeUndefined()
    }
  })
})

describe('selects (NETCAT-2, NETCAT-3, NETCAT-4, NETCAT-12)', () => {
  it('offers Single and Range under Ports (NETCAT-2)', () => {
    const ports = single('ports')
    expect(ports.enumValues).toEqual(['single', 'range'])
    expect(ports.enumLabels).toEqual({ single: 'Single', range: 'Range' })
  })

  it('offers One succeeds and All succeed under Pass when (NETCAT-3)', () => {
    const passWhen = single('pass_when')
    expect(passWhen.enumValues).toEqual(['one', 'all'])
    expect(passWhen.enumLabels).toEqual({ one: 'One succeeds', all: 'All succeed' })
  })

  it('offers TCP and UDP under Protocol', () => {
    const protocol = single('protocol')
    expect(protocol.enumValues).toEqual(['tcp', 'udp'])
    expect(protocol.enumLabels).toEqual({ tcp: 'TCP', udp: 'UDP' })
  })

  it('offers Check and Talk under Mode (NETCAT-4)', () => {
    const mode = single('mode')
    expect(mode.enumValues).toEqual(['check', 'talk'])
    expect(mode.enumLabels).toEqual({ check: 'Check', talk: 'Talk' })
  })

  it('hides the expression toggle on the selects only (NETCAT-12)', () => {
    expect(inputs().map((p) => [p.name, p.noExpression])).toEqual(
      EXPECTED.map((e) => [e.name, e.noExpression]),
    )
  })

  it('renders a select only for the choices (NETCAT-12)', () => {
    expect(inputs().filter((p) => p.enumValues !== undefined).map((p) => p.name)).toEqual([
      'ports',
      'pass_when',
      'protocol',
      'mode',
      'send',
      'send',
      'on_error',
    ])
    expect(inputs().filter((p) => p.enumSearchable === true).map((p) => p.name)).toEqual([])
  })
})

describe('paired Send descriptors (NETCAT-4)', () => {
  it('declares Send twice with one label, type, required flag and default', () => {
    const { tcp, udp } = sendVariants()
    expect([tcp, udp].map((p) => [label(p), p.type, p.required, p.defaultValue])).toEqual([
      ['Send', 'string', false, 'text'],
      ['Send', 'string', false, 'text'],
    ])
  })

  it('offers Nothing, Text and File on the TCP variant', () => {
    const { tcp } = sendVariants()
    expect(tcp.enumValues).toEqual(['nothing', 'text', 'file'])
    expect(tcp.enumLabels).toEqual({ nothing: 'Nothing', text: 'Text', file: 'File' })
  })

  it('offers Text and File only on the UDP variant', () => {
    const { udp } = sendVariants()
    expect(udp.enumValues).toEqual(['text', 'file'])
    expect(udp.enumLabels).toEqual({ text: 'Text', file: 'File' })
  })

  it('shows the TCP variant only in TCP Talk', () => {
    const { tcp } = sendVariants()
    expect(PROTOCOL_MODES.map((values) => isParameterVisible(tcp, values, table()))).toEqual([
      true,
      false,
      false,
      false,
    ])
  })

  it('shows the UDP variant only in UDP Talk', () => {
    const { udp } = sendVariants()
    expect(PROTOCOL_MODES.map((values) => isParameterVisible(udp, values, table()))).toEqual([
      false,
      true,
      false,
      false,
    ])
  })

  it('retains neither variant while hidden', () => {
    const { tcp, udp } = sendVariants()
    expect([tcp.retainOnHide, udp.retainOnHide]).toEqual([undefined, undefined])
  })
})

describe('retained values', () => {
  it('keeps Port, Port range, Text and File values across a toggle', () => {
    expect(inputs().filter((p) => p.retainOnHide === true).map((p) => p.name)).toEqual([
      'port',
      'port_range',
      'text',
      'file',
    ])
  })
})

describe('File row (NETCAT-10)', () => {
  it('opens the file picker on Test Data and Artifacts', () => {
    const file = single('file')
    expect(file.fileReference).toBe('file')
    expect(file.fileReferenceArtifactsOnly).toBeUndefined()
  })

  it('shows the Python Script File placeholder', () => {
    const file = single('file')
    const scriptFile = (getInputParams(PYTHON) ?? []).find((p) => p.name === 'script_file')
    expect(file.placeholder).toBe(FILE_PLACEHOLDER)
    expect(file.placeholder).toBe(scriptFile?.placeholder)
  })

  it('edits its value as plain text', () => {
    expect(single('file').allowedFormats).toEqual(['plain'])
  })

  it('sits in no group', () => {
    expect(single('file').group).toBeUndefined()
  })

  it('is the only row with a file picker', () => {
    expect(inputs().filter((p) => p.fileReference !== undefined).map((p) => p.name)).toEqual([
      'file',
    ])
  })
})

describe('groups (NETCAT-5, NETCAT-12)', () => {
  it('declares Advanced and Failure Handling, and no Secrets group', () => {
    const keys = Object.keys(getGroupMeta(ID) ?? {})
    expect(keys.toSorted()).toEqual(['Advanced', 'Failure Handling'])
    expect(keys).not.toContain('Secrets')
  })

  it('keeps Advanced collapsed with its Talk footer (NETCAT-5)', () => {
    const advanced = getGroupMeta(ID)?.Advanced
    expect(advanced).toEqual({ name: 'Advanced', description: ADVANCED_FOOTER })
    expect(advanced?.defaultExpanded).toBeUndefined()
  })

  it('uses the shared Failure Handling group', () => {
    const failureHandling = getGroupMeta(ID)?.['Failure Handling']
    expect(failureHandling).toEqual(failureHandlingGroup())
    expect(failureHandling?.name).toBe(FAILURE_HANDLING_GROUP)
  })

  it('puts CRLF line endings, Close after sending and Max reply size in Advanced', () => {
    expect(inputs().filter((p) => p.group === 'Advanced').map((p) => p.name)).toEqual([
      'crlf',
      'close_after_send',
      'max_reply_bytes',
    ])
  })

  it('puts only the shared On error row in Failure Handling', () => {
    expect(inputs().filter((p) => p.group === 'Failure Handling').map((p) => p.name)).toEqual([
      'on_error',
    ])
    expect(inputs().find((p) => p.name === 'on_error')).toEqual(failureHandlingOnErrorInput())
  })

  it('leaves the top rows ungrouped, groups the rest, and declares no Secrets row', () => {
    expect(inputs().map((p) => [p.name, p.group])).toEqual(EXPECTED.map((e) => [e.name, e.group]))
    expect(inputs().filter((p) => p.group === 'Secrets').map((p) => p.name)).toEqual([])
  })
})

describe('sheet per state (NETCAT-2, NETCAT-4, NETCAT-5, NETCAT-12, NETCAT-16)', () => {
  it.each(STATES)('shows the top rows of %s in order', (_title, state) => {
    expect(sheet(state.values).top).toEqual(state.top)
  })

  it.each(STATES)('offers the Send options of %s', (_title, state) => {
    expect(visibleRows(state.values).length).toBeGreaterThan(0)
    expect(sendOptions(state.values)).toEqual(state.send)
  })

  it.each(STATES)('fills the Advanced group of %s', (_title, state) => {
    expect(visibleRows(state.values).length).toBeGreaterThan(0)
    expect(sheet(state.values).group('Advanced')).toEqual(state.advanced)
  })

  it.each(STATES)('renders the groups of %s in order', (_title, state) => {
    expect(sheet(state.values).groupOrder).toEqual(state.groupOrder)
  })

  it.each(STATES)('keeps On error in Failure Handling in %s', (_title, state) => {
    expect(sheet(state.values).group('Failure Handling')).toEqual(FH)
  })

  it.each(STATES)('requires only visible rows in %s (NETCAT-14)', (_title, state) => {
    const visible = visibleRows(state.values)
    expect(visible.length).toBeGreaterThan(0)
    for (const p of inputs().filter((entry) => requiredFor(entry, state.values))) {
      expect(visible, `required row ${p.name}`).toContain(p)
    }
  })

  it.each(STATES)('requires exactly the rows of %s', (_title, state) => {
    expect(requiredNames(state.values)).toEqual(state.required)
  })

  it('opens a fresh node on Single, Check and TCP', () => {
    expect(sheet({}).top).toEqual(SINGLE_CHECK_TOP)
  })

  it('shows the Text row when Talk is picked and Send is unset (Send defaults to Text)', () => {
    expect(sheet({ mode: 'talk' }).top).toEqual([...SINGLE_TALK_HEAD, 'Text', 'Timeout'])
  })

  it('ignores a stored Nothing under UDP while Mode is Check (NETCAT-14)', () => {
    const values = { mode: 'check', protocol: 'udp', send: 'nothing' }
    expect(sheet(values).top).toEqual(SINGLE_CHECK_TOP)
    expect(requiredNames(values)).toEqual(['host', 'port'])
  })
})

describe('required rules', () => {
  it('requires Host in every state', () => {
    const host = single('host')
    expect(requiredFor(host, {})).toBe(true)
    expect(STATES.map(([, state]) => requiredFor(host, state.values))).toEqual(
      STATES.map(() => true),
    )
  })

  it('requires Port only while Ports is Single (NETCAT-2)', () => {
    const port = single('port')
    expect(requiredFor(port, { ports: 'single' })).toBe(true)
    expect(requiredFor(port, { ports: 'range' })).toBe(false)
  })

  it('requires Port range only while Ports is Range (NETCAT-2)', () => {
    const portRange = single('port_range')
    expect(requiredFor(portRange, { ports: 'range' })).toBe(true)
    expect(requiredFor(portRange, { ports: 'single' })).toBe(false)
  })

  it('requires File only while Talk sends a file (NETCAT-14)', () => {
    const file = single('file')
    expect(requiredFor(file, { mode: 'talk', send: 'file' })).toBe(true)
    expect(requiredFor(file, { mode: 'check', send: 'file' })).toBe(false)
    expect(requiredFor(file, { mode: 'talk', send: 'text' })).toBe(false)
  })

  it('requires only Host and Port in Check even when a stored Send is File (NETCAT-14)', () => {
    expect(requiredNames({ mode: 'check', send: 'file' })).toEqual(['host', 'port'])
  })

  it('never requires Text, since an empty Text is a valid payload (NETCAT-16)', () => {
    const text = single('text')
    expect(requiredFor(text, { mode: 'talk', send: 'text' })).toBe(false)
    expect(STATES.filter(([, state]) => requiredFor(text, state.values))).toEqual([])
  })
})

describe('outputs (NETCAT-7)', () => {
  it('declares Success, Results, Reply, Error and Reason with their types', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual([
      ['success', 'boolean'],
      ['results', 'table'],
      ['reply', 'string'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
  })

  it('labels every output', () => {
    expect(outputs().map(label)).toEqual(['Success', 'Results', 'Reply', 'Error', 'Reason'])
  })

  it('uses the shared Error row of the output core', () => {
    const shared = outputCore({ successDescription: 'x', reasonDescription: 'y' })[1]
    expect(outputs().find((o) => o.name === 'error')).toEqual(shared)
  })

  it.each([
    [{}, ['success', 'results']],
    [{ ports: 'single', mode: 'check', on_error: 'fail' }, ['success', 'results']],
    [{ ports: 'single', mode: 'talk', on_error: 'fail' }, ['success', 'results', 'reply']],
    [{ ports: 'range', mode: 'check', on_error: 'fail' }, ['success', 'results']],
    [{ ports: 'range', mode: 'talk', on_error: 'fail' }, ['success', 'results']],
    [
      { ports: 'single', mode: 'check', on_error: 'record' },
      ['success', 'results', 'error', 'reason'],
    ],
    [
      { ports: 'single', mode: 'talk', on_error: 'record' },
      ['success', 'results', 'reply', 'error', 'reason'],
    ],
    [
      { ports: 'range', mode: 'check', on_error: 'record' },
      ['success', 'results', 'error', 'reason'],
    ],
    [
      { ports: 'range', mode: 'talk', on_error: 'record' },
      ['success', 'results', 'error', 'reason'],
    ],
  ])('offers the outputs for %o', (values, expected) => {
    expect(visibleOutputs(values)).toEqual(expected)
  })

  it('marks no output secret and gives none a type rule', () => {
    expect(outputs()).toHaveLength(5)
    expect(outputs().filter((o) => o.secret === true).map((o) => o.name)).toEqual([])
    expect(outputs().filter((o) => o.typeWhen !== undefined).map((o) => o.name)).toEqual([])
  })
})

describe('palette and icon (NETCAT-1, NETCAT-12)', () => {
  it('keeps the Netcat palette row in the Network category', () => {
    const def = getPluginById(ID)
    expect(def).toBeDefined()
    expect(def!.name).toBe('Netcat')
    expect(def!.category).toBe('network')
    expect(def!.iconName).toBe('Cable')
    expect(def!.colorClass).toBe('text-blue-500')
  })

  it('runs on a remote host inside a Remote Execution body (NETCAT-1)', () => {
    expect(getPluginById(ID)?.remotable).toBe(true)
  })

  it('keeps the Cable glyph and the blue color on the canvas', () => {
    expect(getIcon(ID)).toBe(Cable)
    expect(getIconName(ID)).toBe('cable')
    expect(getColorClass(ID)).toBe('text-blue-500')
  })
})

describe('plain-text rows', () => {
  it('locks Host to plain text, so its editor has no Format picker', () => {
    expect(inputsNamed('host').map((row) => row.allowedFormats)).toEqual([['plain']])
  })
})
