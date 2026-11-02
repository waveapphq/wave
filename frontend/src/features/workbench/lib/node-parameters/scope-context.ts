import type { InputParam } from './types'

/** Active-canvas signals that decide whether a Function body is in scope. */
export interface CanvasScopeContext {
  drilled: boolean
  functionView: boolean
}

/**
 * Drop the `function` scope option from a Halt control's scope param when the
 * config is opened outside a Function body. `function` scope is only meaningful
 * inside a Function (the backend rejects it elsewhere); offering it at the Test
 * top level would be a no-op footgun. No-op for non-Halt controls or when the
 * active canvas is a Function body (drilled in or Function View).
 */
export function gateHaltScopeForContext(
  elementType: string,
  params: InputParam[],
  ctx: CanvasScopeContext,
): InputParam[] {
  const insideFunction = ctx.drilled || ctx.functionView
  if (elementType !== 'halt' || insideFunction) return params
  return params.map((p) =>
    p.name === 'scope'
      ? { ...p, enumValues: p.enumValues!.filter((v) => v !== 'function') }
      : p,
  )
}
