/**
 * Node builders shared by palette drop and Quick Add: auto-naming, the values
 * a new Block holds from creation (every choice list and true / false field,
 * FIELD-8, REQ-3.1.1.5), the structural seeds, Function Block payloads, and
 * `connectFromFirstFreeEgress`.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'

import {
  buildPaletteNode,
  buildLocalFunctionNode,
  buildPublishedFunctionNode,
  buildDefaultConfigForPalette,
  connectFromFirstFreeEgress,
  getNodeOutputHandles,
} from '@/features/workbench/common/canvas/workflow-canvas/node-builders'
import { getControlVersions } from '@/features/workbench/docs/_loader'
import { ALL_INPUTS, getInputParams } from '@/features/workbench/lib/node-parameters'
import type { InputParam } from '@/features/workbench/lib/node-parameters/types'
import type { FunctionInput } from '@/features/functions/api/types'
import { useSshHostPolicyStore } from '@/stores/ssh-host-policy-store'

const POS = { x: 10, y: 20 }

const HOST_KEY_ACTIONS = ['strict', 'accept-new', 'disabled'] as const

type HostKeyAction = (typeof HOST_KEY_ACTIONS)[number]

const SSH_OPEN_PALETTE = { id: 'ssh-session-open', name: 'SSH Session Open', type: 'plugin' as const }

function setDefaultBlockAction(action: HostKeyAction): void {
  useSshHostPolicyStore.setState({ defaultBlockAction: action })
}

/** A new SSH Session Open Block: its true / false defaults with the Settings host key action on top. */
function stamped(action: HostKeyAction) {
  return { values: { use_parent: false, compression: false, host_key_verification: action } }
}

function isChoiceField(param: InputParam): boolean {
  return param.enumValues !== undefined || param.type === 'boolean'
}

/** The declared default of every choice-list and true / false field of a Block (first row wins for paired rows). */
function creationValues(id: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const param of getInputParams(id) ?? []) {
    if (isChoiceField(param) && param.defaultValue !== undefined && !(param.name in values)) {
      values[param.name] = param.defaultValue
    }
  }
  return values
}

function creationConfig(id: string): Record<string, unknown> | undefined {
  const values = creationValues(id)
  return Object.keys(values).length === 0 ? undefined : { values }
}

/** Blocks whose config also carries a structural seed, the Settings stamp or a per-dialect default. */
const SEEDED_OR_STAMPED = new Set(['note', 'if-else', 'switch-case', 'parallel', 'ssh-session-open', 'sql-client'])

const BLOCKS_WITH_CREATION_VALUES = Object.keys(ALL_INPUTS).filter(
  (id) => !SEEDED_OR_STAMPED.has(id) && Object.keys(creationValues(id)).length > 0,
)

function namingNode(label: string, nodeType?: string) {
  return { data: { label, ...(nodeType ? { nodeType } : {}) } }
}

