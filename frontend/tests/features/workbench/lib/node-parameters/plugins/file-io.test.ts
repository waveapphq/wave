/**
 * File I/O plugin parameter schema tests (REQ-3.4.1.10, REQ-3.4.2.2).
 *
 * File I/O is one flat form driven by Operation: each of the eight operations
 * shows its own rows and its own outputs. Path and Source are paired
 * descriptors - one wire name, one flavor per operation - so the info badge,
 * the placeholder and the picker mode always describe the operation on screen.
 *
 * Design decisions: FIO-1 through FIO-10, TDATA-8, TDATA-10
 */

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
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import {
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { computeNodeIssues } from '@/features/workbench/lib/validation/compute-node-issues'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'

const ID = 'file-io'

type FileReferenceMode = 'file' | 'file-or-folder' | 'folder' | 'save-as'

interface FileReferenceKeys {
  fileReference?: FileReferenceMode
  fileReferenceArtifactsOnly?: boolean
}

interface Gated {
  showWhenAll?: { field: string; values: string[] }[]
  retainOnHide?: boolean
}

/** The two picker keys read off a row without widening the row to `unknown`. */
function fileRef(row: InputParam): FileReferenceKeys {
  return row as InputParam & FileReferenceKeys
}

/** An output's conjunctive gate; outputs pair a wire name the same way inputs do. */
function gateOf(out: OutputParam): Gated {
  return out as OutputParam & Gated
}

const OPERATIONS = [
  'read',
  'write',
  'copy',
  'move',
  'delete',
  'stats',
  'list',
  'create_folder',
] as const

const READ = { field: 'operation', values: ['read'] }
const WRITE = { field: 'operation', values: ['write'] }
const COPY = { field: 'operation', values: ['copy'] }
const MOVE = { field: 'operation', values: ['move'] }
const DELETE = { field: 'operation', values: ['delete'] }
const STATS = { field: 'operation', values: ['stats'] }
const LIST = { field: 'operation', values: ['list'] }
const CREATE_FOLDER = { field: 'operation', values: ['create_folder'] }
const COPY_OR_MOVE = { field: 'operation', values: ['copy', 'move'] }
const STATS_OR_LIST = { field: 'operation', values: ['stats', 'list'] }

const INDIVIDUAL = { field: 'output_format', values: ['individual'] }
const MAP = { field: 'output_format', values: ['map'] }
const TABLE = { field: 'output_format', values: ['table'] }
const SIZE_TICKED = { field: 'size', values: ['true'] }
const CHECKSUM_CHOSEN = { field: 'checksum', values: ['md5', 'sha1', 'sha256', 'sha512'] }

const PATH_READABLE = 'artifact://…, testdata://…, or /abs/path'
const PATH_WRITABLE = 'artifact://…, or /abs/path'
const PATTERN_PLACEHOLDER = '^report-.*\\.json$'

const OPERATION_BADGE =
  "What to do. Read returns a file's text. Write creates or changes a file. Copy and Move take a " +
  'source and a destination. Delete removes a file or folder. Stats reports whether a path is there ' +
  "and what it is. List returns a folder's entries as a table. Create folder makes a folder and " +
  'its missing parents.'

function inputs(): InputParam[] {
  return getInputParams(ID) ?? []
}

function outputs(): OutputParam[] {
  return getOutputParams(ID) ?? []
}

/** Every descriptor under one wire name, in declaration order. */
function inputsNamed(name: string): InputParam[] {
  return inputs().filter((p) => p.name === name)
}

function outputsNamed(name: string): OutputParam[] {
  return outputs().filter((o) => o.name === name)
}

/** Exactly one flavor of a paired row is ever visible; this is that one. */
function flavorFor(name: string, operation: string): InputParam {
  const all = inputs() as unknown as Parameter[]
  const match = all.filter(
    (p) => p.name === name && isParameterVisible(p, { operation }, all),
  )
  expect(match, `${name} flavors visible for ${operation}`).toHaveLength(1)
  return match[0] as unknown as InputParam
}

/** The rows the parameter table renders for one set of field values, in order. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

/** The outputs offered for binding for one set of field values, in order. */
function visibleOutputNames(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return outputs()
    .filter((out) => {
      if (out.showWhen && !matchesCondition(out.showWhen, values, all)) return false
      const conjunction = gateOf(out).showWhenAll
      if (!conjunction) return true
      return conjunction.every((condition) => matchesCondition(condition, values, all))
    })
    .map((out) => out.name)
}

describe('registration', () => {
  it('registers file-io inputs', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
  })

  it('registers file-io outputs', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
  })

  it('resolves file-io through hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('registers no group metadata - the form is flat', () => {
    expect(PLUGIN_GROUPS[ID]).toBeUndefined()
    expect(getGroupMeta(ID)).toBeUndefined()
  })

  it('keeps the palette entry the block already had', () => {
    const plugin = getPluginById(ID)
    expect(plugin?.name).toBe('File I/O')
    expect(plugin?.category).toBe('system')
    expect(plugin?.iconName).toBe('FileInput')
  })
})

