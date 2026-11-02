/** The session_id definition shared by SSH Session Open's output and every block that references a session. */

import { output, param, type InputParam, type OutputParam } from '../types'

const SESSION_ID_DESCRIPTION =
  "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, " +
  "Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it"

export const sshSessionIdInput: InputParam = param(
  'session_id', 'Session ID', 'string', true, SESSION_ID_DESCRIPTION,
  { allowedFormats: ['plain'] },
)

export const sshSessionIdOutput: OutputParam = output(
  'session_id', 'Session ID', 'string', SESSION_ID_DESCRIPTION,
)