describe('buildDefaultConfigForPalette', () => {
  it('returns the note defaults', () => {
    expect(buildDefaultConfigForPalette('note')).toEqual({
      text: '',
      color: 'slate',
    })
  })

  it('returns the if-else branch defaults', () => {
    expect(buildDefaultConfigForPalette('if-else')).toEqual({
      values: {
        branches: [
          { id: 'branch_0', type: 'if', label: '', conditions: [] },
          { id: 'branch_1', type: 'else', label: '' },
        ],
      },
    })
  })

  // Guard: a Switch dropped on the canvas carried no seeded config.
  it('seeds a switch-case with exactly one case branch', () => {
    expect(buildDefaultConfigForPalette('switch-case')).toEqual({
      values: {
        branches: [
          { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
        ],
      },
    })
  })

  // Guard: a section needs at least two branches, so one is never a legal seed.
  it('seeds a parallel with the two-branch minimum', () => {
    expect(buildDefaultConfigForPalette('parallel')).toEqual({
      values: {
        branches: [
          { id: 'branch_1', name: '' },
          { id: 'branch_2', name: '' },
        ],
        join: 'all',
      },
    })
  })

  it('writes the Level choice of a new Log Block', () => {
    expect(buildDefaultConfigForPalette('log')).toEqual({ values: { level: 'INFO' } })
  })

  it('writes every choice-list and true / false default of a new HTTP Block and none of its free-entry defaults', () => {
    const config = buildDefaultConfigForPalette('http-client') as { values: Record<string, unknown> } | undefined

    expect(config).toEqual(creationConfig('http-client'))
    expect(config?.values).toMatchObject({
      method: 'GET',
      auth_enabled: false,
      body_mode: 'text',
      body_auto_headers: true,
      response_mode: 'body',
      allow_redirects: true,
      proxy_mode: 'wave-setting',
    })
    for (const name of ['url', 'headers', 'timeout', 'retry_count', 'retryable_status_codes', 'auth_header_name']) {
      expect(config?.values, name).not.toHaveProperty(name)
    }
  })

  it.each(BLOCKS_WITH_CREATION_VALUES)('a new %s Block holds exactly the defaults of its choice-list and true / false fields', (id) => {
    expect(buildDefaultConfigForPalette(id)).toEqual(creationConfig(id))
  })

  it('a new SQL Block holds the PostgreSQL choices, TLS off', () => {
    expect(buildDefaultConfigForPalette('sql-client')).toEqual({
      values: { ...creationValues('sql-client'), database_type: 'postgresql', operation: 'run_sql', tls: false },
    })
  })

  it.each([
    ['k8s-get', 'kind'],
    ['k8s-events', 'object_kind'],
    ['k8s-delete', 'kind'],
  ])('a new %s Block starts its %s picker on Pod', (id, field) => {
    const config = buildDefaultConfigForPalette(id) as { values?: Record<string, unknown> } | undefined

    expect(config?.values?.[field]).toBe('Pod')
  })
})

describe('buildPaletteNode - plugins and controls', () => {
  it('builds a workflowNode with the palette data, resolved version and its choice values', () => {
    const node = buildPaletteNode(
      'node-1',
      POS,
      { id: 'log', name: 'Log', type: 'plugin' },
      [],
    )
    const expectedVersion = getControlVersions('log')[0]?.version || '1.0.0'
    expect(node).toEqual({
      id: 'node-1',
      type: 'workflowNode',
      position: POS,
      data: {
        label: 'Log',
        elementType: 'log',
        nodeType: 'plugin',
        version: expectedVersion,
        config: { values: { level: 'INFO' } },
      },
    })
  })

  it('builds a palette drop or Quick Add control Block holding its choice values', () => {
    const node = buildPaletteNode('n1', POS, { id: 'halt', name: 'Halt', type: 'control' }, [])

    expect(node.data.config).toEqual(creationConfig('halt'))
    expect(node.data.config).toMatchObject({ values: { scope: 'test', status: 'failed' } })
  })

  it('auto-names with the base-first, _N-afterwards rule', () => {
    const first = buildPaletteNode(
      'n1',
      POS,
      { id: 'log', name: 'Log', type: 'plugin' },
      [namingNode('Log')],
    )
    expect(first.data.label).toBe('Log_1')

    const second = buildPaletteNode(
      'n2',
      POS,
      { id: 'log', name: 'Log', type: 'plugin' },
      [namingNode('Log'), namingNode('Log_1')],
    )
    expect(second.data.label).toBe('Log_2')
  })

  it('collides canvas-wide regardless of node type', () => {
    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'log', name: 'Log', type: 'plugin' },
      [namingNode('Log', 'function')],
    )
    expect(node.data.label).toBe('Log_1')
  })

  it('builds note nodes as noteNode with the raw name and note config', () => {
    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'note', name: 'Note', type: 'control' },
      [namingNode('Note')],
    )
    expect(node.type).toBe('noteNode')
    // Notes keep the palette's raw name - no _N sequencing.
    expect(node.data.label).toBe('Note')
    expect(node.data.config).toEqual({ text: '', color: 'slate' })
  })

  it('stamps the if-else default config on construction', () => {
    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'if-else', name: 'If / Else', type: 'control' },
      [],
    )
    expect(node.data.config).toEqual({
      values: {
        branches: [
          { id: 'branch_0', type: 'if', label: '', conditions: [] },
          { id: 'branch_1', type: 'else', label: '' },
        ],
      },
    })
  })

  it('stamps the switch-case default config on construction', () => {
    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'switch-case', name: 'Switch', type: 'control' },
      [],
    )
    expect(node.data.config).toEqual({
      values: {
        branches: [
          { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
        ],
      },
    })
  })

  it('resolves the control version from the docs loader', () => {
    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'if-else', name: 'If / Else', type: 'control' },
      [],
    )
    const expectedVersion = getControlVersions('if-else')[0]?.version || '1.0.0'
    expect(node.data.version).toBe(expectedVersion)
  })
})

