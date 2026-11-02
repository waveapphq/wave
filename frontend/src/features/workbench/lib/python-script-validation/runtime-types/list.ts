import { runtimeMethodTable, type RuntimeMethodTable } from '../runtime-method-table'

/** Callable members of list on Python 3.8 to 3.14, plus those of None, which a null value arrives as. */
export const LIST_METHODS: RuntimeMethodTable = runtimeMethodTable([
  ['__add__', [1, 1]],
  ['__class_getitem__', null],
  ['__contains__', [1, 1]],
  ['__delitem__', [1, 1]],
  ['__getitem__', null],
  ['__iadd__', [1, 1]],
  ['__imul__', [1, 1]],
  ['__iter__', [0, 0]],
  ['__len__', [0, 0]],
  ['__mul__', [1, 1]],
  ['__reversed__', [0, 0]],
  ['__rmul__', [1, 1]],
  ['__setitem__', [2, 2]],
  ['append', [1, 1]],
  ['clear', [0, 0]],
  ['copy', [0, 0]],
  ['count', [1, 1]],
  ['extend', [1, 1]],
  ['index', [1, 3]],
  ['insert', [2, 2]],
  ['pop', [0, 1]],
  ['remove', [1, 1]],
  ['reverse', [0, 0]],
  ['sort', [0, 2]],
])
