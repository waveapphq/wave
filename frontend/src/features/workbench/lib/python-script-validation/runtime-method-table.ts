/** Argument counts a call accepts, max -1 for no upper bound; null when no signature fixes them. */
export type ArgCountRange = readonly [number, number] | null

/** Every callable member of a Python type, by name. */
export type RuntimeMethodTable = ReadonlyMap<string, ArgCountRange>

/** One callable member: its name and the argument counts it accepts. */
export type RuntimeMethodEntry = readonly [string, ArgCountRange]

/** The members every runtime type carries; a type file overrides one by listing the name again. */
const SHARED_MEMBERS: readonly RuntimeMethodEntry[] = [
  ['__bool__', [0, 0]],
  ['__class__', null],
  ['__delattr__', [1, 1]],
  ['__dir__', [0, 0]],
  ['__eq__', [1, 1]],
  ['__format__', [1, 1]],
  ['__ge__', [1, 1]],
  ['__getattribute__', [1, 1]],
  ['__getstate__', [0, 0]],
  ['__gt__', [1, 1]],
  ['__hash__', [0, 0]],
  ['__init__', [0, -1]],
  ['__init_subclass__', null],
  ['__le__', [1, 1]],
  ['__lt__', [1, 1]],
  ['__ne__', [1, 1]],
  ['__new__', [0, -1]],
  ['__reduce__', [0, 0]],
  ['__reduce_ex__', [1, 1]],
  ['__repr__', [0, 0]],
  ['__setattr__', [2, 2]],
  ['__sizeof__', [0, 0]],
  ['__str__', [0, 0]],
  ['__subclasshook__', null],
]

/** The shared members with the type's own applied on top. */
export function runtimeMethodTable(own: readonly RuntimeMethodEntry[]): RuntimeMethodTable {
  const table = new Map<string, ArgCountRange>(SHARED_MEMBERS)
  for (const [name, argCounts] of own) table.set(name, argCounts)
  return table
}
