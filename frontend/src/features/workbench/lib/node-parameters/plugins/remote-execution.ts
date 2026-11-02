/**
 * Remote Execution container parameters (REQ-3.4.1.3).
 *
 * The container has exactly one input, Session ID (required - an open SSH
 * session, the same shared session picker the SSH plugins use), and one output,
 * Remote Session ID. Interpreter compatibility is a run-time check on the host,
 * and each body block owns its own timeout, so there is no Inputs, Interpreter,
 * or Timeout parameter (REMEX-3).
 */

import { output, type InputParam, type OutputParam } from '../types'
import { sshSessionIdInput } from './_ssh-session-shared'

export const inputs: InputParam[] = [sshSessionIdInput]

export const outputs: OutputParam[] = [
  output(
    'remote_session_id',
    'Remote Session ID',
    'string',
    'Handle to the persistent remote worker opened on the SSH session host for this container',
  ),
]
