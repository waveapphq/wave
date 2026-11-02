import { runtimeMethodTable, type RuntimeMethodTable } from '../runtime-method-table'

/** Callable members of the bridge's table object on Python 3.8 to 3.14, plus those of None, which a null value arrives as. */
export const TABLE_METHODS: RuntimeMethodTable = runtimeMethodTable([
  ['__getitem__', [1, 1]],
  ['__iter__', [0, 0]],
  ['__len__', [0, 0]],
  ['_envelope', [0, 0]],
  ['_row', [1, 1]],
])