describe('the flat form (FIO-1)', () => {
  it('files no row under a group', () => {
    expect(inputs().filter((p) => p.group !== undefined)).toEqual([])
  })

  it('declares no failure-handling row and no secrets catalog', () => {
    const names = inputs().map((p) => p.name)
    expect(names).not.toContain('on_error')
    expect(getSecretMaskFields(ID)).toBeUndefined()
    expect(inputs().filter((p) => p.secret)).toEqual([])
  })

  it('declares no mode and no encoding row - Read and Write are UTF-8 text (FIO-4)', () => {
    const names = inputs().map((p) => p.name)
    expect(names).not.toContain('mode')
    expect(names).not.toContain('encoding')
  })

  it('declares each wire name once per operation flavor and no more', () => {
    const counts: Record<string, number> = {}
    for (const param of inputs()) {
      counts[param.name] = (counts[param.name] ?? 0) + 1
    }
    expect(counts).toEqual({
      operation: 1,
      path: 6,
      source: 2,
      destination: 1,
      content: 1,
      if_exists: 2,
      missing_ok: 1,
      size: 1,
      checksum: 1,
      output_format: 1,
      pattern: 1,
      recursive: 1,
    })
  })

  it('never retains a hidden row', () => {
    for (const param of inputs()) {
      expect(param.retainOnHide, param.name).toBeUndefined()
    }
  })

  it('gives every row a label and an info badge', () => {
    for (const param of inputs()) {
      expect(param.label, `label of ${param.name}`).toBeTruthy()
      expect(param.description, `info badge of ${param.name}`).toBeTruthy()
    }
  })
})

describe('Operation (FIO-1)', () => {
  it('lists the eight operations in wireframe order, defaulting to Read', () => {
    const operation = inputsNamed('operation')[0]
    expect(operation.label).toBe('Operation')
    expect(operation.type).toBe('string')
    expect(operation.required).toBe(true)
    expect(operation.defaultValue).toBe('read')
    expect(operation.enumValues).toEqual([...OPERATIONS])
    expect(operation.showWhen).toBeUndefined()
  })

  it('labels each operation the way the sheet reads', () => {
    expect(inputsNamed('operation')[0].enumLabels).toEqual({
      read: 'Read',
      write: 'Write',
      copy: 'Copy',
      move: 'Move',
      delete: 'Delete',
      stats: 'Stats',
      list: 'List',
      create_folder: 'Create folder',
    })
  })

  it('renders as a selector, never an expression', () => {
    expect(inputsNamed('operation')[0].noExpression).toBe(true)
  })

  it('says what every operation does in one badge', () => {
    expect(inputsNamed('operation')[0].description).toBe(OPERATION_BADGE)
  })

  it('carries no picker - it is not a path', () => {
    expect(fileRef(inputsNamed('operation')[0]).fileReference).toBeUndefined()
  })
})

