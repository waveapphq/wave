/**
 * Binary operator operand types Python always rejects with TypeError (PYRUN-13).
 *
 * REQ-3.4.1.2: Python script execution
 */

export type OperandKind =
  | 'int'
  | 'bool'
  | 'float'
  | 'complex'
  | 'Decimal'
  | 'str'
  | 'bytes'
  | 'NoneType'
  | 'list'
  | 'tuple'
  | 'dict'
  | 'set'
  | 'table'

type AcceptedOperands = Partial<Record<OperandKind, readonly OperandKind[]>>

/** Per operator, the right operand kinds each left kind can succeed with on some Python from 3.8 to 3.14. */
const ACCEPTED: ReadonlyMap<string, AcceptedOperands> = new Map<string, AcceptedOperands>([
  ['+', {
    int: ['int', 'bool', 'float', 'complex', 'Decimal'],
    bool: ['int', 'bool', 'float', 'complex', 'Decimal'],
    float: ['int', 'bool', 'float', 'complex'],
    complex: ['int', 'bool', 'float', 'complex'],
    Decimal: ['int', 'bool', 'Decimal'],
    str: ['str'],
    bytes: ['bytes'],
    list: ['list'],
    tuple: ['tuple'],
  }],
  ['-', {
    int: ['int', 'bool', 'float', 'complex', 'Decimal'],
    bool: ['int', 'bool', 'float', 'complex', 'Decimal'],
    float: ['int', 'bool', 'float', 'complex'],
    complex: ['int', 'bool', 'float', 'complex'],
    Decimal: ['int', 'bool', 'Decimal'],
    set: ['set'],
  }],
  ['*', {
    int: ['int', 'bool', 'float', 'complex', 'Decimal', 'str', 'bytes', 'list', 'tuple'],
    bool: ['int', 'bool', 'float', 'complex', 'Decimal', 'str', 'bytes', 'list', 'tuple'],
    float: ['int', 'bool', 'float', 'complex'],
    complex: ['int', 'bool', 'float', 'complex'],
    Decimal: ['int', 'bool', 'Decimal'],
    str: ['int', 'bool'],
    bytes: ['int', 'bool'],
    list: ['int', 'bool'],
    tuple: ['int', 'bool'],
  }],
  ['/', {
    int: ['int', 'bool', 'float', 'complex', 'Decimal'],
    bool: ['int', 'bool', 'float', 'complex', 'Decimal'],
    float: ['int', 'bool', 'float', 'complex'],
    complex: ['int', 'bool', 'float', 'complex'],
    Decimal: ['int', 'bool', 'Decimal'],
  }],
  ['//', {
    int: ['int', 'bool', 'float', 'Decimal'],
    bool: ['int', 'bool', 'float', 'Decimal'],
    float: ['int', 'bool', 'float'],
    Decimal: ['int', 'bool', 'Decimal'],
  }],
  ['%', {
    int: ['int', 'bool', 'float', 'Decimal'],
    bool: ['int', 'bool', 'float', 'Decimal'],
    float: ['int', 'bool', 'float'],
    Decimal: ['int', 'bool', 'Decimal'],
    str: ['int', 'bool', 'float', 'complex', 'Decimal', 'str', 'bytes', 'NoneType', 'list', 'tuple', 'dict', 'set', 'table'],
    bytes: ['int', 'bool', 'float', 'complex', 'Decimal', 'str', 'bytes', 'NoneType', 'list', 'tuple', 'dict', 'set', 'table'],
  }],
  ['**', {
    int: ['int', 'bool', 'float', 'complex', 'Decimal'],
    bool: ['int', 'bool', 'float', 'complex', 'Decimal'],
    float: ['int', 'bool', 'float', 'complex'],
    complex: ['int', 'bool', 'float', 'complex'],
    Decimal: ['int', 'bool', 'Decimal'],
  }],
  ['@', {}],
  ['<<', {
    int: ['int', 'bool'],
    bool: ['int', 'bool'],
  }],
  ['>>', {
    int: ['int', 'bool'],
    bool: ['int', 'bool'],
  }],
  ['&', {
    int: ['int', 'bool'],
    bool: ['int', 'bool'],
    set: ['set'],
  }],
  ['|', {
    int: ['int', 'bool'],
    bool: ['int', 'bool'],
    dict: ['dict'],
    set: ['set'],
  }],
  ['^', {
    int: ['int', 'bool'],
    bool: ['int', 'bool'],
    set: ['set'],
  }],
])

export function alwaysRaisesTypeError(operator: string, left: OperandKind, right: OperandKind): boolean {
  const accepted = ACCEPTED.get(operator)
  if (!accepted) return false
  return !(accepted[left] ?? []).includes(right)
}
