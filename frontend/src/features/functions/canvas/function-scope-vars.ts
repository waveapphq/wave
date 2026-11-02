/**
 * Pure helpers that gate variable / namespace visibility when drilled into a
 * local Function. Inside a Function the Variable Manager hides all external
 * scopes (system / regression / suite / test); only PARAMETERS + VARIABLES
 * declared on the Function itself appear.
 */

export interface FunctionScope {
  insideFunction: boolean
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

interface NamedVariable {
  name: string
}

interface NamespaceVariablesLike<E> {
  system: E[]
  suite: E[]
  regression: E[]
}

/**
 * Filter a list of variables by the active scope.
 *
 * Outside a Function the list passes through (identity preserved). Inside a
 * Function, only variables whose name appears in `scope.allowedVarNames` are
 * kept.
 */
export function filterVariablesForScope<V extends NamedVariable>(
  variables: V[],
  scope: FunctionScope,
): V[] {
  if (!scope.insideFunction) return variables
  return variables.filter((v) => scope.allowedVarNames.has(v.name))
}

/**
 * Filter the namespace variables (system / suite / regression) by the active
 * scope. Outside a Function the input is returned by identity. Inside a
 * Function every external namespace is emptied; the original input is not
 * mutated.
 */
export function filterNamespaceVarsForScope<E>(
  namespaceVars: NamespaceVariablesLike<E>,
  scope: FunctionScope,
): NamespaceVariablesLike<E> {
  if (!scope.insideFunction) return namespaceVars
  return { system: [], suite: [], regression: [] }
}