describe('rows per operation (FIO-1)', () => {
  it('shows Read its Path only', () => {
    expect(visibleNames({ operation: 'read' })).toEqual(['operation', 'path'])
  })

  it('shows Write Path, Content and If the file exists', () => {
    expect(visibleNames({ operation: 'write' })).toEqual([
      'operation',
      'path',
      'content',
      'if_exists',
    ])
  })

  it('shows Copy Source, Destination and If the file exists', () => {
    expect(visibleNames({ operation: 'copy' })).toEqual([
      'operation',
      'source',
      'destination',
      'if_exists',
    ])
  })

  it('shows Move the same three rows as Copy', () => {
    expect(visibleNames({ operation: 'move' })).toEqual([
      'operation',
      'source',
      'destination',
      'if_exists',
    ])
  })

  it('shows Delete Path and Ignore missing', () => {
    expect(visibleNames({ operation: 'delete' })).toEqual(['operation', 'path', 'missing_ok'])
  })

  it('shows Stats Path, Size, Checksum and Output format', () => {
    expect(visibleNames({ operation: 'stats' })).toEqual([
      'operation',
      'path',
      'size',
      'checksum',
      'output_format',
    ])
  })

  it('shows List Path, RegEx Pattern, Include subfolders and Size', () => {
    expect(visibleNames({ operation: 'list' })).toEqual([
      'operation',
      'path',
      'pattern',
      'recursive',
      'size',
    ])
  })

  it('shows Create folder its Path only', () => {
    expect(visibleNames({ operation: 'create_folder' })).toEqual(['operation', 'path'])
  })

  it('falls back to Read when no operation is stored yet', () => {
    expect(visibleNames({})).toEqual(['operation', 'path'])
  })
})

describe('the Path pair (FIO-2, TDATA-10)', () => {
  const PATH_FLAVORS: [string, string, string, FileReferenceMode][] = [
    [
      'read',
      'File to read as UTF-8 text. Pick a Test Data or Artifact file with Browse, or type artifact://, testdata://, or an absolute or relative path where the block runs.',
      PATH_READABLE,
      'file',
    ],
    [
      'write',
      'File to write. artifact:// or an absolute or relative path where the block runs; missing folders are created. testdata:// is read-only.',
      PATH_WRITABLE,
      'save-as',
    ],
    [
      'delete',
      'File or folder to delete. A folder is removed with everything inside it. testdata:// is read-only.',
      PATH_WRITABLE,
      'file-or-folder',
    ],
    [
      'stats',
      'File or folder to report on. A missing path is not an error: Exists is false.',
      PATH_READABLE,
      'file-or-folder',
    ],
    ['list', 'Folder to list.', PATH_READABLE, 'folder'],
    [
      'create_folder',
      'Folder to create, including its name. Missing parents are created; an existing folder is not an error. testdata:// is read-only.',
      PATH_WRITABLE,
      'save-as',
    ],
  ]

  it('declares one Path flavor per operation on one wire name', () => {
    expect(inputsNamed('path')).toHaveLength(6)
    expect(inputsNamed('path').map((p) => p.showWhen)).toEqual([
      READ,
      WRITE,
      DELETE,
      STATS,
      LIST,
      CREATE_FOLDER,
    ])
  })

  it.each(PATH_FLAVORS)(
    'gives %s a Path badge, placeholder and picker mode of its own',
    (operation, badge, placeholder, mode) => {
      const row = flavorFor('path', operation)
      expect(row.label).toBe('Path')
      expect(row.type).toBe('string')
      expect(row.defaultValue).toBeUndefined()
      expect(row.description).toBe(badge)
      expect(row.placeholder).toBe(placeholder)
      expect(fileRef(row).fileReference).toBe(mode)
    },
  )

  it('asks for a Path only while that flavor is on screen', () => {
    for (const row of inputsNamed('path')) {
      expect(row.required, row.description).toBe(false)
      expect(row.requiredWhen, row.description).toEqual(row.showWhen)
    }
  })

  it('locks every Path flavor to plain text', () => {
    for (const row of inputsNamed('path')) {
      expect(row.allowedFormats, row.description).toEqual(['plain'])
      expect(row.retainOnHide, row.description).toBeUndefined()
      expect(row.enumValues, row.description).toBeUndefined()
      expect(fileRef(row).fileReferenceArtifactsOnly, row.description).toBeUndefined()
    }
  })
})

