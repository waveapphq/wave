/**
 * The lists of the backend expression sandbox (`backend/wavecore/core/expressions/security.py`).
 * `backend/tests/core/test_expression_security.py` pins each one to its backend twin.
 */

/** Every name the sandbox defines (`SAFE_BUILTINS`): what an expression may use without declaring it. */
export const EXPRESSION_SAFE_NAMES: ReadonlySet<string> = new Set([
  'ColumnType',
  'False',
  'None',
  'Table',
  'TableRowView',
  'True',
  'abs',
  'all',
  'any',
  'bool',
  'dict',
  'filter',
  'float',
  'format',
  'int',
  'len',
  'list',
  'map',
  'max',
  'min',
  'range',
  'reversed',
  'round',
  'set',
  'slice',
  'sorted',
  'str',
  'sum',
  'type',
])

/** Text refused anywhere in an expression (`BLOCKED_SUBSTRINGS`). */
export const BLOCKED_SUBSTRINGS: ReadonlySet<string> = new Set([
  '__',
])

/** Names refused when called (`BLOCKED_FUNCTION_NAMES`); the same word as a variable name stays allowed. */
export const BLOCKED_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  'import',
  'exec',
  'eval',
  'compile',
  'open',
  'file',
  'input',
  'globals',
  'locals',
  'vars',
  'getattr',
  'setattr',
  'delattr',
  'breakpoint',
])

/** Constructors a read-only field expression may not call (`FIELD_BLOCKED_CONSTRUCTORS`). */
export const FIELD_BLOCKED_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'list',
  'dict',
  'set',
])

/** Methods that change data, refused in a read-only field expression (`MUTATING_METHOD_NAMES`). */
export const MUTATING_METHOD_NAMES: ReadonlySet<string> = new Set([
  'append',
  'extend',
  'insert',
  'remove',
  'pop',
  'clear',
  'sort',
  'reverse',
  'update',
  'setdefault',
  'popitem',
  'add',
  'discard',
  'set_cell',
  'set_row',
  'add_row',
  'insert_row',
  'remove_row',
  'add_col',
  'insert_col',
  'remove_col',
])