describe('SSH Session Open placement stamp (REQ-4.5.14)', () => {
  afterEach(() => {
    useSshHostPolicyStore.setState(useSshHostPolicyStore.getInitialState(), true)
  })

  it('stamps Disabled before the policy has been read', () => {
    expect(buildDefaultConfigForPalette('ssh-session-open')).toEqual(stamped('disabled'))
  })

  it.each(HOST_KEY_ACTIONS)('stamps the default block action %s into a new block', (action) => {
    setDefaultBlockAction(action)

    expect(buildDefaultConfigForPalette('ssh-session-open')).toEqual(stamped(action))
  })

  it('reads the default at placement time, so a changed default reaches the next block', () => {
    setDefaultBlockAction('strict')
    const first = buildDefaultConfigForPalette('ssh-session-open')
    setDefaultBlockAction('disabled')
    const second = buildDefaultConfigForPalette('ssh-session-open')

    expect(first).toEqual(stamped('strict'))
    expect(second).toEqual(stamped('disabled'))
  })

  it('stamps Disabled when the policy read failed', () => {
    useSshHostPolicyStore.setState({ loadError: 'Could not reach the WAVE server' })

    expect(buildDefaultConfigForPalette('ssh-session-open')).toEqual(stamped('disabled'))
  })

  it('builds a palette drop or Quick Add SSH Session Open node carrying disabled when the policy read failed', () => {
    useSshHostPolicyStore.setState({ loadError: 'Could not reach the WAVE server' })

    const node = buildPaletteNode('node-1', POS, SSH_OPEN_PALETTE, [])

    expect(node.data.config).toEqual(stamped('disabled'))
  })

  it('builds a palette drop or Quick Add SSH Session Open node carrying disabled before the policy has been read', () => {
    const node = buildPaletteNode('node-1', POS, SSH_OPEN_PALETTE, [])

    expect(node.data.config).toEqual(stamped('disabled'))
  })

  // Lock turns Accept New into Strict at run time, never at placement.
  it.each(HOST_KEY_ACTIONS)('stamps %s unchanged while trusted hosts are locked', (action) => {
    useSshHostPolicyStore.setState({ defaultBlockAction: action, locked: true })

    expect(buildDefaultConfigForPalette('ssh-session-open')).toEqual(stamped(action))
  })

  it('hands every placement its own config object', () => {
    setDefaultBlockAction('strict')
    const first = buildDefaultConfigForPalette('ssh-session-open') as {
      values: Record<string, unknown>
    }
    first.values.host_key_verification = 'disabled'

    expect(buildDefaultConfigForPalette('ssh-session-open')).toEqual(stamped('strict'))
  })

  it('stamps no other block: each holds only its own choice values whatever the default', () => {
    setDefaultBlockAction('strict')

    for (const id of [
      'log',
      'http-client',
      'ssh-session-exec',
      'ssh-session-script',
      'ssh-session-close',
      'remote-execution',
    ]) {
      expect(buildDefaultConfigForPalette(id), id).toEqual(creationConfig(id))
    }
    expect(buildDefaultConfigForPalette('log')).toEqual({ values: { level: 'INFO' } })
  })

  it('keeps the seeded configs of other blocks unchanged whatever the default', () => {
    setDefaultBlockAction('strict')

    expect(buildDefaultConfigForPalette('note')).toEqual({ text: '', color: 'slate' })
    expect(buildDefaultConfigForPalette('if-else')).toEqual({
      values: {
        branches: [
          { id: 'branch_0', type: 'if', label: '', conditions: [] },
          { id: 'branch_1', type: 'else', label: '' },
        ],
      },
    })
  })

  it.each(HOST_KEY_ACTIONS)(
    'builds a palette drop or Quick Add SSH Session Open node carrying %s',
    (action) => {
      setDefaultBlockAction(action)

      const node = buildPaletteNode('node-1', POS, SSH_OPEN_PALETTE, [])

      const expectedVersion = getControlVersions('ssh-session-open')[0]?.version || '1.0.0'
      expect(node).toEqual({
        id: 'node-1',
        type: 'workflowNode',
        position: POS,
        data: {
          label: 'SSH Session Open',
          elementType: 'ssh-session-open',
          nodeType: 'plugin',
          version: expectedVersion,
          config: stamped(action),
        },
      })
    },
  )

  it('never rewrites a placed block when the default changes later', () => {
    setDefaultBlockAction('strict')
    const placed = buildPaletteNode('n1', POS, SSH_OPEN_PALETTE, [])
    setDefaultBlockAction('disabled')

    const next = buildPaletteNode('n2', POS, SSH_OPEN_PALETTE, [placed])

    expect(placed.data.config).toEqual(stamped('strict'))
    expect(next.data.label).toBe('SSH Session Open_1')
    expect(next.data.config).toEqual(stamped('disabled'))
  })

  it('never rewrites the stored value of a block already on the canvas', () => {
    const existing = [
      {
        id: 'n0',
        data: {
          label: 'SSH Session Open',
          nodeType: 'plugin',
          elementType: 'ssh-session-open',
          config: stamped('strict'),
        },
      },
    ]
    setDefaultBlockAction('disabled')

    buildPaletteNode('n1', POS, SSH_OPEN_PALETTE, existing)

    expect(existing).toEqual([
      {
        id: 'n0',
        data: {
          label: 'SSH Session Open',
          nodeType: 'plugin',
          elementType: 'ssh-session-open',
          config: stamped('strict'),
        },
      },
    ])
  })

  it('builds other palette nodes without a config whatever the default', () => {
    setDefaultBlockAction('strict')

    const node = buildPaletteNode(
      'n1',
      POS,
      { id: 'ssh-session-exec', name: 'SSH Session Exec', type: 'plugin' },
      [],
    )

    expect(node.data).not.toHaveProperty('config')
  })
})

