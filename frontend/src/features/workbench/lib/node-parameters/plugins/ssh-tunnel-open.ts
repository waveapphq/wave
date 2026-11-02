/**
 * SSH Tunnel Open Plugin Parameters
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { sshSessionIdInput } from './_ssh-session-shared'
import { sshTunnelIdOutput } from './_ssh-tunnel-shared'

export const groups: Record<string, GroupMeta> = {
  Forwarding: group('Forwarding', {
    description: 'Session to forward through and the local to remote mapping',
    defaultExpanded: true,
  }),
  Advanced: group('Advanced'),
}

export const inputs: InputParam[] = [
  { ...sshSessionIdInput, group: 'Forwarding' },
  param('local_port', 'Local Port', 'integer', false, 'Local port to listen on; 0 auto-assigns a free port', {
    group: 'Forwarding', defaultValue: 0, minimum: 0, maximum: 65535,
  }),
  param('remote_host', 'Remote Host', 'string', true, "Destination host to forward to, resolved from the session's remote end", {
    group: 'Forwarding',
    allowedFormats: ['plain'],
  }),
  param('remote_port', 'Remote Port', 'integer', true, 'Destination port to forward to', {
    group: 'Forwarding', minimum: 1, maximum: 65535,
  }),
  param('validate_target', 'Validate Target', 'boolean', false, 'Connects to the target once when the tunnel opens and fails if the SSH host refuses or cannot reach it. That connection is handed to the first block that uses the tunnel.', {
    group: 'Advanced', defaultValue: false,
  }),
]

export const outputs: OutputParam[] = [
  sshTunnelIdOutput,
  output('local_port', 'Local Port', 'integer', 'Local port the tunnel listens on; the auto-assigned port when 0 was requested'),
]
