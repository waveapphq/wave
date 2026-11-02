/** The file rows File I/O, SFTP and K8s Copy share (REQ-3.4.1.10, REQ-3.4.1.8, REQ-3.4.1.5). */

import { param, type InputParam } from '../types'

type Gate = NonNullable<InputParam['showWhen']>

export function ifExistsInput(description: string, showWhen: Gate, options?: { append?: boolean }): InputParam {
  const append = options?.append === true
  return param('if_exists', 'If the file exists', 'string', false, description, {
    enumValues: append ? ['overwrite', 'append', 'fail'] : ['overwrite', 'fail'],
    enumLabels: append
      ? { overwrite: 'Replace it', append: 'Append to it', fail: 'Fail the block' }
      : { overwrite: 'Replace it', fail: 'Fail the block' },
    defaultValue: 'overwrite',
    noExpression: true,
    showWhen,
  })
}

export function ignoreMissingInput(description: string, showWhen: Gate): InputParam {
  return param('missing_ok', 'Ignore missing', 'boolean', false, description, { defaultValue: false, showWhen })
}

export function includeSubfoldersInput(description: string, showWhen: Gate): InputParam {
  return param('recursive', 'Include subfolders', 'boolean', false, description, { defaultValue: false, showWhen })
}

export interface TransferLimits {
  maxSizeMib: number
  maxFiles: number
  showWhen: Gate
  sizeDescription: string
  filesDescription: string
}

/** Max size (MiB) then Max files; 0 means no limit. */
export function transferLimitInputs(limits: TransferLimits): [InputParam, InputParam] {
  const { maxSizeMib, maxFiles, showWhen, sizeDescription, filesDescription } = limits
  return [
    param('max_size_mib', 'Max size (MiB)', 'integer', false, sizeDescription, { defaultValue: maxSizeMib, minimum: 0, showWhen }),
    param('max_files', 'Max files', 'integer', false, filesDescription, { defaultValue: maxFiles, minimum: 0, showWhen }),
  ]
}