describe('the Source pair (FIO-1, TDATA-10)', () => {
  it('declares one Source flavor for Copy and one for Move', () => {
    expect(inputsNamed('source')).toHaveLength(2)
    expect(inputsNamed('source').map((p) => p.showWhen)).toEqual([COPY, MOVE])
  })

  it('lets Copy read test data as well as artifacts', () => {
    const row = flavorFor('source', 'copy')
    expect(row.label).toBe('Source')
    expect(row.type).toBe('string')
    expect(row.description).toBe(
      'File or folder to copy. Pick a Test Data or Artifact file or folder with Browse, or type a path.',
    )
    expect(row.placeholder).toBe(PATH_READABLE)
    expect(fileRef(row).fileReference).toBe('file-or-folder')
    expect(fileRef(row).fileReferenceArtifactsOnly).toBeUndefined()
  })

  it('holds Move to artifacts, because a move would empty the test data folder', () => {
    const row = flavorFor('source', 'move')
    expect(row.label).toBe('Source')
    expect(row.description).toBe(
      'File or folder to move. artifact:// or an absolute or relative path; testdata:// is read-only.',
    )
    expect(row.placeholder).toBe(PATH_WRITABLE)
    expect(fileRef(row).fileReference).toBe('file-or-folder')
    expect(fileRef(row).fileReferenceArtifactsOnly).toBe(true)
  })

  it('locks both Source flavors to plain text', () => {
    for (const row of inputsNamed('source')) {
      expect(row.allowedFormats, row.description).toEqual(['plain'])
      expect(row.retainOnHide, row.description).toBeUndefined()
    }
  })

  it('asks for a Source only while that flavor is on screen', () => {
    for (const row of inputsNamed('source')) {
      expect(row.required, row.description).toBe(false)
      expect(row.requiredWhen, row.description).toEqual(row.showWhen)
    }
  })
})

describe('Destination (FIO-3, TDATA-10)', () => {
  it('is one row shared by Copy and Move', () => {
    expect(inputsNamed('destination')).toHaveLength(1)
    expect(inputsNamed('destination')[0].showWhen).toEqual(COPY_OR_MOVE)
  })

  it('asks for the full target path and saves through the save-as picker', () => {
    const row = inputsNamed('destination')[0]
    expect(row.label).toBe('Destination')
    expect(row.type).toBe('string')
    expect(row.description).toBe(
      'The full target path, including the new name. artifact:// or an absolute or relative path; missing folders are created. testdata:// is read-only.',
    )
    expect(row.placeholder).toBe(PATH_WRITABLE)
    expect(row.allowedFormats).toEqual(['plain'])
    expect(fileRef(row).fileReference).toBe('save-as')
    expect(fileRef(row).fileReferenceArtifactsOnly).toBeUndefined()
  })

  it('asks for a Destination only on Copy and Move', () => {
    const row = inputsNamed('destination')[0]
    expect(row.required).toBe(false)
    expect(row.requiredWhen).toEqual(COPY_OR_MOVE)
  })
})

describe('Content (FIO-1)', () => {
  it('is the standard string editor, with no picker and no format lock', () => {
    const row = inputsNamed('content')[0]
    expect(row.label).toBe('Content')
    expect(row.type).toBe('string')
    expect(row.showWhen).toEqual(WRITE)
    expect(row.description).toBe('Text to write, UTF-8.')
    expect(row.allowedFormats).toBeUndefined()
    expect(row.placeholder).toBeUndefined()
    expect(row.noExpression).not.toBe(true)
    expect(fileRef(row).fileReference).toBeUndefined()
  })

  it('asks for Content only on Write', () => {
    const row = inputsNamed('content')[0]
    expect(row.required).toBe(false)
    expect(row.requiredWhen).toEqual(WRITE)
  })
})

