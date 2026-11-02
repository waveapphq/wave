/**
 * Map key-policy resolution: schema policy -> the validator's data shape.
 * Shared by the config-sheet map editor and the canvas node-issue mirror so
 * both surfaces apply the duplicate and blocked-key checks identically.
 */

import type { ResolvedMapKeyPolicy } from '@/lib/variable-validation'
import type { MapKeyPolicy } from './types'

/** Resolve a schema key policy to the validator shape. */
export function resolveKeyPolicy(policy: MapKeyPolicy): ResolvedMapKeyPolicy {
  return {
    keyNoun: policy.keyNoun,
    caseInsensitive: policy.caseInsensitive,
    blockedKeys: policy.blockedKeys,
    keyPattern: policy.keyPattern,
    blockedPrefixes: policy.blockedPrefixes,
  }
}
