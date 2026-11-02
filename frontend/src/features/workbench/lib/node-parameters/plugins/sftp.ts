/** SFTP Plugin Parameters: one flat form driven by Operation (SFTP-2); only the WAVE-side rows browse (SFTP-4). */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { ifExistsInput, ignoreMissingInput, includeSubfoldersInput, transferLimitInputs } from './_file-shared'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from './_shared-params'
import { sshSessionIdInput } from './_ssh-session-shared'

type Gate = NonNullable<InputParam['showWhen']>

const UPLOAD = { field: 'operation', values: ['upload'] }
const DOWNLOAD = { field: 'operation', values: ['download'] }
const LIST = { field: 'operation', values: ['list'] }
const STATS = { field: 'operation', values: ['stats'] }
const DELETE = { field: 'operation', values: ['delete'] }
const MOVE = { field: 'operation', values: ['move'] }
const CREATE_FOLDER = { field: 'operation', values: ['create_folder'] }
const TRANSFER_OR_MOVE = { field: 'operation', values: ['upload', 'download', 'move'] }
const UPLOAD_OR_DOWNLOAD = { field: 'operation', values: ['upload', 'download'] }

const ADVANCED = 'Advanced'

// One label, one descriptor per operation: exactly one is visible, so none retains on hide.
function pathInput(
  name: string,
  label: string,
  required: boolean,
  showWhen: Gate,
  description: string,
  fileReference?: InputParam['fileReference'],
): InputParam {
  return param(name, label, 'string', required, description, {
    showWhen,
    allowedFormats: ['plain'],
    ...(fileReference ? { fileReference } : {}),
  })
}

export const groups: Record<string, GroupMeta> = {
  [ADVANCED]: group(ADVANCED, { description: 'Limits for this block' }),
  [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
}

export const inputs: InputParam[] = [
  sshSessionIdInput,
  param('operation', 'Operation', 'string', true, 'What to do. Upload and Download move files between WAVE and the server; List, Stats, Delete, Move and Create folder work on the server.', {
    enumValues: ['upload', 'download', 'list', 'stats', 'delete', 'move', 'create_folder'],
    enumLabels: {
      upload: 'Upload',
      download: 'Download',
      list: 'List',
      stats: 'Stats',
      delete: 'Delete',
      move: 'Move',
      create_folder: 'Create folder',
    },
    defaultValue: 'upload',
    noExpression: true,
  }),
  pathInput('source', 'Source', true, UPLOAD, 'File or folder on WAVE to upload. Pick a Test Data or Artifact entry with Browse, or type testdata://, artifact:// or an absolute or relative path. A folder goes with everything inside it; *, ? and [...] match several files.', 'file-or-folder'),
  pathInput('source', 'Source', true, DOWNLOAD, 'File or folder on the server to download. A folder comes with everything inside it; *, ? and [...] match several files.'),
  pathInput('source', 'Source', true, MOVE, 'File or folder on the server to move or rename.'),
  pathInput('destination', 'Destination', true, UPLOAD, 'Where it goes on the server. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only. Missing folders are created.'),
  pathInput('destination', 'Destination', false, DOWNLOAD, "Where it lands on WAVE: artifact:// or an absolute or relative path; testdata:// is read-only. Empty puts it in the run's artifacts under its own name. An existing folder or a path ending in / keeps the names; any other path is the new name, for one file only.", 'save-as'),
  pathInput('destination', 'Destination', true, MOVE, 'The new path on the server. An existing folder or a path ending in / keeps the name.'),
  pathInput('path', 'Path', true, LIST, 'Folder on the server to list, or a pattern: *, ? and [...] list only the matching entries. No match gives no entries and a Count of 0.'),
  pathInput('path', 'Path', true, STATS, 'File or folder on the server to report on. A missing path is not an error: Exists is false.'),
  pathInput('path', 'Path', true, DELETE, "File or folder on the server to delete; a folder goes with everything inside it, and *, ? and [...] delete every match. A path that names the account's home or the server root (empty, ., ~ or /) is refused."),
  pathInput('path', 'Path', true, CREATE_FOLDER, 'Folder to create on the server, including its name. Missing parent folders are created.'),
  ifExistsInput('What happens when a file is already at the destination: Replace it overwrites it; Fail the block stops before anything is written.', TRANSFER_OR_MOVE),
  includeSubfoldersInput('List the entries inside subfolders too, at every depth.', LIST),
  ignoreMissingInput('Pass when the path or pattern matches nothing, instead of failing the block.', DELETE),
  { ...timeoutInput(300, 'Seconds the whole block may take, every file of a folder included.'), group: ADVANCED },
  ...transferLimitInputs({
    maxSizeMib: 1024,
    maxFiles: 10000,
    showWhen: DOWNLOAD,
    sizeDescription: 'Largest total a download may bring, in MiB. The block adds up the match before it writes anything and refuses a larger one. 0 means no limit.',
    filesDescription: 'Most files a download may bring. The block counts the match before it writes anything and refuses more. 0 means no limit.',
  }).map((row) => ({ ...row, group: ADVANCED })),
  failureHandlingOnErrorInput(),
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', 'One row per file transferred: source, destination and size.', { showWhen: UPLOAD_OR_DOWNLOAD }),
  output('entries', 'Entries', 'table', 'One row per entry: name, path, type, modified and size. Include subfolders adds the entries of every subfolder.', { showWhen: LIST }),
  output('count', 'Count', 'integer', 'Number of entries; 0 when nothing matches.', { showWhen: LIST }),
  output('exists', 'Exists', 'boolean', 'True when the path is there on the server.', { showWhen: STATS }),
  output('type', 'Type', 'string', 'Whether the path is a file or a folder; empty when the path is missing.', { showWhen: STATS }),
  output('size', 'Size', 'integer', 'Size in bytes of a file; 0 for a folder or a missing path.', { showWhen: STATS }),
  output('modified', 'Modified', 'string', 'Last modified, ISO-8601 UTC; empty when the path is missing.', { showWhen: STATS }),
  ...outputCore({
    successDescription: 'True when the operation finished. False when the block failed and On error is Record and continue.',
    reasonDescription: 'Why it failed: SessionClosed, SftpUnavailable, NoMatch, NotFound, NotAFolder, Conflict, Exists, ReadOnly, TooManyFiles, TooLarge, UnsafeEntry, Refused, PermissionDenied, ConnectionLost, ServerFailure, LocalFailure or Timeout; empty when it passed.',
  }),
]