describe('the If the file exists pair (FIO-3)', () => {
  it('declares a Write flavor and a Copy / Move flavor on one wire name', () => {
    expect(inputsNamed('if_exists')).toHaveLength(2)
    expect(inputsNamed('if_exists').map((p) => p.showWhen)).toEqual([WRITE, COPY_OR_MOVE])
    for (const row of inputsNamed('if_exists')) {
      expect(row.label, row.description).toBe('If the file exists')
      expect(row.type, row.description).toBe('string')
      expect(row.required, row.description).toBe(false)
      expect(row.defaultValue, row.description).toBe('overwrite')
      expect(row.noExpression, row.description).toBe(true)
      expect(row.retainOnHide, row.description).toBeUndefined()
    }
  })

  it('offers Write Replace it, Append to it and Fail the block', () => {
    const row = flavorFor('if_exists', 'write')
    expect(row.enumValues).toEqual(['overwrite', 'append', 'fail'])
    expect(row.enumLabels).toEqual({
      overwrite: 'Replace it',
      append: 'Append to it',
      fail: 'Fail the block',
    })
    expect(row.description).toBe('What happens when the file is already there.')
  })

  it('offers Copy and Move Replace it and Fail the block, and says a folder merges', () => {
    for (const operation of ['copy', 'move']) {
      const row = flavorFor('if_exists', operation)
      expect(row.enumValues, operation).toEqual(['overwrite', 'fail'])
      expect(row.enumLabels, operation).toEqual({
        overwrite: 'Replace it',
        fail: 'Fail the block',
      })
      expect(row.description, operation).toBe(
        'What happens when the destination is already there. Replacing a folder merges: files inside are replaced, others are kept.',
      )
    }
  })
})

describe('Delete, Stats and List settings (FIO-5, FIO-6, FIO-7)', () => {
  it('offers Ignore missing on Delete, off by default', () => {
    const row = inputsNamed('missing_ok')[0]
    expect(row.label).toBe('Ignore missing')
    expect(row.type).toBe('boolean')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe(false)
    expect(row.showWhen).toEqual(DELETE)
    expect(row.description).toBe('Succeed when there is nothing to delete.')
  })

  it('shares one Size switch between Stats and List, off by default', () => {
    const row = inputsNamed('size')[0]
    expect(row.label).toBe('Size')
    expect(row.type).toBe('boolean')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe(false)
    expect(row.showWhen).toEqual(STATS_OR_LIST)
    expect(row.description).toBe(
      "Include the size in bytes. A folder's size is everything inside it, at every depth."
    )
  })

  it('offers the four digests plus None on Stats', () => {
    const row = inputsNamed('checksum')[0]
    expect(row.label).toBe('Checksum')
    expect(row.type).toBe('string')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe('none')
    expect(row.showWhen).toEqual(STATS)
    expect(row.noExpression).toBe(true)
    expect(row.enumValues).toEqual(['none', 'md5', 'sha1', 'sha256', 'sha512'])
    expect(row.enumLabels).toEqual({
      none: 'None',
      md5: 'MD5',
      sha1: 'SHA-1',
      sha256: 'SHA-256',
      sha512: 'SHA-512',
    })
    expect(row.description).toBe("Digest of the file's bytes. Empty for a folder.")
  })

  it('offers Individual, Map and Table on Stats, Individual by default', () => {
    const row = inputsNamed('output_format')[0]
    expect(row.label).toBe('Output format')
    expect(row.type).toBe('string')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe('individual')
    expect(row.showWhen).toEqual(STATS)
    expect(row.noExpression).toBe(true)
    expect(row.enumValues).toEqual(['individual', 'map', 'table'])
    expect(row.enumLabels).toEqual({ individual: 'Individual', map: 'Map', table: 'Table' })
    expect(row.description).toBe('Individual outputs, one map, or a one-row table.')
  })

  it('filters List with a Python regular expression', () => {
    const row = inputsNamed('pattern')[0]
    expect(row.label).toBe('RegEx Pattern')
    expect(row.type).toBe('string')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe('')
    expect(row.showWhen).toEqual(LIST)
    expect(row.placeholder).toBe(PATTERN_PLACEHOLDER)
    expect(row.description).toBe(
      'Python regular expression matched against each entry name. Empty lists everything.',
    )
  })

  it('offers Include subfolders on List, off by default', () => {
    const row = inputsNamed('recursive')[0]
    expect(row.label).toBe('Include subfolders')
    expect(row.type).toBe('boolean')
    expect(row.required).toBe(false)
    expect(row.defaultValue).toBe(false)
    expect(row.showWhen).toEqual(LIST)
    expect(row.description).toBe('List entries at every depth below the folder.')
  })

  it('puts no picker on the settings rows', () => {
    for (const name of ['missing_ok', 'size', 'checksum', 'output_format', 'pattern', 'recursive']) {
      for (const row of inputsNamed(name)) {
        expect(fileRef(row).fileReference, name).toBeUndefined()
      }
    }
  })
})

