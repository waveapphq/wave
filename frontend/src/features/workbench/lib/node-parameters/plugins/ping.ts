/**
 * Ping Plugin Parameters
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  streamOutputInput,
  timeoutInput,
} from './_shared-params'

const BY_REPLIES = { field: 'pass_when', values: ['min_replies'] }
const BY_RATE = { field: 'pass_when', values: ['min_rate'] }
const COUNT_CEILING = { field: 'count', message: 'Minimum replies cannot exceed Count' }

export const groups: Record<string, GroupMeta> = {
  Advanced: group('Advanced'),
  [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
}

export const inputs: InputParam[] = [
  param('host', 'Host', 'string', true, 'Host name or IP address to ping. One host per block; a host that does not resolve fails the block.', {
    allowedFormats: ['plain'],
  }),
  param('count', 'Count', 'integer', false, 'How many echo requests to send, as ping -c does.', {
    defaultValue: 4,
    minimum: 1,
    maximum: 1000,
  }),
  param('interval', 'Interval (seconds)', 'float', false, 'Seconds between requests, as ping -i does.', {
    defaultValue: 1,
    minimum: 0.2,
  }),
  param('packet_size', 'Packet size (bytes)', 'integer', false, 'Payload bytes in each request, as ping -s does. The wire size adds 28 bytes over IPv4 and 48 over IPv6.', {
    defaultValue: 56,
    minimum: 0,
    maximum: 65507,
  }),
  timeoutInput(30, 'Seconds the whole block may take, resolving the host included. It is the real bound on the run, whatever Count and Interval would otherwise take.'),
  param('pass_when', 'Pass when', 'string', false, "Any reply passes on one answer, which is ping's own rule. All replies needs every request answered; the other two set a count or a rate.", {
    enumValues: ['any', 'all', 'min_replies', 'min_rate'],
    enumLabels: {
      any: 'Any reply',
      all: 'All replies',
      min_replies: 'At least N replies',
      min_rate: 'At least X% replies',
    },
    defaultValue: 'any',
    noExpression: true,
  }),
  param('min_replies', 'Minimum replies', 'integer', false, 'How many requests must be answered for the block to pass.', {
    defaultValue: 1,
    minimum: 1,
    maximumField: COUNT_CEILING,
    showWhen: BY_REPLIES,
    requiredWhen: BY_REPLIES,
    retainOnHide: true,
  }),
  param('min_rate', 'Minimum rate (%)', 'float', false, 'The percentage of requests that must be answered for the block to pass.', {
    defaultValue: 100,
    minimum: 0,
    maximum: 100,
    showWhen: BY_RATE,
    requiredWhen: BY_RATE,
    retainOnHide: true,
  }),
  streamOutputInput('Write a line to the run console for each reply as it arrives, and a warning for each request that went unanswered.'),
  // --- Advanced ---
  param('ip_version', 'IP version', 'string', false, 'Which address of the host to ping: Auto takes the first the resolver returns, IPv4 and IPv6 force the family, as ping -4 and ping -6 do.', {
    enumValues: ['auto', 'v4', 'v6'],
    enumLabels: { auto: 'Auto', v4: 'IPv4', v6: 'IPv6' },
    defaultValue: 'auto',
    noExpression: true,
    group: 'Advanced',
  }),
  param('ttl', 'TTL', 'integer', false, 'How many hops a request may take, as ping -t does. Empty leaves the system default.', {
    minimum: 1,
    maximum: 255,
    group: 'Advanced',
  }),
  param('dont_fragment', "Don't fragment", 'boolean', false, 'Forbid fragmenting the request, as ping -M do does, so a packet too large for the path fails the block and reports the path size.', {
    defaultValue: false,
    group: 'Advanced',
  }),
  param('source_address', 'Source address', 'string', false, 'The local IP address requests leave from, as ping -I does. It takes an address, never an interface name.', {
    group: 'Advanced',
    allowedFormats: ['plain'],
  }),
  // --- Failure Handling ---
  failureHandlingOnErrorInput(),
]

const [SUCCESS, ERROR, REASON] = outputCore({
  successDescription: 'True when the replies met the Pass when rule. False when the block failed and On error is Record and continue.',
  reasonDescription: 'Why it failed: Unprivileged, Unresolved, Source, TooLarge, Timeout, NoReply, NotAllReplied, TooFewReplies or RateTooLow; empty when it passed.',
})

export const outputs: OutputParam[] = [
  SUCCESS,
  output('summary', 'Summary', 'table', 'One row: sent, received, loss_percent and the round-trip rtt_min_ms, rtt_avg_ms, rtt_max_ms and rtt_mdev_ms.'),
  output('replies', 'Replies', 'table', 'One row per request: seq, source, bytes, ttl, time_ms and status.'),
  ERROR,
  REASON,
]
