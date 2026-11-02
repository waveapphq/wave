/** Resolves a block's tri-state secret masking against the system run-output default (FE mirror of resolve_block_reveal). */

export type SecretMaskingSetting = 'system' | 'reveal' | 'mask'

export function resolveEffectiveReveal(
  setting: SecretMaskingSetting,
  systemRunOutput: boolean,
): boolean {
  if (setting === 'reveal') return true
  if (setting === 'mask') return false
  return systemRunOutput
}