describe('buildLocalFunctionNode', () => {
  it('builds an empty Local Function with the label synced into the definition', () => {
    const node = buildLocalFunctionNode('fn-1', POS, [])
    expect(node).toEqual({
      id: 'fn-1',
      type: 'workflowNode',
      position: POS,
      data: {
        label: 'Function',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: {
          name: 'Function',
          workflow: { nodes: [], edges: [] },
          inputs: [],
          outputs: [],
        },
      },
    })
  })

  it('sequences the Function base name and keeps definition name in sync', () => {
    const node = buildLocalFunctionNode('fn-2', POS, [namingNode('Function')])
    expect(node.data.label).toBe('Function_1')
    expect(node.data.localDefinition?.name).toBe('Function_1')
  })
})

describe('buildPublishedFunctionNode', () => {
  it('builds a shared instance pinned to the payload version', () => {
    const node = buildPublishedFunctionNode(
      'fn-1',
      POS,
      { functionId: 'f-123', name: 'fetch_user', version: '1.2.0' },
      [],
    )
    expect(node).toEqual({
      id: 'fn-1',
      type: 'workflowNode',
      position: POS,
      data: {
        label: 'fetch_user',
        elementType: 'function',
        nodeType: 'function',
        functionLifecycle: 'shared',
        functionId: 'f-123',
        functionVersion: '1.2.0',
        originalLibraryName: 'fetch_user',
      },
    })
  })

  it('sequences the label but preserves the original library name', () => {
    const node = buildPublishedFunctionNode(
      'fn-2',
      POS,
      { functionId: 'f-123', name: 'fetch_user', version: '1.2.0' },
      [namingNode('fetch_user')],
    )
    expect(node.data.label).toBe('fetch_user_1')
    expect(node.data.originalLibraryName).toBe('fetch_user')
  })

  it('leaves functionVersion undefined when the payload has no version', () => {
    const node = buildPublishedFunctionNode(
      'fn-3',
      POS,
      { functionId: 'f-123', name: 'fetch_user' },
      [],
    )
    expect(node.data.functionVersion).toBeUndefined()
  })
})

