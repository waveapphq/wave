/** The file rows File I/O, SFTP and K8s Copy share (REQ-3.4.1.10, REQ-3.4.1.8, REQ-3.4.1.5; FIO-3, SFTP-5, SFTP-6, K8SEXEC-10). */

import { describe, it, expect } from 'vitest'
import {
  ifExistsInput,
  ignoreMissingInput,
  includeSubfoldersInput,
  transferLimitInputs,
} from '@/features/workbench/lib/node-parameters/plugins/_file-shared'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { type InputParam } from '@/features/workbench/lib/node-parameters/types'

const WRITE = { field: 'operation', values: ['write'] }
const COPY_OR_MOVE = { field: 'operation', values: ['copy', 'move'] }
const DELETE = { field: 'operation', values: ['delete'] }
const LIST = { field: 'operation', values: ['list'] }
const DOWNLOAD = { field: 'operation', values: ['download'] }
const TRANSFER_OR_MOVE = { field: 'operation', values: ['upload', 'download', 'move'] }
const FROM_POD = { field: 'direction', values: ['from_pod'] }

const ADVANCED = 'Advanced'
const LIMIT_NAMES = ['max_size_mib', 'max_files']

const FILE_IO_WRITE_IF_EXISTS = 'What happens when the file is already there.'
const FILE_IO_COPY_IF_EXISTS =
  'What happens when the destination is already there. Replacing a folder merges: files inside are replaced, others are kept.'
const FILE_IO_MISSING_OK = 'Succeed when there is nothing to delete.'
const FILE_IO_RECURSIVE = 'List entries at every depth below the folder.'

const SFTP_IF_EXISTS =
  'What happens when a file is already at the destination: Replace it overwrites it; Fail the block stops before anything is written.'
const SFTP_RECURSIVE = 'List the entries inside subfolders too, at every depth.'
const SFTP_MISSING_OK = 'Pass when the path or pattern matches nothing, instead of failing the block.'
const SFTP_MAX_SIZE =
  'Largest total a download may bring, in MiB. The block adds up the match before it writes anything and refuses a larger one. 0 means no limit.'
const SFTP_MAX_FILES =
  'Most files a download may bring. The block counts the match before it writes anything and refuses more. 0 means no limit.'

const K8S_MAX_SIZE =
  'Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.'
const K8S_MAX_FILES =
  'Most files a copy from the pod may write. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.'

/** Every descriptor of a block under one wire name, in declaration order. */
function rowsNamed(elementType: string, name: string): InputParam[] {
  return (getInputParams(elementType) ?? []).filter((p) => p.name === name)
}

/** The Max size (MiB) and Max files rows of a block, in declaration order. */
function limitRows(elementType: string): InputParam[] {
  return (getInputParams(elementType) ?? []).filter((p) => LIMIT_NAMES.includes(p.name))
}

function inAdvanced(rows: InputParam[]): InputParam[] {
  return rows.map((row) => ({ ...row, group: ADVANCED }))
}

describe('ifExistsInput', () => {
  it('offers Replace it and Fail the block, Replace it by default', () => {
    expect(ifExistsInput('What happens.', COPY_OR_MOVE)).toEqual({
      name: 'if_exists',
      label: 'If the file exists',
      type: 'string',
      required: false,
      description: 'What happens.',
      enumValues: ['overwrite', 'fail'],
      enumLabels: { overwrite: 'Replace it', fail: 'Fail the block' },
      defaultValue: 'overwrite',
      noExpression: true,
      showWhen: COPY_OR_MOVE,
    })
  })

  it('adds Append to it between the two when asked', () => {
    expect(ifExistsInput('What happens.', WRITE, { append: true })).toEqual({
      name: 'if_exists',
      label: 'If the file exists',
      type: 'string',
      required: false,
      description: 'What happens.',
      enumValues: ['overwrite', 'append', 'fail'],
      enumLabels: { overwrite: 'Replace it', append: 'Append to it', fail: 'Fail the block' },
      defaultValue: 'overwrite',
      noExpression: true,
      showWhen: WRITE,
    })
  })

  it('leaves Append out when it is turned off', () => {
    expect(ifExistsInput('What happens.', WRITE, { append: false })).toEqual(
      ifExistsInput('What happens.', WRITE),
    )
  })

  it('carries the description and the gate it is given', () => {
    const row = ifExistsInput(SFTP_IF_EXISTS, TRANSFER_OR_MOVE)

    expect(row.description).toBe(SFTP_IF_EXISTS)
    expect(row.showWhen).toEqual(TRANSFER_OR_MOVE)
  })
})

describe('ignoreMissingInput', () => {
  it('returns the Ignore missing switch, off by default', () => {
    expect(ignoreMissingInput('Pass anyway.', DELETE)).toEqual({
      name: 'missing_ok',
      label: 'Ignore missing',
      type: 'boolean',
      required: false,
      description: 'Pass anyway.',
      defaultValue: false,
      showWhen: DELETE,
    })
  })
})

