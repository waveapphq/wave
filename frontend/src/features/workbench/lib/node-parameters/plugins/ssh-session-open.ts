/**
 * SSH Session Open Plugin Parameters
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam, type SecretMaskField } from '../types'
import { sshSessionIdOutput } from './_ssh-session-shared'

export const groups: Record<string, GroupMeta> = {
  Connection: group('Connection', {
    description: 'Target host and credentials',
    defaultExpanded: true,
  }),
  Advanced: group('Advanced', {
    description: 'Host-key policy, timeouts, and session tuning',
  }),
}

export const inputs: InputParam[] = [
  // --- Connection ---
  param('host', 'Host', 'string', true, 'Target host name or IP address to connect to', {
    group: 'Connection', allowedFormats: ['plain'],
  }),
  param('port', 'Port', 'integer', true, 'SSH port on the target host', {
    group: 'Connection', defaultValue: 22, minimum: 1, maximum: 65535,
  }),
  param('username', 'Username', 'string', true, 'Login user on the target host', {
    group: 'Connection', allowedFormats: ['plain'],
  }),
  param('password', 'Password', 'string', false, 'Password for password authentication - either a password or a private key is required', {
    group: 'Connection', secret: true, allowedFormats: ['plain'],
  }),
  param('private_key', 'Private Key', 'string', false, 'Private key for key authentication: inline PEM content or the path of a key file on the WAVE host; a relative path starts at the home folder of the account WAVE runs under', {
    group: 'Connection', secret: true, allowedFormats: ['plain'],
  }),
  param('use_parent', 'Via parent session', 'boolean', false, 'Chain through a parent session: route this connection over an open SSH session (multi-hop / jump host). Off connects directly to the host', {
    group: 'Connection', defaultValue: false,
  }),
  param('parent_session_id', 'Parent Session', 'string', false, 'Session ID of the open parent SSH session to tunnel over. The connection fails if the parent is not open', {
    group: 'Connection', allowedFormats: ['plain'],
    showWhen: { field: 'use_parent', values: ['true'] },
    requiredWhen: { field: 'use_parent', values: ['true'] },
  }),
  // --- Advanced ---
  param('passphrase', 'Passphrase', 'string', false, 'Passphrase unlocking the private key, when the key is encrypted', {
    group: 'Advanced', secret: true, allowedFormats: ['plain'],
  }),
  param('host_key_verification', 'Host Key Verification', 'string', false, "Host key policy: 'strict' requires the host to be in WAVE's trusted hosts list, 'accept-new' adds an unknown host's key to that list the first time and refuses it later if it changes, 'disabled' skips verification. While trusted hosts are locked in Settings, 'accept-new' acts as 'strict'. Default: 'disabled'; a newly placed block takes the Settings default.", {
    group: 'Advanced', enumValues: ['strict', 'accept-new', 'disabled'], defaultValue: 'disabled',
  }),
  param('connect_timeout', 'Connect Timeout', 'integer', false, 'Connection timeout in seconds', {
    group: 'Advanced', defaultValue: 30, minimum: 1,
  }),
  param('keep_alive_interval', 'Keep-Alive Interval', 'integer', false, 'Seconds between keepalive probes; 0 disables keepalive. With keepalive on, a dropped connection flips the Connected output to false', {
    group: 'Advanced', defaultValue: 0, minimum: 0,
  }),
  param('keep_alive_max_count', 'Keep-Alive Max Count', 'integer', false, 'Consecutive unanswered keepalives before the connection counts as lost', {
    group: 'Advanced', defaultValue: 3, minimum: 1,
  }),
  param('compression', 'Compression', 'boolean', false, 'Enable zlib compression on the connection', {
    group: 'Advanced', defaultValue: false,
  }),
]

// The block's per-field masking catalog: the three declared credential params.
// Keys MUST equal the backend SSHSessionOpenPlugin secret_mask_fields set
// (guarded by a parity test).
export const secretMaskFields: SecretMaskField[] = [
  { key: 'password', label: 'Password' },
  { key: 'private_key', label: 'Private Key' },
  { key: 'passphrase', label: 'Passphrase' },
]

export const outputs: OutputParam[] = [
  sshSessionIdOutput,
  output('connected', 'Connected', 'boolean', 'Liveness signal: true while the session is open; flips to false when the session closes or keepalive detects the connection dropped'),
  output('server_banner', 'Server Banner', 'string', "SSH identification string reported by the server, e.g. 'SSH-2.0-OpenSSH_9.6'; empty when the server sends none"),
  output('hop_count', 'Hop Count', 'integer', "Number of hops in this session's chain: 1 for a direct connection, 2+ when chained through parent sessions"),
]
