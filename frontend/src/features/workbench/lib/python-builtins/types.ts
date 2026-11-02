/**
 * Python Builtins - Type Definitions
 *
 * Contains type definitions for Python builtin functions and methods
 * used in expression autocomplete.
 */

export interface PythonBuiltin {
  name: string
  signature: string
  description: string
  category: 'conversion' | 'math' | 'sequence' | 'string' | 'logic' | 'io' | 'type' | 'other'
  /** Return type for autocomplete after function call (e.g., str(1). shows string methods) */
  returns?: PythonType
}

/** `column` is the step `table.filter(column)` returns, awaiting its operator. */
export type PythonType = 'str' | 'list' | 'dict' | 'set' | 'int' | 'float' | 'bool' | 'None' | 'table' | 'column'

export interface PythonMethod {
  name: string
  /** Array of signature overloads, e.g. ['.split() -> list', '.split(sep: str) -> list'] */
  signatures: string[]
  description: string
  appliesTo: PythonType[]
  returns?: PythonType  // Return type (if known) - defaults to same as appliesTo[0]
  /** Minimum number of arguments required. Derived from signatures. */
  minArgs: number
  /** Maximum number of arguments allowed. -1 for unlimited (*args). Derived from signatures. */
  maxArgs: number
}

// ---------------------------------------------------------------------------
// Factory helpers - reduce structural duplication in builtin/method literals
// ---------------------------------------------------------------------------

type BuiltinCategory = PythonBuiltin['category']

/** Create a PythonBuiltin entry with concise syntax */
export function builtin(
  name: string,
  signature: string,
  description: string,
  category: BuiltinCategory,
  opts?: Pick<PythonBuiltin, 'returns'>,
): PythonBuiltin {
  return { name, signature, description, category, ...opts }
}

/** Create a PythonMethod entry with concise syntax */
export function method(
  name: string,
  signatures: string[],
  description: string,
  appliesTo: PythonType[],
  minArgs: number,
  maxArgs: number,
  opts?: Pick<PythonMethod, 'returns'>,
): PythonMethod {
  return { name, signatures, description, appliesTo, minArgs, maxArgs, ...opts }
}