/** A Shared Function payload that carries the inputs of the version it pins. */
type PinnedPayload = { functionId: string; name: string; version?: string; inputs?: FunctionInput[] }

const buildPinnedFunctionNode = buildPublishedFunctionNode as unknown as (
  newNodeId: string,
  position: { x: number; y: number },
  payload: PinnedPayload,
  existingNodes: ReadonlyArray<{ data: { label: string; nodeType?: string } }>,
) => ReturnType<typeof buildPublishedFunctionNode>

function input(spec: Partial<FunctionInput> & Pick<FunctionInput, 'name' | 'type'>): FunctionInput {
  return { required: false, default: null, description: '', ...spec }
}

const PINNED_INPUTS: FunctionInput[] = [
  input({ name: 'level', type: 'string', required: true, default: 'low', enumValues: ['low', 'high'] }),
  input({ name: 'retries', type: 'integer', required: true, default: 3, enumValues: [1, 3, 5] }),
  input({ name: 'verbose', type: 'boolean', default: false }),
  input({ name: 'strict', type: 'boolean', required: true, default: true }),
  input({ name: 'region', type: 'string', default: 'eu' }),
  input({ name: 'count', type: 'integer', required: true }),
  input({ name: 'token', type: 'string', secret: true }),
]

describe('Function Block builders - choice-list and true / false inputs start on their default (FIELD-8, REQ-3.1.2.10)', () => {
  it('a Shared Function Block holds the default of each choice-list and true / false input of its version, Required included', () => {
    const node = buildPinnedFunctionNode(
      'fn-1',
      POS,
      { functionId: 'f-123', name: 'fetch_user', version: '1.2.0', inputs: PINNED_INPUTS },
      [],
    )

    expect((node.data.config as { values?: unknown } | undefined)?.values).toEqual({
      level: 'low',
      retries: 3,
      verbose: false,
      strict: true,
    })
    expect(node.data).toMatchObject({
      label: 'fetch_user',
      functionLifecycle: 'shared',
      functionId: 'f-123',
      functionVersion: '1.2.0',
    })
  })
})

