/**
 * Shared SSH Tunnel Constants
 *
 * The tunnel_id definition shared by the SSH Tunnel pair so Open's output
 * and Close's input stay identical (name, label, description).
 */

import { output, param, type InputParam, type OutputParam } from '../types'

const TUNNEL_ID_DESCRIPTION =
  'Handle identifying an open SSH tunnel: Tunnel Open produces it; Tunnel Close references it'

export const sshTunnelIdInput: InputParam = param(
  'tunnel_id', 'Tunnel ID', 'string', true, TUNNEL_ID_DESCRIPTION,
  { allowedFormats: ['plain'] },
)

export const sshTunnelIdOutput: OutputParam = output(
  'tunnel_id', 'Tunnel ID', 'string', TUNNEL_ID_DESCRIPTION,
)
