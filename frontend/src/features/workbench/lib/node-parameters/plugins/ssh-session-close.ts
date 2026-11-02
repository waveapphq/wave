/**
 * SSH Session Close Plugin Parameters
 */

import { output, type InputParam, type OutputParam } from '../types'
import { sshSessionIdInput } from './_ssh-session-shared'

export const inputs: InputParam[] = [
  sshSessionIdInput,
]

export const outputs: OutputParam[] = [
  output('closed_session_ids', 'Closed Session IDs', 'array', 'Session IDs actually closed, descendants first; empty when the session was unknown or already closed'),
]