describe('getNodeOutputHandles - switch-case', () => {
  function switchNode(branches?: unknown) {
    return {
      id: 'sw-1',
      data: {
        elementType: 'switch-case',
        ...(branches === undefined ? {} : { config: { values: { branches } } }),
      },
    }
  }

  // Guard: a Switch declared no egress handles, so auto-wire made an unhandled edge.
  it('returns every branch id followed by the then egress', () => {
    expect(
      getNodeOutputHandles(
        switchNode([
          { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
          { id: 'branch_1', type: 'case', label: '', conditions: [], break: false },
          { id: 'branch_2', type: 'default', label: '' },
        ]),
      ),
    ).toEqual(['branch_0', 'branch_1', 'branch_2', 'then'])
  })

  it('returns only then for an empty branches array', () => {
    expect(getNodeOutputHandles(switchNode([]))).toEqual(['then'])
  })

  it('returns only then when the node carries no config', () => {
    expect(getNodeOutputHandles(switchNode())).toEqual(['then'])
  })

  it('returns only then when branches is not an array', () => {
    expect(getNodeOutputHandles(switchNode('branch_0'))).toEqual(['then'])
  })
})

describe('getNodeOutputHandles - parallel', () => {
  function parallelNode(branches?: unknown) {
    return {
      id: 'par-1',
      data: {
        elementType: 'parallel',
        ...(branches === undefined ? {} : { config: { values: { branches } } }),
      },
    }
  }

  // Guard: the flow leaves a section only through `then`, so auto-wire must
  // offer it after the branch lanes.
  it('returns every branch id followed by the then egress', () => {
    expect(
      getNodeOutputHandles(
        parallelNode([
          { id: 'branch_1', name: 'ingest' },
          { id: 'branch_2', name: 'probe' },
          { id: 'branch_3', name: '' },
        ]),
      ),
    ).toEqual(['branch_1', 'branch_2', 'branch_3', 'then'])
  })

  it('returns only then for an empty branches array', () => {
    expect(getNodeOutputHandles(parallelNode([]))).toEqual(['then'])
  })

  it('returns only then when the node carries no config', () => {
    expect(getNodeOutputHandles(parallelNode())).toEqual(['then'])
  })

  it('returns only then when branches is the old integer count', () => {
    expect(getNodeOutputHandles(parallelNode(2))).toEqual(['then'])
  })
})

describe('getNodeOutputHandles - wait-until', () => {
  function waitNode(mode?: string) {
    return {
      id: 'wait-1',
      data: {
        elementType: 'wait-until',
        ...(mode === undefined ? {} : { config: { values: { mode } } }),
      },
    }
  }

  // The canvas draws retry then then in Retry mode; an auto-wired block must land on the lane it is drawn on.
  it('returns the retry lane then the then egress in Retry mode', () => {
    expect(getNodeOutputHandles(waitNode('retry'))).toEqual(['retry', 'then'])
  })

  it('treats a node with no mode as Retry, as the canvas does', () => {
    expect(getNodeOutputHandles(waitNode())).toEqual(['retry', 'then'])
  })

  it('has the single default egress in Watch mode', () => {
    expect(getNodeOutputHandles(waitNode('watch'))).toBeNull()
  })
})

describe('getNodeOutputHandles - if-else', () => {
  function ifElseNode(branches?: unknown) {
    return {
      id: 'if-1',
      data: {
        elementType: 'if-else',
        ...(branches === undefined ? {} : { config: { values: { branches } } }),
      },
    }
  }

  it('returns every branch id in order, as the canvas draws them', () => {
    expect(
      getNodeOutputHandles(
        ifElseNode([
          { id: 'branch-if', type: 'if' },
          { id: 'branch-else-if', type: 'else_if' },
          { id: 'branch-else', type: 'else' },
        ]),
      ),
    ).toEqual(['branch-if', 'branch-else-if', 'branch-else'])
  })

  it('has the single default egress when it carries no branches', () => {
    expect(getNodeOutputHandles(ifElseNode([]))).toBeNull()
    expect(getNodeOutputHandles(ifElseNode())).toBeNull()
  })
})

describe('connectFromFirstFreeEgress', () => {
  function makeNode(
    id: string,
    elementType: string,
    config?: Record<string, unknown>,
  ) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        elementType,
        nodeType: 'plugin',
        ...(config ? { config } : {}),
      },
    }
  }

  function run(options: {
    nodes: unknown[]
    edges?: Array<{ id: string; source: string; target: string; sourceHandle?: string }>
    anchorId?: string
    valid?: boolean
  }) {
    const addEdge = vi.fn()
    const validate = vi.fn(() => ({ valid: options.valid ?? true }))
    const connected = connectFromFirstFreeEgress({
      anchorId: options.anchorId ?? 'a',
      newNodeId: 'new-1',
      nodes: options.nodes as never,
      edges: (options.edges ?? []) as never,
      validate: validate as never,
      addEdge: addEdge as never,
    })
    return { connected, addEdge, validate }
  }

  it('links a free single-handle anchor without a sourceHandle', () => {
    const { connected, addEdge } = run({ nodes: [makeNode('a', 'log')] })
    expect(connected).toBe(true)
    expect(addEdge).toHaveBeenCalledTimes(1)
    const edge = addEdge.mock.calls[0][0]
    expect(edge).toMatchObject({
      id: 'edge-a-new-1',
      source: 'a',
      target: 'new-1',
    })
    expect(edge.sourceHandle).toBeUndefined()
  })

  it('does not link when the single-handle anchor already has an egress', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'log'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b' }],
    })
    expect(connected).toBe(false)
    expect(addEdge).not.toHaveBeenCalled()
  })

  it('picks the first free handle of a for-loop anchor', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'for'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'body' }],
    })
    expect(connected).toBe(true)
    expect(addEdge.mock.calls[0][0]).toMatchObject({
      source: 'a',
      target: 'new-1',
      sourceHandle: 'then',
    })
  })

  it('does not link a for-loop anchor whose handles are all used', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'for'), makeNode('b', 'log'), makeNode('c', 'log')],
      edges: [
        { id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'body' },
        { id: 'edge-a-c', source: 'a', target: 'c', sourceHandle: 'then' },
      ],
    })
    expect(connected).toBe(false)
    expect(addEdge).not.toHaveBeenCalled()
  })

  // The canvas draws body + then lanes for every loop type. A While left out of
  // the handle list connects with no sourceHandle, and Break / Continue only
  // count a loop whose body edge carries 'body', so the While goes undetected.
  it('picks the first free handle of a while anchor (body then then)', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'while'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'body' }],
    })
    expect(connected).toBe(true)
    expect(addEdge.mock.calls[0][0]).toMatchObject({
      source: 'a',
      target: 'new-1',
      sourceHandle: 'then',
    })
  })

  it('links the first block under a while onto the body lane', () => {
    const { connected, addEdge } = run({ nodes: [makeNode('a', 'while')] })
    expect(connected).toBe(true)
    expect(addEdge.mock.calls[0][0]).toMatchObject({
      source: 'a',
      target: 'new-1',
      sourceHandle: 'body',
    })
  })

  it('picks the first free handle of a remote-execution anchor (body then then)', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'remote-execution'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'body' }],
    })
    expect(connected).toBe(true)
    expect(addEdge.mock.calls[0][0]).toMatchObject({
      source: 'a',
      target: 'new-1',
      sourceHandle: 'then',
    })
  })

  it('respects try-catch handle topology (default: try, catch, then)', () => {
    const { addEdge } = run({
      nodes: [makeNode('a', 'try-catch-finally'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'try' }],
    })
    expect(addEdge.mock.calls[0][0]).toMatchObject({ sourceHandle: 'catch' })
  })

  it('includes the finally handle when enabled in config values', () => {
    const { addEdge } = run({
      nodes: [
        makeNode('a', 'try-catch-finally', {
          values: { enable_catch: false, enable_finally: true },
        }),
        makeNode('b', 'log'),
      ],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'try' }],
    })
    expect(addEdge.mock.calls[0][0]).toMatchObject({ sourceHandle: 'finally' })
  })

  // Guard: auto-wire refused a second edge from a Switch anchor.
  it('picks the next free case handle of a switch anchor', () => {
    const { connected, addEdge } = run({
      nodes: [
        makeNode('a', 'switch-case', {
          values: {
            branches: [
              { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
              { id: 'branch_1', type: 'default', label: '' },
            ],
          },
        }),
        makeNode('b', 'log'),
      ],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'branch_0' }],
    })
    expect(connected).toBe(true)
    expect(addEdge.mock.calls[0][0]).toMatchObject({ sourceHandle: 'branch_1' })
  })

  it('treats split-mode assert as pass/fail handles', () => {
    const { addEdge } = run({
      nodes: [makeNode('a', 'assert'), makeNode('b', 'log')],
      edges: [{ id: 'edge-a-b', source: 'a', target: 'b', sourceHandle: 'pass' }],
    })
    expect(addEdge.mock.calls[0][0]).toMatchObject({ sourceHandle: 'fail' })
  })

  it('treats single-mode assert as a single default handle', () => {
    const { addEdge } = run({
      nodes: [makeNode('a', 'assert', { values: { mode: 'single' } })],
    })
    const edge = addEdge.mock.calls[0][0]
    expect(edge).toMatchObject({ source: 'a', target: 'new-1' })
    expect(edge.sourceHandle).toBeUndefined()
  })

  it('never links from a halt anchor (no egress handles)', () => {
    const { connected, addEdge } = run({ nodes: [makeNode('a', 'halt')] })
    expect(connected).toBe(false)
    expect(addEdge).not.toHaveBeenCalled()
  })

  it('does not link when the validator rejects the connection', () => {
    const { connected, addEdge, validate } = run({
      nodes: [makeNode('a', 'log')],
      valid: false,
    })
    expect(validate).toHaveBeenCalled()
    expect(connected).toBe(false)
    expect(addEdge).not.toHaveBeenCalled()
  })

  it('returns false for an unknown anchor id', () => {
    const { connected, addEdge } = run({
      nodes: [makeNode('a', 'log')],
      anchorId: 'ghost',
    })
    expect(connected).toBe(false)
    expect(addEdge).not.toHaveBeenCalled()
  })
})

