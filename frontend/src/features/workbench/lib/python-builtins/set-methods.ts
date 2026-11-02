/**
 * Python Builtins - Set Methods
 *
 * Contains common methods for the Python set type.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/**
 * Common methods for set type
 */
export const SET_METHODS: PythonMethod[] = [
  method('add', ['.add(elem: Any) -> None'], 'Add element to the set.', ['set'], 1, 1, { returns: 'None' }),
  method('remove', ['.remove(elem: Any) -> None'], 'Remove element from the set. Raises KeyError if not present.', ['set'], 1, 1, { returns: 'None' }),
  method('discard', ['.discard(elem: Any) -> None'], 'Remove element from the set if present.', ['set'], 1, 1, { returns: 'None' }),
  method('pop', ['.pop() -> Any'], 'Remove and return an arbitrary element.', ['set'], 0, 0),
  method('clear', ['.clear() -> None'], 'Remove all elements from the set.', ['set'], 0, 0, { returns: 'None' }),
  method('union', ['.union(*others: Iterable) -> set'], 'Return a new set with elements from this set and all others.', ['set'], 0, -1, { returns: 'set' }),
  method('intersection', ['.intersection(*others: Iterable) -> set'], 'Return a new set with elements common to this set and all others.', ['set'], 0, -1, { returns: 'set' }),
  method('difference', ['.difference(*others: Iterable) -> set'], 'Return a new set with elements in this set but not in others.', ['set'], 0, -1, { returns: 'set' }),
  method('symmetric_difference', ['.symmetric_difference(other: Iterable) -> set'], 'Return a new set with elements in either set but not both.', ['set'], 1, 1, { returns: 'set' }),
  method('issubset', ['.issubset(other: Iterable) -> bool'], 'Test whether every element in the set is in other.', ['set'], 1, 1, { returns: 'bool' }),
  method('issuperset', ['.issuperset(other: Iterable) -> bool'], 'Test whether every element in other is in the set.', ['set'], 1, 1, { returns: 'bool' }),
  method('isdisjoint', ['.isdisjoint(other: Iterable) -> bool'], 'Return True if the set has no elements in common with other.', ['set'], 1, 1, { returns: 'bool' }),
  method('copy', ['.copy() -> set'], 'Return a shallow copy of the set.', ['set'], 0, 0, { returns: 'set' }),
]