describe('includeSubfoldersInput', () => {
  it('returns the Include subfolders switch, off by default, keeping its expression toggle', () => {
    expect(includeSubfoldersInput('Every depth.', LIST)).toEqual({
      name: 'recursive',
      label: 'Include subfolders',
      type: 'boolean',
      required: false,
      description: 'Every depth.',
      defaultValue: false,
      showWhen: LIST,
    })
  })
})

describe('transferLimitInputs', () => {
  it('returns Max size (MiB) then Max files, each at least 0 with no maximum', () => {
    expect(
      transferLimitInputs({
        maxSizeMib: 1024,
        maxFiles: 10000,
        showWhen: DOWNLOAD,
        sizeDescription: 'Size.',
        filesDescription: 'Files.',
      }),
    ).toEqual([
      {
        name: 'max_size_mib',
        label: 'Max size (MiB)',
        type: 'integer',
        required: false,
        description: 'Size.',
        defaultValue: 1024,
        minimum: 0,
        showWhen: DOWNLOAD,
      },
      {
        name: 'max_files',
        label: 'Max files',
        type: 'integer',
        required: false,
        description: 'Files.',
        defaultValue: 10000,
        minimum: 0,
        showWhen: DOWNLOAD,
      },
    ])
  })

  it('carries the defaults and the gate each caller gives', () => {
    const [size, files] = transferLimitInputs({
      maxSizeMib: 256,
      maxFiles: 10000,
      showWhen: FROM_POD,
      sizeDescription: K8S_MAX_SIZE,
      filesDescription: K8S_MAX_FILES,
    })

    expect([size.defaultValue, files.defaultValue]).toEqual([256, 10000])
    expect([size.showWhen, files.showWhen]).toEqual([FROM_POD, FROM_POD])
    expect([size.description, files.description]).toEqual([K8S_MAX_SIZE, K8S_MAX_FILES])
  })
})

describe('no builder places its rows', () => {
  it('files none of the returned rows under a group', () => {
    const rows = [
      ifExistsInput('What happens.', WRITE),
      ifExistsInput('What happens.', WRITE, { append: true }),
      ignoreMissingInput('Pass anyway.', DELETE),
      includeSubfoldersInput('Every depth.', LIST),
      ...transferLimitInputs({
        maxSizeMib: 1024,
        maxFiles: 10000,
        showWhen: DOWNLOAD,
        sizeDescription: 'Size.',
        filesDescription: 'Files.',
      }),
    ]

    expect(rows.map((row) => row.group)).toEqual(rows.map(() => undefined))
  })
})

describe('File I/O declares the shared rows unchanged (FIO-3)', () => {
  it('builds the Write flavor with Append and the Copy / Move flavor without it', () => {
    expect(rowsNamed('file-io', 'if_exists')).toEqual([
      ifExistsInput(FILE_IO_WRITE_IF_EXISTS, WRITE, { append: true }),
      ifExistsInput(FILE_IO_COPY_IF_EXISTS, COPY_OR_MOVE),
    ])
  })

  it('builds Ignore missing for Delete', () => {
    expect(rowsNamed('file-io', 'missing_ok')).toEqual([ignoreMissingInput(FILE_IO_MISSING_OK, DELETE)])
  })

  it('builds Include subfolders for List', () => {
    expect(rowsNamed('file-io', 'recursive')).toEqual([includeSubfoldersInput(FILE_IO_RECURSIVE, LIST)])
  })

  it('declares no limit rows', () => {
    expect(limitRows('file-io')).toEqual([])
  })
})

describe('SFTP declares the shared rows (SFTP-5, SFTP-6)', () => {
  it('builds If the file exists without Append, for Upload, Download and Move', () => {
    expect(rowsNamed('sftp', 'if_exists')).toEqual([ifExistsInput(SFTP_IF_EXISTS, TRANSFER_OR_MOVE)])
  })

  it('builds Include subfolders for List', () => {
    expect(rowsNamed('sftp', 'recursive')).toEqual([includeSubfoldersInput(SFTP_RECURSIVE, LIST)])
  })

  it('builds Ignore missing for Delete', () => {
    expect(rowsNamed('sftp', 'missing_ok')).toEqual([ignoreMissingInput(SFTP_MISSING_OK, DELETE)])
  })

  it('builds the limit pair at 1024 MiB and 10000 files for Download, in Advanced', () => {
    expect(limitRows('sftp')).toEqual(
      inAdvanced(
        transferLimitInputs({
          maxSizeMib: 1024,
          maxFiles: 10000,
          showWhen: DOWNLOAD,
          sizeDescription: SFTP_MAX_SIZE,
          filesDescription: SFTP_MAX_FILES,
        }),
      ),
    )
  })
})

describe('K8s Copy declares the limit pair (K8SEXEC-10)', () => {
  it('builds the limit pair at 256 MiB and 10000 files for From Pod, in Advanced', () => {
    expect(limitRows('k8s-copy')).toEqual(
      inAdvanced(
        transferLimitInputs({
          maxSizeMib: 256,
          maxFiles: 10000,
          showWhen: FROM_POD,
          sizeDescription: K8S_MAX_SIZE,
          filesDescription: K8S_MAX_FILES,
        }),
      ),
    )
  })
})
