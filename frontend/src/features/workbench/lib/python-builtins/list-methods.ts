/**
 * Python Builtins - List Methods
 *
 * Contains common methods for the Python list type.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/**
 * Common methods for list type
 */
export const LIST_METHODS: PythonMethod[] = [
  method('append', ['.append(x: Any) -> None'], 'Add an item to the end of the list.', ['list'], 1, 1, { returns: 'None' }),
  method('extend', ['.extend(iterable: Iterable) -> None'], 'Extend the list by appending all items from the iterable.', ['list'], 1, 1, { returns: 'None' }),
  method('insert', ['.insert(i: int, x: Any) -> None'], 'Insert an item at a given position.', ['list'], 2, 2, { returns: 'None' }),
  method('remove', ['.remove(x: Any) -> None'], 'Remove first item from the list whose value equals x.', ['list'], 1, 1, { returns: 'None' }),
  method('pop', ['.pop() -> Any', '.pop(i: int) -> Any'], 'Remove and return item at index (default last).', ['list'], 0, 1),
  method('clear', ['.clear() -> None'], 'Remove all items from the list.', ['list'], 0, 0, { returns: 'None' }),
  method('index', ['.index(x: Any) -> int', '.index(x: Any, start: int) -> int', '.index(x: Any, start: int, end: int) -> int'], 'Return index of first item whose value equals x.', ['list'], 1, 3, { returns: 'int' }),
  method('count', ['.count(x: Any) -> int'], 'Return number of times x appears in the list.', ['list'], 1, 1, { returns: 'int' }),
  method('sort', ['.sort() -> None', '.sort(key: Callable) -> None', '.sort(key: Callable, reverse: bool) -> None'], 'Sort the list in place.', ['list'], 0, 2, { returns: 'None' }),
  method('reverse', ['.reverse() -> None'], 'Reverse the elements of the list in place.', ['list'], 0, 0, { returns: 'None' }),
  method('copy', ['.copy() -> list'], 'Return a shallow copy of the list.', ['list'], 0, 0, { returns: 'list' }),
]
