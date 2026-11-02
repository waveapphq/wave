/**
 * Python Builtins - String Methods
 *
 * Contains common methods for the Python string type.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/**
 * Common methods for string type
 */
export const STRING_METHODS: PythonMethod[] = [
  method('upper', ['.upper() -> str'], 'Return a copy of the string converted to uppercase.', ['str'], 0, 0, { returns: 'str' }),
  method('lower', ['.lower() -> str'], 'Return a copy of the string converted to lowercase.', ['str'], 0, 0, { returns: 'str' }),
  method('strip', ['.strip() -> str', '.strip(chars: str) -> str'], 'Return a copy with leading and trailing whitespace removed.', ['str'], 0, 1, { returns: 'str' }),
  method('lstrip', ['.lstrip() -> str', '.lstrip(chars: str) -> str'], 'Return a copy with leading whitespace removed.', ['str'], 0, 1, { returns: 'str' }),
  method('rstrip', ['.rstrip() -> str', '.rstrip(chars: str) -> str'], 'Return a copy with trailing whitespace removed.', ['str'], 0, 1, { returns: 'str' }),
  method('split', ['.split() -> list', '.split(sep: str) -> list', '.split(sep: str, maxsplit: int) -> list'], 'Return a list of words in the string, using sep as delimiter.', ['str'], 0, 2, { returns: 'list' }),
  method('rsplit', ['.rsplit() -> list', '.rsplit(sep: str) -> list', '.rsplit(sep: str, maxsplit: int) -> list'], 'Return a list of words, splitting from the right.', ['str'], 0, 2, { returns: 'list' }),
  method('join', ['.join(iterable: Iterable) -> str'], 'Concatenate strings from iterable with this string as separator.', ['str'], 1, 1, { returns: 'str' }),
  method('replace', ['.replace(old: str, new: str) -> str', '.replace(old: str, new: str, count: int) -> str'], 'Return a copy with all occurrences of old replaced by new.', ['str'], 2, 3, { returns: 'str' }),
  method('find', ['.find(sub: str) -> int', '.find(sub: str, start: int) -> int', '.find(sub: str, start: int, end: int) -> int'], 'Return lowest index where substring is found, or -1.', ['str'], 1, 3, { returns: 'int' }),
  method('rfind', ['.rfind(sub: str) -> int', '.rfind(sub: str, start: int) -> int', '.rfind(sub: str, start: int, end: int) -> int'], 'Return highest index where substring is found, or -1.', ['str'], 1, 3, { returns: 'int' }),
  method('index', ['.index(sub: str) -> int', '.index(sub: str, start: int) -> int', '.index(sub: str, start: int, end: int) -> int'], 'Like find(), but raise ValueError when not found.', ['str'], 1, 3, { returns: 'int' }),
  method('count', ['.count(sub: str) -> int', '.count(sub: str, start: int) -> int', '.count(sub: str, start: int, end: int) -> int'], 'Return number of non-overlapping occurrences of substring.', ['str'], 1, 3, { returns: 'int' }),
  method('startswith', ['.startswith(prefix: str) -> bool', '.startswith(prefix: str, start: int) -> bool', '.startswith(prefix: str, start: int, end: int) -> bool'], 'Return True if string starts with the prefix.', ['str'], 1, 3, { returns: 'bool' }),
  method('endswith', ['.endswith(suffix: str) -> bool', '.endswith(suffix: str, start: int) -> bool', '.endswith(suffix: str, start: int, end: int) -> bool'], 'Return True if string ends with the suffix.', ['str'], 1, 3, { returns: 'bool' }),
  method('isdigit', ['.isdigit() -> bool'], 'Return True if all characters are digits.', ['str'], 0, 0, { returns: 'bool' }),
  method('isalpha', ['.isalpha() -> bool'], 'Return True if all characters are alphabetic.', ['str'], 0, 0, { returns: 'bool' }),
  method('isalnum', ['.isalnum() -> bool'], 'Return True if all characters are alphanumeric.', ['str'], 0, 0, { returns: 'bool' }),
  method('isspace', ['.isspace() -> bool'], 'Return True if all characters are whitespace.', ['str'], 0, 0, { returns: 'bool' }),
  method('isupper', ['.isupper() -> bool'], 'Return True if all cased characters are uppercase.', ['str'], 0, 0, { returns: 'bool' }),
  method('islower', ['.islower() -> bool'], 'Return True if all cased characters are lowercase.', ['str'], 0, 0, { returns: 'bool' }),
  method('title', ['.title() -> str'], 'Return a titlecased version of the string.', ['str'], 0, 0, { returns: 'str' }),
  method('capitalize', ['.capitalize() -> str'], 'Return a copy with first character capitalized.', ['str'], 0, 0, { returns: 'str' }),
  method('swapcase', ['.swapcase() -> str'], 'Return a copy with uppercase converted to lowercase and vice versa.', ['str'], 0, 0, { returns: 'str' }),
  method('center', ['.center(width: int) -> str', '.center(width: int, fillchar: str) -> str'], 'Return centered in a string of specified width.', ['str'], 1, 2, { returns: 'str' }),
  method('ljust', ['.ljust(width: int) -> str', '.ljust(width: int, fillchar: str) -> str'], 'Return left-justified in a string of specified width.', ['str'], 1, 2, { returns: 'str' }),
  method('rjust', ['.rjust(width: int) -> str', '.rjust(width: int, fillchar: str) -> str'], 'Return right-justified in a string of specified width.', ['str'], 1, 2, { returns: 'str' }),
  method('zfill', ['.zfill(width: int) -> str'], 'Pad a numeric string with zeros on the left.', ['str'], 1, 1, { returns: 'str' }),
  method('format', ['.format(*args, **kwargs) -> str'], 'Perform string formatting operation.', ['str'], 0, -1, { returns: 'str' }),
  method('encode', ['.encode() -> bytes', '.encode(encoding: str) -> bytes'], 'Encode the string using the specified encoding.', ['str'], 0, 1),
]
