/**
 * The Python type an Input Variable arrives as, per the bridge (PYRUN-5).
 *
 * REQ-3.4.1.2: Python script execution
 */

import type { RuntimeMethodTable } from './runtime-method-table'
import type { OperandKind } from './operator-rules'
import { STR_METHODS } from './runtime-types/str'
import { INT_METHODS } from './runtime-types/int'
import { DECIMAL_METHODS } from './runtime-types/decimal'
import { LIST_METHODS } from './runtime-types/list'
import { DICT_METHODS } from './runtime-types/dict'
import { TABLE_METHODS } from './runtime-types/table'

export interface InputRuntimeType {
  /** The type name the warnings show. */
  name: OperandKind
  methods: RuntimeMethodTable
}

const BY_WAVE_TYPE: ReadonlyMap<string, InputRuntimeType> = new Map([
  ['string', { name: 'str', methods: STR_METHODS }],
  ['integer', { name: 'int', methods: INT_METHODS }],
  ['float', { name: 'Decimal', methods: DECIMAL_METHODS }],
  ['boolean', { name: 'bool', methods: INT_METHODS }],
  ['array', { name: 'list', methods: LIST_METHODS }],
  ['map', { name: 'dict', methods: DICT_METHODS }],
  ['table', { name: 'table', methods: TABLE_METHODS }],
])

export function inputRuntimeType(waveType: string): InputRuntimeType | undefined {
  return BY_WAVE_TYPE.get(waveType)
}