describe('connectFromFirstFreeEgress - Wait Until and If/Else', () => {
  function control(id: string, elementType: string, values: Record<string, unknown>) {
    return { id, type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: id, elementType, nodeType: 'control', config: { values } } }
  }

  function wire(anchor: unknown, edges: unknown[] = []) {
    const addEdge = vi.fn()
    connectFromFirstFreeEgress({
      anchorId: (anchor as { id: string }).id,
      newNodeId: 'new-1',
      nodes: [anchor] as never,
      edges: edges as never,
      validate: (() => ({ valid: true })) as never,
      addEdge: addEdge as never,
    })
    return addEdge.mock.calls[0]?.[0]
  }

  it('wires a block added under a Retry-mode Wait Until onto its retry lane', () => {
    expect(wire(control('w', 'wait-until', { mode: 'retry' }))).toMatchObject({ sourceHandle: 'retry' })
  })

  it('wires the next block onto then once the retry lane is taken', () => {
    const edges = [{ id: 'e1', source: 'w', target: 'x', sourceHandle: 'retry' }]
    expect(wire(control('w', 'wait-until', { mode: 'retry' }), edges)).toMatchObject({ sourceHandle: 'then' })
  })

  it('wires a block added under an If/Else onto its first branch', () => {
    const branches = [{ id: 'b-if', type: 'if' }, { id: 'b-else', type: 'else' }]
    expect(wire(control('i', 'if-else', { branches }))).toMatchObject({ sourceHandle: 'b-if' })
  })
})

describe('getNodeOutputHandles - no element type', () => {
  it('has the single default egress for a node with no data or no element type', () => {
    expect(getNodeOutputHandles({ id: 'n-1' })).toBeNull()
    expect(getNodeOutputHandles({ id: 'n-2', data: {} })).toBeNull()
  })
})
