/**
 * SSH Session Script Plugin Parameters
 */

import { output, param, type InputParam, type OutputParam } from '../types'
import { timeoutInput } from './_shared-params'
import { sshSessionIdInput } from './_ssh-session-shared'

export const inputs: InputParam[] = [
  sshSessionIdInput,
  param('script', 'Script', 'string', true, 'Script piped to the interpreter on the remote host via stdin', {
    allowedFormats: ['plain'],
  }),
  param('interpreter', 'Interpreter', 'string', false, 'Interpreter that reads the script from stdin, e.g. /bin/sh, bash, python3, perl, node - may include flags', {
    defaultValue: '/bin/sh',
  }),
  param('working_dir', 'Working Directory', 'string', false, 'Directory to change into before running the interpreter'),
  timeoutInput(300, 'Execution timeout in seconds'),
]

export const outputs: OutputParam[] = [
  output('stdout', 'Stdout', 'string', 'Standard output captured from the script'),
  output('stderr', 'Stderr', 'string', 'Standard error captured from the script'),
  output('exit_code', 'Exit Code', 'integer', 'Exit code returned by the interpreter; non-zero codes are returned, not raised'),
]
