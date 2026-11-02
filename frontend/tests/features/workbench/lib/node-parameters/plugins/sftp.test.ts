/** SFTP descriptor tests (REQ-3.4.1.8, REQ-3.4.2.2; SFTP-2, SFTP-4, SFTP-5, SFTP-6, SFTP-8, SFTP-9). */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  getSecretMaskFields,
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
import { sshSessionIdInput } from '@/features/workbench/lib/node-parameters/plugins/_ssh-session-shared'
import {
  ifExistsInput,
  ignoreMissingInput,
  includeSubfoldersInput,
  transferLimitInputs,
} from '@/features/workbench/lib/node-parameters/plugins/_file-shared'
import {
  deriveGroups,
  isParameterVisible,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const ID = 'sftp'
const SFTP_MODULE = '@/features/workbench/lib/node-parameters/plugins/sftp'
const REGISTRY_MODULE = '@/features/workbench/lib/node-parameters'

const UPLOAD = { field: 'operation', values: ['upload'] }
const DOWNLOAD = { field: 'operation', values: ['download'] }
const LIST = { field: 'operation', values: ['list'] }
const STATS = { field: 'operation', values: ['stats'] }
const DELETE = { field: 'operation', values: ['delete'] }
const MOVE = { field: 'operation', values: ['move'] }
const CREATE_FOLDER = { field: 'operation', values: ['create_folder'] }
const TRANSFER_OR_MOVE = { field: 'operation', values: ['upload', 'download', 'move'] }
const UPLOAD_OR_DOWNLOAD = { field: 'operation', values: ['upload', 'download'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const ADVANCED = 'Advanced'
const ADVANCED_DESCRIPTION = 'Limits for this block'
const MAX_SIZE_LABEL = 'Max size (MiB)'

const OPERATIONS = ['upload', 'download', 'list', 'stats', 'delete', 'move', 'create_folder']

const OPERATION_LABELS = {
  upload: 'Upload',
  download: 'Download',
  list: 'List',
  stats: 'Stats',
  delete: 'Delete',
  move: 'Move',
  create_folder: 'Create folder',
}

const SESSION_ID_DESCRIPTION =
  "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it"

const OPERATION_DESCRIPTION =
  'What to do. Upload and Download move files between WAVE and the server; List, Stats, Delete, Move and Create folder work on the server.'

const SOURCE_UPLOAD_DESCRIPTION =
  'File or folder on WAVE to upload. Pick a Test Data or Artifact entry with Browse, or type testdata://, artifact:// or an absolute or relative path. A folder goes with everything inside it; *, ? and [...] match several files.'

const SOURCE_DOWNLOAD_DESCRIPTION =
  'File or folder on the server to download. A folder comes with everything inside it; *, ? and [...] match several files.'

const SOURCE_MOVE_DESCRIPTION = 'File or folder on the server to move or rename.'

const DESTINATION_UPLOAD_DESCRIPTION =
  'Where it goes on the server. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only. Missing folders are created.'

const DESTINATION_DOWNLOAD_DESCRIPTION =
  "Where it lands on WAVE: artifact:// or an absolute or relative path; testdata:// is read-only. Empty puts it in the run's artifacts under its own name. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only."

const DESTINATION_MOVE_DESCRIPTION =
  'The new path on the server. An existing folder or a path ending in / keeps the name.'

const PATH_LIST_DESCRIPTION =
  'Folder on the server to list, or a pattern: *, ? and [...] list only the matching entries. No match gives no entries and a Count of 0.'

const PATH_STATS_DESCRIPTION =
  'File or folder on the server to report on. A missing path is not an error: Exists is false.'

const PATH_DELETE_DESCRIPTION =
  "File or folder on the server to delete; a folder goes with everything inside it, and *, ? and [...] delete every match. A path that names the account's home or the server root (empty, ., ~ or /) is refused."

const PATH_CREATE_FOLDER_DESCRIPTION =
  'Folder to create on the server, including its name. Missing parent folders are created.'

const IF_EXISTS_DESCRIPTION =
  'What happens when a file is already at the destination: Replace it overwrites it; Fail the block stops before anything is written.'

const RECURSIVE_DESCRIPTION = 'List the entries inside subfolders too, at every depth.'

const MISSING_OK_DESCRIPTION =
  'Pass when the path or pattern matches nothing, instead of failing the block.'

const TIMEOUT_DESCRIPTION = 'Seconds the whole block may take, every file of a folder included.'

const MAX_SIZE_DESCRIPTION =
  'Largest total a download may bring, in MiB. The block adds up the match before it writes anything and refuses a larger one. 0 means no limit.'

const MAX_FILES_DESCRIPTION =
  'Most files a download may bring. The block counts the match before it writes anything and refuses more. 0 means no limit.'

const ON_ERROR_DESCRIPTION = 'Fail the block, or record the outcome and let the test continue.'

const SUMMARY_DESCRIPTION = 'One row per file transferred: source, destination and size.'

const ENTRIES_DESCRIPTION =
  'One row per entry: name, path, type, modified and size. Include subfolders adds the entries of every subfolder.'

const COUNT_DESCRIPTION = 'Number of entries; 0 when nothing matches.'
const EXISTS_DESCRIPTION = 'True when the path is there on the server.'
const TYPE_DESCRIPTION = 'Whether the path is a file or a folder; empty when the path is missing.'
const SIZE_DESCRIPTION = 'Size in bytes of a file; 0 for a folder or a missing path.'
const MODIFIED_DESCRIPTION = 'Last modified, ISO-8601 UTC; empty when the path is missing.'

const SUCCESS_DESCRIPTION =
  'True when the operation finished. False when the block failed and On error is Record and continue.'

const ERROR_DESCRIPTION =
  'The error message when the operation failed under Record and continue; empty otherwise'

const REASON_DESCRIPTION =
  'Why it failed: SessionClosed, SftpUnavailable, NoMatch, NotFound, NotAFolder, Conflict, Exists, ReadOnly, TooManyFiles, TooLarge, UnsafeEntry, Refused, PermissionDenied, ConnectionLost, ServerFailure, LocalFailure or Timeout; empty when it passed.'

/** One flavor of a paired path row: plain text, gated on one operation. */
function pathRow(
  name: string,
  label: string,
  required: boolean,
  showWhen: { field: string; values: string[] },
  description: string,
  fileReference?: InputParam['fileReference'],
): InputParam {
  return {
    name,
    label,
    type: 'string',
    required,
    description,
    showWhen,
    allowedFormats: ['plain'],
    ...(fileReference ? { fileReference } : {}),
  }
}

/** The 19 descriptors in declaration order, every key they carry. */
const EXPECTED: InputParam[] = [
  {
    name: 'session_id',
    label: 'Session ID',
    type: 'string',
    required: true,
    description: SESSION_ID_DESCRIPTION,
    allowedFormats: ['plain'],
  },
  {
    name: 'operation',
    label: 'Operation',
    type: 'string',
    required: true,
    description: OPERATION_DESCRIPTION,
    enumValues: OPERATIONS,
    enumLabels: OPERATION_LABELS,
    defaultValue: 'upload',
    noExpression: true,
  },
  pathRow('source', 'Source', true, UPLOAD, SOURCE_UPLOAD_DESCRIPTION, 'file-or-folder'),
  pathRow('source', 'Source', true, DOWNLOAD, SOURCE_DOWNLOAD_DESCRIPTION),
  pathRow('source', 'Source', true, MOVE, SOURCE_MOVE_DESCRIPTION),
  pathRow('destination', 'Destination', true, UPLOAD, DESTINATION_UPLOAD_DESCRIPTION),
  pathRow('destination', 'Destination', false, DOWNLOAD, DESTINATION_DOWNLOAD_DESCRIPTION, 'save-as'),
  pathRow('destination', 'Destination', true, MOVE, DESTINATION_MOVE_DESCRIPTION),
  pathRow('path', 'Path', true, LIST, PATH_LIST_DESCRIPTION),
  pathRow('path', 'Path', true, STATS, PATH_STATS_DESCRIPTION),
  pathRow('path', 'Path', true, DELETE, PATH_DELETE_DESCRIPTION),
  pathRow('path', 'Path', true, CREATE_FOLDER, PATH_CREATE_FOLDER_DESCRIPTION),
  {
    name: 'if_exists',
    label: 'If the file exists',
    type: 'string',
    required: false,
    description: IF_EXISTS_DESCRIPTION,
    enumValues: ['overwrite', 'fail'],
    enumLabels: { overwrite: 'Replace it', fail: 'Fail the block' },
    defaultValue: 'overwrite',
    noExpression: true,
    showWhen: TRANSFER_OR_MOVE,
  },
  {
    name: 'recursive',
    label: 'Include subfolders',
    type: 'boolean',
    required: false,
    description: RECURSIVE_DESCRIPTION,
    defaultValue: false,
    showWhen: LIST,
  },
  {
    name: 'missing_ok',
    label: 'Ignore missing',
    type: 'boolean',
    required: false,
    description: MISSING_OK_DESCRIPTION,
    defaultValue: false,
    showWhen: DELETE,
  },
  {
    name: 'timeout',
    label: 'Timeout',
    type: 'integer',
    required: false,
    description: TIMEOUT_DESCRIPTION,
    defaultValue: 300,
    minimum: 1,
    group: ADVANCED,
  },
  {
    name: 'max_size_mib',
    label: MAX_SIZE_LABEL,
    type: 'integer',
    required: false,
    description: MAX_SIZE_DESCRIPTION,
    defaultValue: 1024,
    minimum: 0,
    showWhen: DOWNLOAD,
    group: ADVANCED,
  },
  {
    name: 'max_files',
    label: 'Max files',
    type: 'integer',
    required: false,
    description: MAX_FILES_DESCRIPTION,
    defaultValue: 10000,
    minimum: 0,
    showWhen: DOWNLOAD,
    group: ADVANCED,
  },
  {
    name: 'on_error',
    label: 'On error',
    type: 'string',
    required: false,
    description: ON_ERROR_DESCRIPTION,
    enumValues: ['fail', 'record'],
    enumLabels: { fail: 'Fail the block', record: 'Record and continue' },
    defaultValue: 'fail',
    noExpression: true,
    group: FAILURE_HANDLING_GROUP,
  },
]

const WIRE_NAMES = [
  'session_id',
  'operation',
  'source',
  'destination',
  'path',
  'if_exists',
  'recursive',
  'missing_ok',
  'timeout',
  'max_size_mib',
  'max_files',
  'on_error',
]

const PAIR_COUNTS: Record<string, number> = { source: 3, destination: 3, path: 4 }

const NEVER_DECLARED_KEYS: (keyof InputParam)[] = [
  'retainOnHide',
  'requiredWhen',
  'requiredWhenAll',
  'showWhenAll',
  'showWhenAny',
  'placeholder',
  'maximum',
  'note',
]

const EXPECTED_OUTPUTS: OutputParam[] = [
  { name: 'summary', label: 'Summary', type: 'table', description: SUMMARY_DESCRIPTION, showWhen: UPLOAD_OR_DOWNLOAD },
  { name: 'entries', label: 'Entries', type: 'table', description: ENTRIES_DESCRIPTION, showWhen: LIST },
  { name: 'count', label: 'Count', type: 'integer', description: COUNT_DESCRIPTION, showWhen: LIST },
  { name: 'exists', label: 'Exists', type: 'boolean', description: EXISTS_DESCRIPTION, showWhen: STATS },
  { name: 'type', label: 'Type', type: 'string', description: TYPE_DESCRIPTION, showWhen: STATS },
  { name: 'size', label: 'Size', type: 'integer', description: SIZE_DESCRIPTION, showWhen: STATS },
  { name: 'modified', label: 'Modified', type: 'string', description: MODIFIED_DESCRIPTION, showWhen: STATS },
  { name: 'success', label: 'Success', type: 'boolean', description: SUCCESS_DESCRIPTION },
  { name: 'error', label: 'Error', type: 'string', description: ERROR_DESCRIPTION, showWhen: RECORD_GATE },
  { name: 'reason', label: 'Reason', type: 'string', description: REASON_DESCRIPTION, showWhen: RECORD_GATE },
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

/** Every descriptor under one wire name, in declaration order. */
function inputsNamed(name: string): InputParam[] {
  return inputs().filter((p) => p.name === name)
}

/** The one descriptor under a wire name; fails the test when there is not exactly one. */
function single(name: string): InputParam {
  const rows = inputsNamed(name)
  expect(rows, `descriptors named ${name}`).toHaveLength(1)
  return rows[0]
}

function label(entry: { name: string; label?: string }): string {
  return entry.label ?? entry.name
}

/** The column of one key across the declared rows, in order. */
function column<K extends keyof InputParam>(key: K): InputParam[K][] {
  return inputs().map((p) => p[key])
}

function expectedColumn<K extends keyof InputParam>(key: K): InputParam[K][] {
  return EXPECTED.map((p) => p[key])
}

/** The descriptors the INPUT table renders for one set of values, in order. */
function visibleRows(values: Record<string, unknown>): InputParam[] {
  const all = table()
  return inputs().filter((_, i) => isParameterVisible(all[i], values, all))
}

function visibleWireNames(values: Record<string, unknown>): string[] {
  return visibleRows(values).map((p) => p.name)
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
    groupDescription: (name: string) => groups.find((g) => g.name === name)?.description,
  }
}

/** The outputs the OUTPUT table offers for one set of values, in order. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const all = table()
  return outputs()
    .filter((o) => isParameterVisible(o, values, all))
    .map((o) => o.name)
}

/** The wire names a switch keeps, clears and newly shows, by the parameter table's rule. */
function switchOperation(from: string, to: string) {
  const before = visibleWireNames({ operation: from })
  const after = visibleWireNames({ operation: to })
  return {
    kept: before.filter((n) => n !== 'operation' && after.includes(n)),
    cleared: before.filter((n) => !after.includes(n)),
    shown: after.filter((n) => !before.includes(n)),
  }
}

// ---------------------------------------------------------------------------
// The sheet per Operation, as the approved wireframes show it
// ---------------------------------------------------------------------------

interface OperationState {
  operation: string
  top: string[]
  required: string[]
  advanced: string[]
  outputs: string[]
}

const TRANSFER_TOP = ['Session ID', 'Operation', 'Source', 'Destination', 'If the file exists']

const OPERATION_STATES: OperationState[] = [
  {
    operation: 'upload',
    top: TRANSFER_TOP,
    required: ['session_id', 'operation', 'source', 'destination'],
    advanced: ['Timeout'],
    outputs: ['summary', 'success'],
  },
  {
    operation: 'download',
    top: TRANSFER_TOP,
    required: ['session_id', 'operation', 'source'],
    advanced: ['Timeout', MAX_SIZE_LABEL, 'Max files'],
    outputs: ['summary', 'success'],
  },
  {
    operation: 'list',
    top: ['Session ID', 'Operation', 'Path', 'Include subfolders'],
    required: ['session_id', 'operation', 'path'],
    advanced: ['Timeout'],
    outputs: ['entries', 'count', 'success'],
  },
  {
    operation: 'stats',
    top: ['Session ID', 'Operation', 'Path'],
    required: ['session_id', 'operation', 'path'],
    advanced: ['Timeout'],
    outputs: ['exists', 'type', 'size', 'modified', 'success'],
  },
  {
    operation: 'delete',
    top: ['Session ID', 'Operation', 'Path', 'Ignore missing'],
    required: ['session_id', 'operation', 'path'],
    advanced: ['Timeout'],
    outputs: ['success'],
  },
  {
    operation: 'move',
    top: TRANSFER_TOP,
    required: ['session_id', 'operation', 'source', 'destination'],
    advanced: ['Timeout'],
    outputs: ['success'],
  },
  {
    operation: 'create_folder',
    top: ['Session ID', 'Operation', 'Path'],
    required: ['session_id', 'operation', 'path'],
    advanced: ['Timeout'],
    outputs: ['success'],
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers sftp in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers sftp in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers sftp in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves sftp via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
  })

  it('registers the inputs, outputs and groups the sftp module exports', async () => {
    // The global afterEach resets modules, so load the registry and the module from the same graph.
    const registry = (await import(/* @vite-ignore */ REGISTRY_MODULE)) as {
      PLUGIN_INPUTS: typeof PLUGIN_INPUTS
      PLUGIN_OUTPUTS: typeof PLUGIN_OUTPUTS
      PLUGIN_GROUPS: typeof PLUGIN_GROUPS
    }
    const sftp = (await import(/* @vite-ignore */ SFTP_MODULE)) as {
      inputs: InputParam[]
      outputs: OutputParam[]
      groups: Record<string, GroupMeta>
    }
    expect(registry.PLUGIN_INPUTS[ID]).toBe(sftp.inputs)
    expect(registry.PLUGIN_OUTPUTS[ID]).toBe(sftp.outputs)
    expect(registry.PLUGIN_GROUPS[ID]).toBe(sftp.groups)
  })

  it('declares no Secret Masking catalog, having no secret row', () => {
    expect(getSecretMaskFields(ID)).toBeUndefined()
  })

  it('serves the 19 rows and the 10 outputs', () => {
    const rows = getInputParams(ID)
    const outs = getOutputParams(ID)

    expect(rows).toHaveLength(19)
    expect(rows).toBe(PLUGIN_INPUTS[ID])
    expect(outs).toHaveLength(10)
    expect(outs).toBe(PLUGIN_OUTPUTS[ID])
  })

})

describe('schema surface (SFTP-2)', () => {
  it('declares the 19 descriptors in sheet order', () => {
    expect(inputs().map((p) => p.name)).toEqual(EXPECTED.map((p) => p.name))
    expect(inputs()).toHaveLength(19)
  })

  it('sends exactly 12 wire names to the backend', () => {
    const distinct = [...new Set(inputs().map((p) => p.name))]

    expect(distinct).toEqual(WIRE_NAMES)
    expect(distinct).toHaveLength(12)
  })

  it('declares Source and Destination three times each, Path four times, every other name once', () => {
    for (const name of WIRE_NAMES) {
      expect(inputsNamed(name), name).toHaveLength(PAIR_COUNTS[name] ?? 1)
    }
  })

  it('labels every descriptor', () => {
    expect(inputs().map(label)).toEqual(EXPECTED.map(label))
  })

  it('types every descriptor', () => {
    expect(column('type')).toEqual(expectedColumn('type'))
  })

  it('defaults every descriptor', () => {
    expect(column('defaultValue')).toEqual(expectedColumn('defaultValue'))
  })

  it('marks the required rows outright, the Download Destination excepted', () => {
    expect(column('required')).toEqual(expectedColumn('required'))
  })

  it('gates every descriptor on the operation that shows it', () => {
    expect(column('showWhen')).toEqual(expectedColumn('showWhen'))
  })

  it('carries the exact info-badge copy on every descriptor', () => {
    expect(column('description')).toEqual(expectedColumn('description'))
  })

  it('files Timeout and the two limits in Advanced and On error in Failure Handling', () => {
    expect(column('group')).toEqual(expectedColumn('group'))
  })

  it('declares a minimum on Timeout and the two limits only, and no maximum anywhere', () => {
    expect(column('minimum')).toEqual(expectedColumn('minimum'))
    expect(column('maximum')).toEqual(EXPECTED.map(() => undefined))
  })

  it('turns the expression toggle off on Operation, If the file exists and On error only', () => {
    expect(column('noExpression')).toEqual(expectedColumn('noExpression'))
  })

  it('locks Session ID and every path row to plain text', () => {
    expect(column('allowedFormats')).toEqual(expectedColumn('allowedFormats'))
  })

  it('declares the enum lists and labels on Operation, If the file exists and On error', () => {
    expect(column('enumValues')).toEqual(expectedColumn('enumValues'))
    expect(column('enumLabels')).toEqual(expectedColumn('enumLabels'))
  })

  it('browses only the Upload Source and the Download Destination (SFTP-4)', () => {
    expect(column('fileReference')).toEqual([
      undefined,
      undefined,
      'file-or-folder',
      undefined,
      undefined,
      undefined,
      'save-as',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('leaves the artifacts-only narrowing off every row, save-as offering Artifacts alone', () => {
    expect(inputs()).toHaveLength(19)
    for (const p of inputs()) {
      expect(p.fileReferenceArtifactsOnly, p.description).toBeUndefined()
    }
  })

  it('declares none of the keys a one-visible-descriptor pair never needs', () => {
    expect(inputs()).toHaveLength(19)
    for (const p of inputs()) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(p[key], `${p.name}.${key}: ${p.description}`).toBeUndefined()
      }
    }
  })

  it('marks no descriptor secret', () => {
    expect(inputs()).toHaveLength(19)
    expect(inputs().filter((p) => p.secret === true).map((p) => p.name)).toEqual([])
  })

  it('declares every descriptor exactly', () => {
    expect(inputs()).toEqual(EXPECTED)
  })
})

describe('Operation (SFTP-2)', () => {
  it('lists the seven operations in wireframe order, defaulting to Upload', () => {
    const operation = single('operation')

    expect(operation.enumValues).toEqual(OPERATIONS)
    expect(operation.enumLabels).toEqual(OPERATION_LABELS)
    expect(operation.defaultValue).toBe('upload')
    expect(operation.noExpression).toBe(true)
  })
})

describe('the shared rows', () => {
  it('reuses the SSH Session ID row as it is', () => {
    expect(inputs()[0]).toEqual(sshSessionIdInput)
  })

  it('builds If the file exists without Append, for Upload, Download and Move (SFTP-5)', () => {
    expect(single('if_exists')).toEqual(ifExistsInput(IF_EXISTS_DESCRIPTION, TRANSFER_OR_MOVE))
  })

  it('builds Include subfolders for List, keeping its expression toggle', () => {
    expect(single('recursive')).toEqual(includeSubfoldersInput(RECURSIVE_DESCRIPTION, LIST))
  })

  it('builds Ignore missing for Delete', () => {
    expect(single('missing_ok')).toEqual(ignoreMissingInput(MISSING_OK_DESCRIPTION, DELETE))
  })

  it('builds Timeout from the shared row, filed in Advanced (SFTP-8)', () => {
    expect(single('timeout')).toEqual({ ...timeoutInput(300, TIMEOUT_DESCRIPTION), group: ADVANCED })
  })

  it('builds the two limits from the shared pair, gated on Download and filed in Advanced (SFTP-6)', () => {
    const limits = inputs().filter((p) => p.name === 'max_size_mib' || p.name === 'max_files')
    const shared = transferLimitInputs({
      maxSizeMib: 1024,
      maxFiles: 10000,
      showWhen: DOWNLOAD,
      sizeDescription: MAX_SIZE_DESCRIPTION,
      filesDescription: MAX_FILES_DESCRIPTION,
    })

    expect(limits).toEqual(shared.map((row) => ({ ...row, group: ADVANCED })))
  })

  it('closes with the shared On error row in Failure Handling', () => {
    expect(inputs()[18]).toEqual(failureHandlingOnErrorInput())
  })
})

describe('groups (SFTP-6, SFTP-8)', () => {
  it('declares Advanced then Failure Handling', () => {
    expect(Object.keys(getGroupMeta(ID) ?? {})).toEqual([ADVANCED, FAILURE_HANDLING_GROUP])
  })

  it('footers Advanced with the block limits line and keeps it collapsed', () => {
    const advanced = getGroupMeta(ID)?.[ADVANCED]

    expect(advanced).toEqual({ name: ADVANCED, description: ADVANCED_DESCRIPTION })
    expect(advanced?.defaultExpanded).toBeUndefined()
  })

  it('declares Failure Handling as the shared group', () => {
    expect(getGroupMeta(ID)?.[FAILURE_HANDLING_GROUP]).toEqual(failureHandlingGroup())
  })
})

describe('rows per operation (SFTP-2, SFTP-4)', () => {
  it.each(OPERATION_STATES)('shows $operation its own top rows in wireframe order', (state) => {
    expect(sheet({ operation: state.operation }).top).toEqual(state.top)
  })

  it.each(OPERATION_STATES)('shows $operation the Advanced rows it declares', (state) => {
    const view = sheet({ operation: state.operation })

    expect(view.groupOrder).toEqual([ADVANCED, FAILURE_HANDLING_GROUP])
    expect(view.group(ADVANCED)).toEqual(state.advanced)
    expect(view.group(FAILURE_HANDLING_GROUP)).toEqual(['On error'])
    expect(view.groupDescription(ADVANCED)).toBe(ADVANCED_DESCRIPTION)
  })

  it.each(OPERATION_STATES)('shows $operation exactly one descriptor per wire name', (state) => {
    const names = visibleWireNames({ operation: state.operation })

    expect(names).toEqual([...new Set(names)])
  })

  it.each(OPERATION_STATES)('marks the $operation rows the wireframe stars', (state) => {
    const required = visibleRows({ operation: state.operation })
      .filter((p) => p.required)
      .map((p) => p.name)

    expect(required).toEqual(state.required)
  })

  it('opens on Upload when no operation is stored yet', () => {
    expect(visibleWireNames({})).toEqual(visibleWireNames({ operation: 'upload' }))
  })

  it('shows each operation its own Source, Destination and Path flavor', () => {
    const description = (operation: string, name: string) =>
      visibleRows({ operation }).find((p) => p.name === name)?.description

    expect(description('upload', 'source')).toBe(SOURCE_UPLOAD_DESCRIPTION)
    expect(description('download', 'source')).toBe(SOURCE_DOWNLOAD_DESCRIPTION)
    expect(description('move', 'source')).toBe(SOURCE_MOVE_DESCRIPTION)
    expect(description('upload', 'destination')).toBe(DESTINATION_UPLOAD_DESCRIPTION)
    expect(description('download', 'destination')).toBe(DESTINATION_DOWNLOAD_DESCRIPTION)
    expect(description('move', 'destination')).toBe(DESTINATION_MOVE_DESCRIPTION)
    expect(description('list', 'path')).toBe(PATH_LIST_DESCRIPTION)
    expect(description('stats', 'path')).toBe(PATH_STATS_DESCRIPTION)
    expect(description('delete', 'path')).toBe(PATH_DELETE_DESCRIPTION)
    expect(description('create_folder', 'path')).toBe(PATH_CREATE_FOLDER_DESCRIPTION)
  })

  it('offers Browse on the WAVE-side row of Upload and Download and on no other visible row', () => {
    const browsing = (operation: string) =>
      visibleRows({ operation })
        .filter((p) => p.fileReference !== undefined)
        .map((p) => [p.name, p.fileReference])

    expect(browsing('upload')).toEqual([['source', 'file-or-folder']])
    expect(browsing('download')).toEqual([['destination', 'save-as']])
    for (const operation of ['list', 'stats', 'delete', 'move', 'create_folder']) {
      expect(browsing(operation), operation).toEqual([])
    }
  })

  it('starts the Download limits at 1024 MiB and 10000 files', () => {
    const limits = visibleRows({ operation: 'download' }).filter((p) => p.group === ADVANCED)

    expect(limits.map((p) => [p.name, p.defaultValue])).toEqual([
      ['timeout', 300],
      ['max_size_mib', 1024],
      ['max_files', 10000],
    ])
  })
})

describe('switching Operation (a value survives while its wire name stays visible)', () => {
  const TRANSFER_KEPT = ['session_id', 'source', 'destination', 'if_exists', 'timeout', 'on_error']
  const LIMITS = ['max_size_mib', 'max_files']

  it('keeps every transfer row between Upload and Download, adding the limits on Download', () => {
    expect(switchOperation('upload', 'download')).toEqual({
      kept: TRANSFER_KEPT,
      cleared: [],
      shown: LIMITS,
    })
  })

  it('clears the limits when leaving Download for Upload or Move', () => {
    for (const to of ['upload', 'move']) {
      expect(switchOperation('download', to), to).toEqual({
        kept: TRANSFER_KEPT,
        cleared: LIMITS,
        shown: [],
      })
    }
  })

  it('keeps every row between Upload and Move', () => {
    expect(switchOperation('upload', 'move')).toEqual({ kept: TRANSFER_KEPT, cleared: [], shown: [] })
    expect(switchOperation('move', 'upload')).toEqual({ kept: TRANSFER_KEPT, cleared: [], shown: [] })
  })

  it('adds the limits when entering Download from Move', () => {
    expect(switchOperation('move', 'download')).toEqual({
      kept: TRANSFER_KEPT,
      cleared: [],
      shown: LIMITS,
    })
  })

  it('keeps only Session ID, Timeout and On error from a transfer to a path operation', () => {
    const toggles: Record<string, string[]> = {
      list: ['recursive'],
      stats: [],
      delete: ['missing_ok'],
      create_folder: [],
    }
    for (const from of ['upload', 'download', 'move']) {
      for (const [to, toggle] of Object.entries(toggles)) {
        const extra = from === 'download' ? LIMITS : []
        expect(switchOperation(from, to), `${from} -> ${to}`).toEqual({
          kept: ['session_id', 'timeout', 'on_error'],
          cleared: ['source', 'destination', 'if_exists', ...extra],
          shown: ['path', ...toggle],
        })
      }
    }
  })

  it('keeps Path among the path operations, swapping only their own toggles', () => {
    const toggles: Record<string, string[]> = {
      list: ['recursive'],
      stats: [],
      delete: ['missing_ok'],
      create_folder: [],
    }
    for (const [from, fromToggle] of Object.entries(toggles)) {
      for (const [to, toToggle] of Object.entries(toggles)) {
        if (from === to) continue
        expect(switchOperation(from, to), `${from} -> ${to}`).toEqual({
          kept: ['session_id', 'path', 'timeout', 'on_error'],
          cleared: fromToggle,
          shown: toToggle,
        })
      }
    }
  })
})

describe('outputs (SFTP-9)', () => {
  it('declares the ten outputs in order, typed', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual(
      EXPECTED_OUTPUTS.map((o) => [o.name, o.type]),
    )
  })

  it('labels every output', () => {
    expect(outputs().map(label)).toEqual(EXPECTED_OUTPUTS.map(label))
  })

  it('carries the exact copy on every output', () => {
    expect(outputs().map((o) => o.description)).toEqual(
      EXPECTED_OUTPUTS.map((o) => o.description),
    )
  })

  it('gates each operation output on its operation and Error and Reason on Record and continue', () => {
    expect(outputs().map((o) => o.showWhen)).toEqual(EXPECTED_OUTPUTS.map((o) => o.showWhen))
  })

  it('closes with the shared Success, Error and Reason core', () => {
    expect(outputs().slice(7)).toEqual(
      outputCore({ successDescription: SUCCESS_DESCRIPTION, reasonDescription: REASON_DESCRIPTION }),
    )
  })

  it('declares every output exactly', () => {
    expect(outputs()).toEqual(EXPECTED_OUTPUTS)
  })

  it.each(OPERATION_STATES)('offers $operation its outputs while On error is Fail the block', (state) => {
    expect(visibleOutputs({ operation: state.operation })).toEqual(state.outputs)
    expect(visibleOutputs({ operation: state.operation, on_error: 'fail' })).toEqual(state.outputs)
  })

  it.each(OPERATION_STATES)('adds Error and Reason to $operation under Record and continue', (state) => {
    expect(visibleOutputs({ operation: state.operation, on_error: 'record' })).toEqual([
      ...state.outputs,
      'error',
      'reason',
    ])
  })
})
