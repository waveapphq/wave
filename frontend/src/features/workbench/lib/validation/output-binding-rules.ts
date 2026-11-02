/**
 * Rules that decide which variable names are valid output-binding targets.
 *
 * Output bindings can only write to test-local variables. Namespace
 * placeholders (`system`, `suite`, `regression`) and dotted aliases
 * (`system.host`, `profile.field`) are read-only and must be rejected both
 * from the dropdown and from free-text typing.
 *
 * The name must additionally be a valid Python identifier so the runtime
 * variable manager can store it without escaping.
 */

import { NAMESPACE_ROOTS } from '@/features/workbench/lib/namespace-roots'

const PYTHON_IDENTIFIER = /^[a-zA-Z_]\w*$/

const RESERVED_NAMESPACE_NAMES = NAMESPACE_ROOTS

/** Returns true when `name` may legitimately receive an output binding. */
export function isOutputBindable(name: string): boolean {
  if (!name) return false
  if (!PYTHON_IDENTIFIER.test(name)) return false
  if (RESERVED_NAMESPACE_NAMES.has(name)) return false
  return true
}

/**
 * Why a binding name is rejected, in human-readable form. Returns null when
 * the name is acceptable for output binding.
 */
export function describeBindingRejection(name: string): string | null {
  if (!name) return null
  if (RESERVED_NAMESPACE_NAMES.has(name)) {
    return `'${name}' is a read-only namespace and cannot receive an output`
  }
  if (name.includes('.')) {
    return `'${name}' is a namespace or profile reference; pick or create a test-local variable instead`
  }
  if (!PYTHON_IDENTIFIER.test(name)) {
    return `'${name}' is not a valid variable name (use letters, digits, underscores; must not start with a digit)`
  }
  return null
}
