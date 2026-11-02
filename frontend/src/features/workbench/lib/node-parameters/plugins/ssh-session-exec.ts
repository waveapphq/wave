/**
 * SSH Session Exec Plugin Parameters
 */

import { output, param, type InputParam, type OutputParam } from '../types'
import { timeoutInput } from './_shared-params'
import { sshSessionIdInput } from './_ssh-session-shared'

export const inputs: InputParam[] = [
  sshSessionIdInput,
  param('command', 'Command', 'string', true, 'Command line to execute on the remote host - each command runs independently, no shell state carries over'),
  timeoutInput(300, 'Execution timeout in seconds'),
]

export const outputs: OutputParam[] = [
  output('stdout', 'Stdout', 'string', 'Standard output captured from the command'),
  output('stderr', 'Stderr', 'string', 'Standard error captured from the command'),
  output('exit_code', 'Exit Code', 'integer', 'Exit code returned by the command; non-zero codes are returned, not raised'),
]
