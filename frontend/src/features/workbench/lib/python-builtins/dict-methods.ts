/**
 * Python Builtins - Dict Methods
 *
 * Contains common methods for the Python dict type.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/**
 * Common methods for dict type
 */
export const DICT_METHODS: PythonMethod[] = [
  method('keys', ['.keys() -> dict_keys'], 'Return a view of the dictionary keys.', ['dict'], 0, 0),
  method('values', ['.values() -> dict_values'], 'Return a view of the dictionary values.', ['dict'], 0, 0),
  method('items', ['.items() -> dict_items'], 'Return a view of the dictionary (key, value) pairs.', ['dict'], 0, 0),
  method('get', ['.get(key: Any) -> Any', '.get(key: Any, default: Any) -> Any'], 'Return value for key if present, else default.', ['dict'], 1, 2),
  method('pop', ['.pop(key: Any) -> Any', '.pop(key: Any, default: Any) -> Any'], 'Remove key and return its value, or default.', ['dict'], 1, 2),
  method('popitem', ['.popitem() -> tuple'], 'Remove and return a (key, value) pair as tuple.', ['dict'], 0, 0),
  method('setdefault', ['.setdefault(key: Any) -> Any', '.setdefault(key: Any, default: Any) -> Any'], 'If key is in dict, return its value. If not, insert key with default.', ['dict'], 1, 2),
  method('update', ['.update(other: dict) -> None', '.update(other: Iterable) -> None'], 'Update the dictionary with key/value pairs from other.', ['dict'], 1, 1, { returns: 'None' }),
  method('clear', ['.clear() -> None'], 'Remove all items from the dictionary.', ['dict'], 0, 0, { returns: 'None' }),
  method('copy', ['.copy() -> dict'], 'Return a shallow copy of the dictionary.', ['dict'], 0, 0, { returns: 'dict' }),
]
