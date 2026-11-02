/**
 * SSH Tunnel Close Plugin Parameters
 */

import { output, type InputParam, type OutputParam } from '../types'
import { sshTunnelIdInput } from './_ssh-tunnel-shared'

export const inputs: InputParam[] = [
  sshTunnelIdInput,
]

export const outputs: OutputParam[] = [
  output('closed', 'Closed', 'boolean', 'True when the tunnel was open and is now closed; false when it was unknown or already closed'),
]
