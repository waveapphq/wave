/**
 * Netcat Plugin Parameters
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from './_shared-params'

const SINGLE = { field: 'ports', values: ['single'] }
const RANGE = { field: 'ports', values: ['range'] }
const TALK = { field: 'mode', values: ['talk'] }
const TCP = { field: 'protocol', values: ['tcp'] }
const UDP = { field: 'protocol', values: ['udp'] }
const SEND_TEXT = { field: 'send', values: ['text'] }
const SEND_FILE = { field: 'send', values: ['file'] }

export const groups: Record<string, GroupMeta> = {
  Advanced: group('Advanced', { description: 'Line endings, closing and reply size for Talk' }),
  [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
}

export const inputs: InputParam[] = [
  param('host', 'Host', 'string', true, 'Host name or IP address to connect to. It is resolved once, within Timeout; a host that does not resolve fails the block.', {
    allowedFormats: ['plain'],
  }),
  param('ports', 'Ports', 'string', false, 'Single works on one port. Range works on every port of a list of ports and ranges.', {
    enumValues: ['single', 'range'],
    enumLabels: { single: 'Single', range: 'Range' },
    defaultValue: 'single',
    noExpression: true,
  }),
  param('port', 'Port', 'integer', false, 'The port to connect to, from 1 to 65535.', {
    showWhen: SINGLE,
    requiredWhen: SINGLE,
    retainOnHide: true,
  }),
  param('port_range', 'Port range', 'string', false, 'Ports and ranges separated by commas, for example 22, 80, 8000-8010. A range runs in ascending order, the entries keep the order written, and a port named twice is used once, at its first position.', {
    showWhen: RANGE,
    requiredWhen: RANGE,
    retainOnHide: true,
  }),
  param('pass_when', 'Pass when', 'string', false, 'One succeeds passes when any port succeeds, as nc does; All succeed passes only when every port does. A port succeeds when it is open, or open or filtered over UDP.', {
    enumValues: ['one', 'all'],
    enumLabels: { one: 'One succeeds', all: 'All succeed' },
    defaultValue: 'one',
    noExpression: true,
    showWhen: RANGE,
  }),
  param('protocol', 'Protocol', 'string', false, 'TCP connects to each port. UDP sends one datagram to each port and waits for a reply or a refusal; a check sends the single byte X, as nc -u -z does.', {
    enumValues: ['tcp', 'udp'],
    enumLabels: { tcp: 'TCP', udp: 'UDP' },
    defaultValue: 'tcp',
    noExpression: true,
  }),
  param('mode', 'Mode', 'string', false, "Check reports each port's state, as nc -vz does; over TCP it connects and sends nothing. Talk connects, sends a payload and captures the reply.", {
    enumValues: ['check', 'talk'],
    enumLabels: { check: 'Check', talk: 'Talk' },
    defaultValue: 'check',
    noExpression: true,
  }),
  // One label, two descriptors: UDP offers no Nothing (NETCAT-4).
  param('send', 'Send', 'string', false, 'What Talk sends. Nothing sends no payload and reads what the server sends on connect, such as a banner. Text sends the Text row; File sends a file.', {
    enumValues: ['nothing', 'text', 'file'],
    enumLabels: { nothing: 'Nothing', text: 'Text', file: 'File' },
    defaultValue: 'text',
    noExpression: true,
    showWhenAll: [TALK, TCP],
  }),
  param('send', 'Send', 'string', false, 'What Talk sends as its one datagram: the Text row or a file. A UDP port answers only a datagram it was sent, so there is no Nothing.', {
    enumValues: ['text', 'file'],
    enumLabels: { text: 'Text', file: 'File' },
    defaultValue: 'text',
    noExpression: true,
    showWhenAll: [TALK, UDP],
  }),
  param('text', 'Text', 'string', false, 'The payload, sent as UTF-8. An empty Text sends nothing over TCP and one empty datagram over UDP.', {
    showWhenAll: [TALK, SEND_TEXT],
    retainOnHide: true,
  }),
  param('file', 'File', 'string', false, 'The payload file: testdata://, artifact:// or an absolute or relative path. A testdata:// or artifact:// file is read on WAVE; a plain path is read where the block runs.', {
    showWhenAll: [TALK, SEND_FILE],
    requiredWhenAll: [TALK, SEND_FILE],
    retainOnHide: true,
    fileReference: 'file',
    placeholder: 'testdata://…, artifact://…, or /abs/path',
    allowedFormats: ['plain'],
  }),
  timeoutInput(10, 'Seconds allowed for resolving the host, for each connection attempt and, in Talk, for the server to take each part of the payload, as nc -w does. In Talk the reply also ends once the server has been silent this long.'),
  // --- Advanced ---
  param('crlf', 'CRLF line endings', 'boolean', false, 'Send every line ending in the payload as carriage return plus line feed, as nc -C does.', {
    defaultValue: false,
    showWhen: TALK,
    group: 'Advanced',
  }),
  param('close_after_send', 'Close after sending', 'boolean', false, 'Shut down the sending side once the payload is sent, or right after connecting with Send Nothing, so a server that waits for the end of its input answers at once, as nc -N does.', {
    defaultValue: false,
    showWhenAll: [TALK, TCP],
    group: 'Advanced',
  }),
  param('max_reply_bytes', 'Max reply size (bytes)', 'integer', false, "Reading stops once a port's reply reaches this many bytes; the rest is not read, and a WARN line says so.", {
    defaultValue: 16777216,
    minimum: 1,
    showWhen: TALK,
    group: 'Advanced',
  }),
  // --- Failure Handling ---
  failureHandlingOnErrorInput(),
]

const [SUCCESS, ERROR, REASON] = outputCore({
  successDescription: 'True when the ports passed the pass rule. False when the block failed and On error is Record and continue.',
  reasonDescription: 'Why it failed: Unresolved, StartFailed, Tunnel, Closed, Timeout, NoneSucceeded or NotAllSucceeded; empty when it passed.',
})

export const outputs: OutputParam[] = [
  SUCCESS,
  output('results', 'Results', 'table', 'One row per port, in Port range order: port, protocol, state, reason and time_ms, plus reply in Talk.'),
  output('reply', 'Reply', 'string', 'What the port sent back, as UTF-8 text; bytes that are not valid UTF-8 appear as U+FFFD.', {
    showWhenAll: [SINGLE, TALK],
  }),
  ERROR,
  REASON,
]
