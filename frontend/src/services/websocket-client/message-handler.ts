/**
 * WebSocket Message Handler - REQ-5.2.1.4
 *
 * Handles incoming WebSocket messages: event dispatch, ping/pong,
 * acknowledgments, error messages, and subscription confirmations.
 */

import type { ClientContext } from './client-context'
import { emitError, emitEvent, emitAcknowledgment, emitSequenceGap, sendMessage, setState, clearTimers } from './client-context'
import type { MessageEnvelope, AcknowledgmentResponse, EventMetadata, WebSocketErrorType } from './types'
import { createWebSocketError, matchesTopic } from './utils'
import { resetHeartbeatTimer } from './heartbeat'

/**
 * Handles an incoming raw WebSocket message
 */
export function handleMessage(ctx: ClientContext, data: string | ArrayBuffer): void {
  let messageStr: string

  if (typeof data === 'string') {
    messageStr = data
  } else {
    // Handle ArrayBuffer (or any buffer-like object)
    messageStr = new TextDecoder().decode(data)
  }

  let envelope: MessageEnvelope

  try {
    envelope = JSON.parse(messageStr) as MessageEnvelope
  } catch {
    emitError(ctx, createWebSocketError('protocol_error', 'Invalid JSON message'))
    return
  }

  // Validate envelope
  if (!envelope.type) {
    emitError(ctx, createWebSocketError('protocol_error', 'Invalid message envelope: missing type'))
    return
  }

  // Reset heartbeat timer on any message
  resetHeartbeatTimer(ctx)

  // Handle different message types
  switch (envelope.type) {
    case 'event':
      handleEventMessage(ctx, envelope)
      break

    case 'ping':
      handlePingMessage(ctx, envelope)
      break

    case 'ack':
      handleAckMessage(ctx, envelope)
      break

    case 'error':
      handleErrorMessage(ctx, envelope)
      break

    case 'subscribed':
      handleSubscribedMessage(ctx, envelope)
      break

    case 'session_terminated':
      // Administrative boot: enter a terminal state and never auto-reconnect.
      ctx.isTerminated = true
      ctx.isExplicitDisconnect = true
      clearTimers(ctx)
      setState(ctx, 'terminated')
      break

    // Unknown types are silently ignored
  }
}

/**
 * Handles an event message: sequence tracking, ack, and handler dispatch
 */
function handleEventMessage(ctx: ClientContext, envelope: MessageEnvelope): void {
  const { topic, payload, timestamp, sequence, ackId } = envelope

  if (!topic) return

  // Check sequence for gap detection
  if (sequence !== undefined) {
    const expectedSequence = (ctx.topicSequences.get(topic) ?? 0) + 1
    if (sequence > expectedSequence) {
      emitSequenceGap(ctx, {
        topic,
        expected: expectedSequence,
        received: sequence,
      })
    }
    ctx.topicSequences.set(topic, sequence)
  }

  // Send acknowledgment if required
  if (ackId) {
    sendMessage(ctx, {
      type: 'ack',
      ackId,
      success: true,
    })
  }

  const metadata: EventMetadata = {
    topic,
    timestamp: timestamp ?? Date.now(),
    sequence: sequence ?? 0,
  }

  // Emit base event for store integration
  emitEvent(ctx, { topic, payload })

  // Dispatch to topic-specific handlers
  ctx.subscriptions.forEach((handlers, pattern) => {
    if (matchesTopic(pattern, topic)) {
      handlers.forEach(({ handler }) => {
        try {
          handler(payload, metadata)
        } catch {
          // Errors in handlers don't propagate - other handlers still execute
        }
      })
    }
  })
}

/**
 * Handles a ping message: calculates latency and sends pong
 */
function handlePingMessage(ctx: ClientContext, envelope: MessageEnvelope): void {
  const pingTimestamp = envelope.timestamp ?? Date.now()

  // Calculate latency
  ctx.latency = Date.now() - pingTimestamp

  // Send pong response
  sendMessage(ctx, {
    type: 'pong',
    timestamp: Date.now(),
    pingTimestamp,
  })
}

/**
 * Handles an acknowledgment message: resolves pending promises
 */
function handleAckMessage(ctx: ClientContext, envelope: MessageEnvelope): void {
  const ackId = (envelope as unknown as Record<string, unknown>).ackId as string | undefined
  const success = (envelope as unknown as Record<string, unknown>).success as boolean | undefined
  const error = (envelope as unknown as Record<string, unknown>).error as string | undefined

  if (!ackId) return

  const response: AcknowledgmentResponse = {
    ackId,
    success: success ?? false,
    error,
  }

  // Emit to general listeners
  emitAcknowledgment(ctx, response)

  // Resolve pending promise if any
  const pending = ctx.pendingAcks.get(ackId)
  if (pending) {
    clearTimeout(pending.timeout)
    ctx.pendingAcks.delete(ackId)
    pending.resolve(response)
  }
}

/**
 * Handles a server error message
 */
function handleErrorMessage(ctx: ClientContext, envelope: MessageEnvelope): void {
  const code = (envelope as unknown as Record<string, unknown>).code as string | undefined
  const message = (envelope as unknown as Record<string, unknown>).message as string | undefined
  const topic = (envelope as unknown as Record<string, unknown>).topic as string | undefined

  const errorType: WebSocketErrorType = code === 'SUBSCRIPTION_DENIED' ? 'subscription_error' : 'protocol_error'

  emitError(ctx, createWebSocketError(errorType, message ?? 'Unknown error', undefined, topic))
}

/**
 * Handles a subscription confirmation from the server
 */
function handleSubscribedMessage(ctx: ClientContext, envelope: MessageEnvelope): void {
  const topic = (envelope as unknown as Record<string, unknown>).topic as string | undefined
  if (!topic) return

  // Resolve pending confirmation if any
  const resolve = ctx.pendingSubscriptionConfirmations.get(topic)
  if (resolve) {
    ctx.pendingSubscriptionConfirmations.delete(topic)
    resolve()
  }
}