describe('required rows never fire on an operation that hides them', () => {
  function issuesFor(values: Record<string, unknown>): string[] {
    const found = computeNodeIssues(
      [{ id: 'n1', data: { elementType: ID, version: '1.0.0', config: { values } } }],
      [],
    )
    const names = new Set((found.get('n1') ?? []).map((issue) => issue.paramName ?? ''))
    return [...names].sort()
  }

  it.each(OPERATIONS)(
    'reports nothing for %s once the rows on screen are filled',
    (operation) => {
      const values: Record<string, unknown> = { operation }
      for (const name of visibleNames({ operation })) {
        const row = flavorFor(name, operation)
        if (row.type === 'string' && row.defaultValue === undefined) values[name] = 'x'
      }
      expect(issuesFor(values)).toEqual([])
    },
  )

  it.each([
    ['read', ['path']],
    ['write', ['content', 'path']],
    ['copy', ['destination', 'source']],
    ['move', ['destination', 'source']],
    ['delete', ['path']],
    ['stats', ['path']],
    ['list', ['path']],
    ['create_folder', ['path']],
  ])('names the empty rows of %s and no other', (operation, expected) => {
    expect(issuesFor({ operation })).toEqual(expected)
  })
})

describe('outputs (FIO-9)', () => {
  it('declares the ten output rows in table order', () => {
    expect(outputs().map((o) => o.name)).toEqual([
      'content',
      'exists',
      'type',
      'modified',
      'size',
      'checksum',
      'stats',
      'stats',
      'entries',
      'count',
    ])
  })

  it('declares no path output and no Success output', () => {
    const names = outputs().map((o) => o.name)
    expect(names).not.toContain('path')
    expect(names).not.toContain('success')
    expect(names).not.toContain('error')
    expect(names).not.toContain('reason')
  })

  it('gives every output a label and an info badge, and marks none secret', () => {
    for (const out of outputs()) {
      expect(out.label, `label of ${out.name}`).toBeTruthy()
      expect(out.description, `info badge of ${out.name}`).toBeTruthy()
      expect(out.secret, `secret of ${out.name}`).toBeUndefined()
    }
  })

  it('returns the text Read produced', () => {
    const out = outputsNamed('content')[0]
    expect(out.label).toBe('Content')
    expect(out.type).toBe('string')
    expect(out.showWhen).toEqual(READ)
    expect(gateOf(out).showWhenAll).toBeUndefined()
    expect(out.description).toBe("The file's text.")
  })

  it.each([
    ['exists', 'Exists', 'boolean', 'True when the path is there.'],
    ['type', 'Type', 'string', 'file, folder, or empty when the path is missing.'],
    [
      'modified',
      'Modified',
      'string',
      'Last modified, ISO-8601 UTC; empty when the path is missing.',
    ],
  ])('offers %s while Stats reports individual outputs', (name, label, type, badge) => {
    const out = outputsNamed(name)[0]
    expect(out.label).toBe(label)
    expect(out.type).toBe(type)
    expect(out.description).toBe(badge)
    expect(gateOf(out).showWhenAll).toEqual([STATS, INDIVIDUAL])
  })

  it('offers Size only while the Size switch is ticked', () => {
    const out = outputsNamed('size')[0]
    expect(out.label).toBe('Size')
    expect(out.type).toBe('integer')
    expect(out.description).toBe('Size in bytes.')
    expect(gateOf(out).showWhenAll).toEqual([STATS, INDIVIDUAL, SIZE_TICKED])
  })

  it('offers Checksum only while a digest is chosen', () => {
    const out = outputsNamed('checksum')[0]
    expect(out.label).toBe('Checksum')
    expect(out.type).toBe('string')
    expect(out.description).toBe('Hex digest; empty for a folder or a missing path.')
    expect(gateOf(out).showWhenAll).toEqual([STATS, INDIVIDUAL, CHECKSUM_CHOSEN])
  })

  it('pairs the Stats map and the Stats table on one wire name', () => {
    const [asMap, asTable] = outputsNamed('stats')
    expect(outputsNamed('stats')).toHaveLength(2)

    expect(asMap.label).toBe('Stats')
    expect(asMap.type).toBe('map')
    expect(gateOf(asMap).showWhenAll).toEqual([STATS, MAP])
    expect(asMap.description).toBe(
      'exists, type, modified, and size or checksum when chosen.',
    )

    expect(asTable.label).toBe('Stats')
    expect(asTable.type).toBe('table')
    expect(gateOf(asTable).showWhenAll).toEqual([STATS, TABLE])
    expect(asTable.description).toBe('One row with the same columns.')

    expect(gateOf(asMap).retainOnHide).toBeUndefined()
    expect(gateOf(asTable).retainOnHide).toBeUndefined()
  })

  it('returns the List table and its row count', () => {
    const entries = outputsNamed('entries')[0]
    expect(entries.label).toBe('Entries')
    expect(entries.type).toBe('table')
    expect(entries.showWhen).toEqual(LIST)
    expect(entries.description).toBe(
      'One row per entry: name, path, type, modified, and size when ticked.',
    )

    const count = outputsNamed('count')[0]
    expect(count.label).toBe('Count')
    expect(count.type).toBe('integer')
    expect(count.showWhen).toEqual(LIST)
    expect(count.description).toBe('Number of entries.')
  })
})

