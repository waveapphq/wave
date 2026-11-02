/**
 * Python Builtins - Builtin Functions
 *
 * Contains Python builtin functions with their signatures and descriptions
 * for use in expression autocomplete.
 *
 * Descriptions are derived from Python official documentation.
 */

import type { PythonBuiltin } from './types'
import { builtin } from './types'

/**
 * Python builtin functions; which of them an expression may call is EXPRESSION_SAFE_NAMES.
 */
export const PYTHON_BUILTINS: PythonBuiltin[] = [
  // Conversion functions
  builtin('str', 'str(object)', 'Convert object to string representation.', 'conversion', { returns: 'str' }),
  builtin('int', 'int(x, base=10)', 'Convert a number or string to an integer.', 'conversion', { returns: 'int' }),
  builtin('float', 'float(x)', 'Convert a string or number to a floating point number.', 'conversion', { returns: 'float' }),
  builtin('bool', 'bool(x)', 'Convert a value to Boolean (True or False).', 'conversion', { returns: 'bool' }),
  builtin('list', 'list(iterable)', 'Convert an iterable to a list.', 'conversion', { returns: 'list' }),
  builtin('dict', 'dict(**kwargs)', 'Create a new dictionary.', 'conversion', { returns: 'dict' }),
  builtin('set', 'set(iterable)', 'Create a new set from an iterable.', 'conversion', { returns: 'set' }),
  builtin('tuple', 'tuple(iterable)', 'Convert an iterable to a tuple.', 'conversion'),
  builtin('bytes', 'bytes(source, encoding)', 'Convert to bytes object.', 'conversion'),

  // Math functions
  builtin('abs', 'abs(x)', 'Return the absolute value of a number.', 'math'),
  builtin('round', 'round(number, ndigits=None)', 'Round a number to a given precision in decimal digits.', 'math'),
  builtin('pow', 'pow(base, exp, mod=None)', 'Return base to the power exp; if mod is present, return base**exp % mod.', 'math'),
  builtin('divmod', 'divmod(a, b)', 'Return tuple (a // b, a % b).', 'math'),
  builtin('sum', 'sum(iterable, start=0)', 'Sum of items in iterable, plus start value.', 'math'),
  builtin('min', 'min(iterable, *args, key=None)', 'Return the smallest item in an iterable or arguments.', 'math'),
  builtin('max', 'max(iterable, *args, key=None)', 'Return the largest item in an iterable or arguments.', 'math'),

  // Sequence functions
  builtin('len', 'len(s)', 'Return the number of items in a container.', 'sequence', { returns: 'int' }),
  builtin('sorted', 'sorted(iterable, key=None, reverse=False)', 'Return a new sorted list from the items in iterable.', 'sequence'),
  builtin('reversed', 'reversed(seq)', 'Return a reverse iterator over the sequence.', 'sequence'),
  builtin('enumerate', 'enumerate(iterable, start=0)', 'Return an enumerate object yielding (index, value) pairs.', 'sequence'),
  builtin('zip', 'zip(*iterables)', 'Iterate over multiple iterables in parallel.', 'sequence'),
  builtin('range', 'range(start, stop, step=1)', 'Return a sequence of numbers from start to stop.', 'sequence'),
  builtin('filter', 'filter(function, iterable)', 'Return elements of iterable for which function returns true.', 'sequence'),
  builtin('map', 'map(function, iterable)', 'Apply function to every item of iterable.', 'sequence'),
  builtin('slice', 'slice(start, stop, step=None)', 'Create a slice object for extended indexing.', 'sequence'),

  // Logic functions
  builtin('all', 'all(iterable)', 'Return True if all elements of the iterable are true.', 'logic'),
  builtin('any', 'any(iterable)', 'Return True if any element of the iterable is true.', 'logic'),
  builtin('isinstance', 'isinstance(object, classinfo)', 'Return True if object is an instance of classinfo.', 'logic'),

  // Type inspection
  builtin('type', 'type(object)', 'Return the type of an object.', 'type'),
  builtin('hasattr', 'hasattr(object, name)', 'Return True if object has the named attribute.', 'type'),
  builtin('getattr', 'getattr(object, name, default=None)', 'Return the value of the named attribute of object.', 'type'),
  builtin('callable', 'callable(object)', 'Return True if the object appears callable.', 'type'),

  // String functions
  builtin('chr', 'chr(i)', 'Return the string of one character whose Unicode code point is i.', 'string'),
  builtin('ord', 'ord(c)', 'Return the Unicode code point for a one-character string.', 'string'),
  builtin('repr', 'repr(object)', 'Return a string containing a printable representation.', 'string'),
  builtin('ascii', 'ascii(object)', 'Return a string with non-ASCII characters escaped.', 'string'),
  builtin('format', 'format(value, format_spec)', 'Convert a value to a formatted representation.', 'string'),
  builtin('bin', 'bin(x)', 'Convert an integer to a binary string prefixed with "0b".', 'string'),
  builtin('hex', 'hex(x)', 'Convert an integer to a lowercase hexadecimal string.', 'string'),
  builtin('oct', 'oct(x)', 'Convert an integer to an octal string prefixed with "0o".', 'string'),

  // I/O - mostly blocked for security
  builtin('print', String.raw`print(*objects, sep=" ", end="\n")`, 'Print objects to the text stream.', 'io'),
  builtin('input', 'input(prompt)', 'Read a line from input.', 'io'),
  builtin('open', 'open(file, mode="r")', 'Open a file and return a file object.', 'io'),

  // Other useful functions
  builtin('id', 'id(object)', 'Return the identity of an object.', 'other'),
  builtin('hash', 'hash(object)', 'Return the hash value of the object.', 'other'),
  builtin('iter', 'iter(object)', 'Return an iterator object.', 'other'),
  builtin('next', 'next(iterator, default)', 'Retrieve the next item from the iterator.', 'other'),
  builtin('vars', 'vars(object)', 'Return the __dict__ attribute of an object.', 'other'),
  builtin('dir', 'dir(object)', 'Return list of names in the current local scope or object attributes.', 'other'),
  builtin('eval', 'eval(expression)', 'Evaluate a Python expression string.', 'other'),
  builtin('exec', 'exec(code)', 'Execute Python code dynamically.', 'other'),
]
