import { runtimeMethodTable, type RuntimeMethodTable } from '../runtime-method-table'

/** Callable members of dict on Python 3.8 to 3.14, plus those of None, which a null value arrives as. */
export const DICT_METHODS: RuntimeMethodTable = runtimeMethodTable([
  ['__class_getitem__', null],
  ['__contains__', [1, 1]],
  ['__delitem__', [1, 1]],
  ['__getitem__', null],
  ['__ior__', [1, 1]],
  ['__iter__', [0, 0]],
  ['__len__', [0, 0]],
  ['__or__', [1, 1]],
  ['__reversed__', [0, 0]],
  ['__ror__', [1, 1]],
  ['__setitem__', [2, 2]],
  ['__sizeof__', null],
  ['clear', [0, 0]],
  ['copy', [0, 0]],
  ['fromkeys', [1, 2]],
  ['get', [1, 2]],
  ['items', [0, 0]],
  ['keys', [0, 0]],
  ['pop', [1, 2]],
  ['popitem', [0, 0]],
  ['setdefault', [1, 2]],
  ['update', [0, -1]],
  ['values', [0, 0]],
])