describe('outputs per operation (FIO-9)', () => {
  it('offers Read only its Content', () => {
    expect(visibleOutputNames({ operation: 'read' })).toEqual(['content'])
  })

  it.each(['write', 'copy', 'move', 'delete', 'create_folder'])('offers %s nothing', (operation) => {
    expect(visibleOutputNames({ operation })).toEqual([])
  })

  it('offers Stats the individual rows the settings produce', () => {
    expect(visibleOutputNames({ operation: 'stats' })).toEqual(['exists', 'type', 'modified'])
    expect(visibleOutputNames({ operation: 'stats', size: true })).toEqual([
      'exists',
      'type',
      'modified',
      'size',
    ])
    expect(visibleOutputNames({ operation: 'stats', size: true, checksum: 'sha256' })).toEqual([
      'exists',
      'type',
      'modified',
      'size',
      'checksum',
    ])
    expect(visibleOutputNames({ operation: 'stats', checksum: 'none' })).toEqual([
      'exists',
      'type',
      'modified',
    ])
  })

  it('swaps the individual rows for the map or the table on Output format', () => {
    expect(visibleOutputNames({ operation: 'stats', output_format: 'map' })).toEqual(['stats'])
    expect(visibleOutputNames({ operation: 'stats', output_format: 'table' })).toEqual(['stats'])
  })

  it('offers List its Entries and Count', () => {
    expect(visibleOutputNames({ operation: 'list' })).toEqual(['entries', 'count'])
  })
})

describe('file references', () => {
  it('puts a picker on the path-like rows and nowhere else', () => {
    const withPicker = inputs().filter((p) => fileRef(p).fileReference !== undefined)
    expect(withPicker.map((p) => p.name)).toEqual([
      'path',
      'path',
      'path',
      'path',
      'path',
      'path',
      'source',
      'source',
      'destination',
    ])
  })
})
