/**
 * resolveEffectiveReveal - a block's effective run-output reveal (REQ-3.1.3.5).
 *
 * The FE mirror of the backend `resolve_block_reveal`: a block's tri-state
 * choice resolves against the system run-output default. 'reveal'/'mask'
 * override in either direction; 'system' (and any unknown value) inherits.
 * Shared by the config-modal helper, the collapsed pill, and the canvas badge.
 */

import { describe, it, expect } from 'vitest'
import { resolveEffectiveReveal } from '@/features/workbench/lib/node-parameters/secret-reveal'

describe('resolveEffectiveReveal', () => {
  it("'reveal' is true even when the system default is masked", () => {
    expect(resolveEffectiveReveal('reveal', false)).toBe(true)
  })

  it("'reveal' is true when the system default is revealed", () => {
    expect(resolveEffectiveReveal('reveal', true)).toBe(true)
  })

  it("'mask' is false even when the system default is revealed", () => {
    expect(resolveEffectiveReveal('mask', true)).toBe(false)
  })

  it("'mask' is false when the system default is masked", () => {
    expect(resolveEffectiveReveal('mask', false)).toBe(false)
  })

  it("'system' follows the masked system default", () => {
    expect(resolveEffectiveReveal('system', false)).toBe(false)
  })

  it("'system' follows the revealed system default", () => {
    expect(resolveEffectiveReveal('system', true)).toBe(true)
  })

  it('an unknown setting falls back to the system default (masked)', () => {
    expect(resolveEffectiveReveal('bogus' as never, false)).toBe(false)
  })

  it('an unknown setting falls back to the system default (revealed)', () => {
    expect(resolveEffectiveReveal('bogus' as never, true)).toBe(true)
  })
})
