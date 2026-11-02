/**
 * Tests for the shared design-time table-schema validators. One validator family
 * backs BOTH the Visual and the Code view of the inspect-modal table editor so
 * Save gates identically: cell types + column-name rules mirror the backend
 * Table contract (REQ-3.5.5.1) and move the failure to design time.
 *
 *   - `validateTableValue(model)` - Visual view: a {headers, types, rows} model
 *     of string cells. Empty / duplicate column names AND per-cell type
 *     errors, returned as one structured result.
 *   - `validateTableCodeValue(value, schema)` - Code view: parsed JSON
 *     type-checked against the carried column schema via `valueMatchesType`.
 *     Structure (not a list of rows), column-shape drift (unexpected / missing
 *     key), and per-cell type errors.
 *   - `firstTableErrorMessage(result)` - the single strip line: the
 *     highest-priority problem (structure, then column, then cell row-major)
 *     plus a `(+N more)` count, or null when clean.
 *   - `deriveTableSchema(value)` - seeds the carried column schema (names +
 *     types) the host and body share, so an explicit Visual type survives a
 *     Visual -> Code -> Visual round trip instead of re-inferring.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'

import {
  validateTableValue,
  validateTableCodeValue,
  firstTableErrorMessage,
  tableErrorMessages,
  deriveTableSchema,
  tableSchemaFromCode,
  defaultCellText,
  validateTableCell,
  parseTableCell,
  inferTypeFromText,
  describeCellError,
  parseItemValue,
  arrayErrorMessages,
  mapEntryErrorMessages,
  overCapNumberLines,
  serializeTableForCode,
  parseTableCodeText,
  serializeArrayForCode,
  serializeMapForCode,
  parseArrayCode,
  parseMapCode,
  inferRuntimeType,
  validateVariableValue,
  hasVariableErrors,
  type ColumnType,
  type TableColumnSchema,
  type TableValidationResult,
} from '@/lib/variable-validation'
import { MAX_FLOAT_SIG_DIGITS, MAX_INTEGER_DIGITS } from '@/lib/number-rule'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface VisualModel {
  headers: string[]
  types: ColumnType[]
  rows: (string | null)[][]
}

function model(
  headers: string[],
  types: ColumnType[],
  rows: (string | null)[][],
): VisualModel {
  return { headers, types, rows }
}

const VALID_RESULT: TableValidationResult = {
  valid: true,
  structureError: null,
  columnErrors: [],
  cellErrors: [],
}

// ===========================================================================
// validateTableValue - Visual view (string-cell model)
// ===========================================================================

describe('validateTableValue - valid tables', () => {
  it('returns a clean result for well-formed names and cells', () => {
    expect(
      validateTableValue(
        model(['id', 'name'], ['integer', 'string'], [['1', 'alpha'], ['2', 'beta']]),
      ),
    ).toEqual(VALID_RESULT)
  })

  it('treats a zero-row table (schema only) as valid', () => {
    expect(validateTableValue(model(['id'], ['integer'], []))).toEqual(VALID_RESULT)
  })

  it('treats an empty string as valid for a string column', () => {
    expect(validateTableValue(model(['s'], ['string'], [['']]))).toEqual(VALID_RESULT)
  })

  it('flags an empty non-string cell (no value)', () => {
    const result = validateTableValue(
      model(['i', 'f', 'b'], ['integer', 'float', 'boolean'], [['', '', '']]),
    )
    expect(result.valid).toBe(false)
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'i', expected: 'integer' },
      { row: 0, column: 'f', expected: 'float' },
      { row: 0, column: 'b', expected: 'boolean' },
    ])
  })

  it('treats an explicit null as valid for every column type', () => {
    expect(
      validateTableValue(
        model(
          ['s', 'i', 'f', 'b'],
          ['string', 'integer', 'float', 'boolean'],
          [[null, null, null, null]],
        ),
      ),
    ).toEqual(VALID_RESULT)
  })

  it('never errors on a string cell whatever it contains', () => {
    const result = validateTableValue(
      model(['note'], ['string'], [['true'], ['3.14'], ['{ }']]),
    )
    expect(result).toEqual(VALID_RESULT)
  })
})

describe('validateTableValue - column-name rules', () => {
  it('flags an empty column name by 1-based position', () => {
    const result = validateTableValue(model(['id', ''], ['integer', 'string'], []))
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toEqual([{ kind: 'empty', position: 2 }])
  })

  it('treats a whitespace-only column name as empty (compared on the trimmed name)', () => {
    const result = validateTableValue(model(['   '], ['string'], []))
    expect(result.columnErrors).toEqual([{ kind: 'empty', position: 1 }])
  })

  it('flags BOTH columns that share a duplicated name', () => {
    const result = validateTableValue(
      model(['id', 'id'], ['integer', 'string'], []),
    )
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toEqual([
      { kind: 'duplicate', name: 'id' },
      { kind: 'duplicate', name: 'id' },
    ])
  })

  it('compares duplicate names case-sensitively (ID != id)', () => {
    expect(
      validateTableValue(model(['ID', 'id'], ['string', 'string'], [])).valid,
    ).toBe(true)
  })

  it('compares duplicate names on the trimmed value (" id " duplicates "id")', () => {
    const result = validateTableValue(model(['id', ' id '], ['string', 'string'], []))
    expect(result.columnErrors).toEqual([
      { kind: 'duplicate', name: 'id' },
      { kind: 'duplicate', name: 'id' },
    ])
  })

  it('does not treat two empty names as duplicates (each is an empty-name error)', () => {
    const result = validateTableValue(model(['', ''], ['string', 'string'], []))
    expect(result.columnErrors).toEqual([
      { kind: 'empty', position: 1 },
      { kind: 'empty', position: 2 },
    ])
  })
})

describe('validateTableValue - cell-type rules', () => {
  it('flags a non-integer cell with its 0-based row and column name', () => {
    const result = validateTableValue(model(['id'], ['integer'], [['abc']]))
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'id', expected: 'integer' },
    ])
  })

  it('flags a non-float cell', () => {
    const result = validateTableValue(model(['rate'], ['float'], [['x']]))
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'rate', expected: 'float' },
    ])
  })

  it('flags a non-boolean cell', () => {
    const result = validateTableValue(model(['flag'], ['boolean'], [['maybe']]))
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'flag', expected: 'boolean' },
    ])
  })

  it('collects cell errors in row-major order', () => {
    const result = validateTableValue(
      model(['a', 'b'], ['integer', 'integer'], [['x', '1'], ['2', 'y']]),
    )
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'a', expected: 'integer' },
      { row: 1, column: 'b', expected: 'integer' },
    ])
  })
})

describe('validateTableValue - mixed problems', () => {
  it('lists column errors before cell errors and counts every problem', () => {
    const result = validateTableValue(
      model(['', 'id', 'id'], ['integer', 'integer', 'string'], [['x', '1', 'a']]),
    )
    // 1 empty + 2 duplicate columns + 1 bad integer cell = 4 problems
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toEqual([
      { kind: 'empty', position: 1 },
      { kind: 'duplicate', name: 'id' },
      { kind: 'duplicate', name: 'id' },
    ])
    expect(result.cellErrors).toEqual([
      { row: 0, column: '', expected: 'integer' },
    ])
  })
})

// ===========================================================================
// validateTableCodeValue - Code view (parsed JSON against the carried schema)
// ===========================================================================

const ID_SCHEMA: TableColumnSchema[] = [{ name: 'id', type: 'integer' }]

describe('validateTableCodeValue - structure', () => {
  it('accepts an array of row objects matching the schema', () => {
    expect(validateTableCodeValue([{ id: 1 }, { id: 2 }], ID_SCHEMA)).toEqual(
      VALID_RESULT,
    )
  })

  it('accepts an empty array (zero rows)', () => {
    expect(validateTableCodeValue([], ID_SCHEMA)).toEqual(VALID_RESULT)
  })

  it('rejects a value that is not an array', () => {
    const result = validateTableCodeValue({ id: 1 }, ID_SCHEMA)
    expect(result.valid).toBe(false)
    expect(result.structureError).toBe('Table must be a list of rows')
  })

  it('rejects an array containing a non-object member', () => {
    const result = validateTableCodeValue([{ id: 1 }, 2], ID_SCHEMA)
    expect(result.structureError).toBe('Table must be a list of rows')
  })

  it('rejects an array of arrays', () => {
    const result = validateTableCodeValue([[1], [2]], ID_SCHEMA)
    expect(result.structureError).toBe('Table must be a list of rows')
  })

  it('rejects the {columns, rows} dict (Code edits row objects, not the dict)', () => {
    const result = validateTableCodeValue(
      { columns: [{ name: 'id', type: 'integer' }], rows: [[1]] },
      ID_SCHEMA,
    )
    expect(result.structureError).toBe('Table must be a list of rows')
  })

  it('reports no column or cell errors alongside a structure error', () => {
    const result = validateTableCodeValue('nonsense', ID_SCHEMA)
    expect(result.columnErrors).toEqual([])
    expect(result.cellErrors).toEqual([])
  })
})

describe('validateTableCodeValue - column-shape drift', () => {
  const TWO_COL: TableColumnSchema[] = [
    { name: 'id', type: 'integer' },
    { name: 'name', type: 'string' },
  ]

  it('flags a key present in the data but not in the schema', () => {
    const result = validateTableCodeValue([{ id: 1, name: 'a', extra: 2 }], TWO_COL)
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toContainEqual({ kind: 'unexpected', name: 'extra' })
  })

  it('flags a schema column missing from a row', () => {
    const result = validateTableCodeValue([{ id: 1 }], TWO_COL)
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toContainEqual({ kind: 'missing', name: 'name' })
  })
})

describe('validateTableCodeValue - cell types via valueMatchesType', () => {
  it('flags a string in an integer column', () => {
    const result = validateTableCodeValue([{ id: 'notanint' }], ID_SCHEMA)
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'id', expected: 'integer' },
    ])
  })

  it('flags a non-integer JS number in an integer column', () => {
    const result = validateTableCodeValue([{ id: 1.5 }], ID_SCHEMA)
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'id', expected: 'integer' },
    ])
  })

  it('accepts a digit-string integer (carried exact past 2^53)', () => {
    expect(validateTableCodeValue([{ id: '1111111111111199999' }], ID_SCHEMA)).toEqual(
      VALID_RESULT,
    )
  })

  it('accepts a JS number and a plain-decimal string for a float column', () => {
    const schema: TableColumnSchema[] = [{ name: 'rate', type: 'float' }]
    expect(validateTableCodeValue([{ rate: 3.14 }], schema)).toEqual(VALID_RESULT)
    expect(validateTableCodeValue([{ rate: '2.5' }], schema)).toEqual(VALID_RESULT)
  })

  it('accepts a null cell for any column type (None allowed)', () => {
    expect(validateTableCodeValue([{ id: null }], ID_SCHEMA)).toEqual(VALID_RESULT)
  })

  it('keeps the explicit Visual column type authoritative (a "true" string stays a string)', () => {
    // The schema says `flag` is a string; the value is the string "true".
    // Re-inference would call it boolean and reject it - the carried schema
    // governs, so it validates.
    const schema: TableColumnSchema[] = [{ name: 'flag', type: 'string' }]
    expect(validateTableCodeValue([{ flag: 'true' }], schema)).toEqual(VALID_RESULT)
  })

  it('rejects a "true" string in a boolean column (mirror of the string-column case)', () => {
    const schema: TableColumnSchema[] = [{ name: 'flag', type: 'boolean' }]
    const result = validateTableCodeValue([{ flag: 'true' }], schema)
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'flag', expected: 'boolean' },
    ])
  })

  it('type-checks cells in row-major order across rows', () => {
    const result = validateTableCodeValue([{ id: 1 }, { id: 'x' }, { id: 'y' }], ID_SCHEMA)
    expect(result.cellErrors).toEqual([
      { row: 1, column: 'id', expected: 'integer' },
      { row: 2, column: 'id', expected: 'integer' },
    ])
  })
})

// ===========================================================================
// firstTableErrorMessage - the single strip line + count
// ===========================================================================

function resultWith(over: Partial<TableValidationResult>): TableValidationResult {
  return { valid: false, structureError: null, columnErrors: [], cellErrors: [], ...over }
}

describe('firstTableErrorMessage - single problem', () => {
  it('returns null for a clean result', () => {
    expect(firstTableErrorMessage(VALID_RESULT)).toBeNull()
  })

  it('renders the structure error', () => {
    expect(
      firstTableErrorMessage(resultWith({ structureError: 'Table must be a list of rows' })),
    ).toBe('Table must be a list of rows')
  })

  it('renders an empty-column message with the 1-based position', () => {
    expect(
      firstTableErrorMessage(resultWith({ columnErrors: [{ kind: 'empty', position: 1 }] })),
    ).toBe('Column 1 needs a name')
  })

  it('renders a duplicate-column message with the name', () => {
    expect(
      firstTableErrorMessage(resultWith({ columnErrors: [{ kind: 'duplicate', name: 'id' }] })),
    ).toBe('Duplicate column name "id"')
  })

  it('renders an unexpected-column message pointing to the Visual view', () => {
    expect(
      firstTableErrorMessage(
        resultWith({ columnErrors: [{ kind: 'unexpected', name: 'extra' }] }),
      ),
    ).toBe('Unexpected column "extra" - change columns in the Visual view')
  })

  it('renders a missing-column message pointing to the Visual view', () => {
    expect(
      firstTableErrorMessage(
        resultWith({ columnErrors: [{ kind: 'missing', name: 'name' }] }),
      ),
    ).toBe('Missing column "name" - change columns in the Visual view')
  })

  it('renders a cell message with the 0-based row, column name, and expected type', () => {
    expect(
      firstTableErrorMessage(
        resultWith({ cellErrors: [{ row: 0, column: 'id', expected: 'integer' }] }),
      ),
    ).toBe('Row 0 "id": expected integer')
  })
})

describe('firstTableErrorMessage - priority + count', () => {
  it('shows a column problem before a cell problem', () => {
    expect(
      firstTableErrorMessage(
        resultWith({
          columnErrors: [{ kind: 'duplicate', name: 'id' }],
          cellErrors: [{ row: 0, column: 'id', expected: 'integer' }],
        }),
      ),
    ).toBe('Duplicate column name "id" (+1 more)')
  })

  it('shows the first cell in row-major order when only cells are wrong', () => {
    expect(
      firstTableErrorMessage(
        resultWith({
          cellErrors: [
            { row: 0, column: 'a', expected: 'integer' },
            { row: 1, column: 'b', expected: 'integer' },
          ],
        }),
      ),
    ).toBe('Row 0 "a": expected integer (+1 more)')
  })

  it('counts every problem across both classes', () => {
    expect(
      firstTableErrorMessage(
        resultWith({
          columnErrors: [
            { kind: 'empty', position: 1 },
            { kind: 'duplicate', name: 'id' },
            { kind: 'duplicate', name: 'id' },
          ],
          cellErrors: [{ row: 0, column: '', expected: 'integer' }],
        }),
      ),
    ).toBe('Column 1 needs a name (+3 more)')
  })

  it('omits the count suffix for a single problem', () => {
    expect(
      firstTableErrorMessage(resultWith({ columnErrors: [{ kind: 'duplicate', name: 'id' }] })),
    ).toBe('Duplicate column name "id"')
  })
})

describe('firstTableErrorMessage - end to end with the validators', () => {
  it('matches the duplicate-rename scenario (both columns named id)', () => {
    const result = validateTableValue(model(['id', 'id'], ['integer', 'integer'], []))
    expect(firstTableErrorMessage(result)).toBe('Duplicate column name "id" (+1 more)')
  })

  it('surfaces a Code-view bad cell as the specific strip line', () => {
    const result = validateTableCodeValue([{ id: 'x' }], ID_SCHEMA)
    expect(firstTableErrorMessage(result)).toBe('Row 0 "id": expected integer')
  })

  it('surfaces a Code-view structure error', () => {
    const result = validateTableCodeValue('nope', ID_SCHEMA)
    expect(firstTableErrorMessage(result)).toBe('Table must be a list of rows')
  })
})

// ===========================================================================
// deriveTableSchema - the carried column schema (names + types)
// ===========================================================================

// ===========================================================================
// tableErrorMessages - the full ordered list behind the strip's "(+N more)"
// ===========================================================================

describe('tableErrorMessages', () => {
  it('returns an empty array for a clean result', () => {
    expect(tableErrorMessages(VALID_RESULT)).toEqual([])
  })

  it('lists column errors (column order) then cell errors (row-major)', () => {
    const result = validateTableValue(
      model(['', 'id', 'id'], ['integer', 'integer', 'string'], [['x', '1', 'a']]),
    )
    expect(tableErrorMessages(result)).toEqual([
      'Column 1 needs a name',
      'Duplicate column name "id"',
      'Duplicate column name "id"',
      'Row 0 "": expected integer',
    ])
  })

  it('returns the structure error alone when the value is not a list of rows', () => {
    expect(tableErrorMessages(validateTableCodeValue('nope', ID_SCHEMA))).toEqual([
      'Table must be a list of rows',
    ])
  })

  it('stays consistent with firstTableErrorMessage (first message + count)', () => {
    const result = validateTableCodeValue([{ id: 'x', extra: 1 }], ID_SCHEMA)
    const messages = tableErrorMessages(result)
    expect(messages).toEqual([
      'Unexpected column "extra" - change columns in the Visual view',
      'Row 0 "id": expected integer',
    ])
    expect(firstTableErrorMessage(result)).toBe(
      `${messages[0]} (+${messages.length - 1} more)`,
    )
  })
})

// ===========================================================================
// Editor cell model: value / empty-string / explicit null
// ===========================================================================

describe('defaultCellText', () => {
  it('returns the type default text, never null', () => {
    expect(defaultCellText('string')).toBe('')
    expect(defaultCellText('integer')).toBe('0')
    expect(defaultCellText('float')).toBe('0')
    expect(defaultCellText('boolean')).toBe('false')
  })
})

describe('validateTableCell', () => {
  it('treats explicit null as valid for every type', () => {
    expect(validateTableCell(null, 'string')).toBeNull()
    expect(validateTableCell(null, 'integer')).toBeNull()
    expect(validateTableCell(null, 'float')).toBeNull()
    expect(validateTableCell(null, 'boolean')).toBeNull()
  })

  it('treats an empty string as valid only for a string column', () => {
    expect(validateTableCell('', 'string')).toBeNull()
    expect(validateTableCell('', 'integer')).toBe('Must be an integer')
    expect(validateTableCell('', 'float')).toBe('Must be a number')
    expect(validateTableCell('', 'boolean')).toBe('Must be true or false')
  })

  it('checks a value against its column type', () => {
    expect(validateTableCell('5', 'integer')).toBeNull()
    expect(validateTableCell('abc', 'integer')).toBe('Must be an integer')
    expect(validateTableCell('3.14', 'float')).toBeNull()
    expect(validateTableCell('x', 'float')).toBe('Must be a number')
    expect(validateTableCell('true', 'boolean')).toBeNull()
    expect(validateTableCell('maybe', 'boolean')).toBe('Must be true or false')
    expect(validateTableCell('anything goes', 'string')).toBeNull()
  })
})

describe('parseTableCell', () => {
  it('keeps explicit null as null', () => {
    expect(parseTableCell(null, 'integer')).toBeNull()
  })

  it('keeps integers and floats as exact digit-strings (precision past 2^53 / double)', () => {
    expect(parseTableCell('7', 'integer')).toBe('7')
    expect(parseTableCell('12345678901234567890', 'integer')).toBe('12345678901234567890')
    expect(parseTableCell('2.5', 'float')).toBe('2.5')
    expect(parseTableCell('true', 'boolean')).toBe(true)
    expect(parseTableCell('false', 'boolean')).toBe(false)
    expect(parseTableCell('hi', 'string')).toBe('hi')
  })

  it('preserves invalid text instead of nulling it', () => {
    expect(parseTableCell('abc', 'integer')).toBe('abc')
    expect(parseTableCell('x', 'float')).toBe('x')
    expect(parseTableCell('maybe', 'boolean')).toBe('maybe')
  })
})

describe('Visual strip messages', () => {
  it('describeCellError gives the strip-style suffix or null', () => {
    expect(describeCellError('abc', 'integer')).toBe('expected integer')
    expect(describeCellError('1'.repeat(20), 'integer')).toBe('max 19 digits')
    expect(describeCellError('5', 'integer')).toBeNull()
  })

  it('arrayErrorMessages prefixes a bad item with its index', () => {
    expect(arrayErrorMessages(['ok', 'abc'], ['string', 'integer'])).toEqual([
      'Index 1: expected integer',
    ])
  })

  it('mapEntryErrorMessages: key value error, merged missing key, duplicate; skips empty row', () => {
    expect(
      mapEntryErrorMessages([
        { key: 'rate', value: 'abc', type: 'float' },
        { key: '', value: 'x', type: 'integer' },
        { key: 'a', value: '1', type: 'integer' },
        { key: 'a', value: '2', type: 'integer' },
        { key: '', value: '', type: 'string' },
      ]),
    ).toEqual([
      'Key "rate": expected float',
      'Element #1: key missing, expected integer',
      'Duplicate key "a"',
    ])
  })
})

describe('inferTypeFromText', () => {
  it('infers boolean by shape and never a number type: digits stay a string (REQ-3.1.3.19)', () => {
    expect(inferTypeFromText('123')).toBe('string')
    expect(inferTypeFromText('-123')).toBe('string')
    expect(inferTypeFromText('1231231231231231231')).toBe('string')
    expect(inferTypeFromText('123.0000')).toBe('string')
    expect(inferTypeFromText('02134')).toBe('string')
    expect(inferTypeFromText('-0.5')).toBe('string')
    expect(inferTypeFromText('true')).toBe('boolean')
    expect(inferTypeFromText('FALSE')).toBe('boolean')
    expect(inferTypeFromText('abc')).toBe('string')
    expect(inferTypeFromText('')).toBe('string')
  })

  it('treats a partial / malformed number as a string too', () => {
    expect(inferTypeFromText('123.')).toBe('string')
    expect(inferTypeFromText('123.0.')).toBe('string')
    expect(inferTypeFromText('1e5')).toBe('string')
    expect(inferTypeFromText('  42  ')).toBe('string')
    expect(inferTypeFromText('  true  ')).toBe('boolean')
  })
})

describe('numeric size caps', () => {
  it('validateTableCell accepts up to the cap and flags over it', () => {
    expect(validateTableCell('1'.repeat(MAX_INTEGER_DIGITS), 'integer')).toBeNull()
    expect(validateTableCell(`-${'1'.repeat(MAX_INTEGER_DIGITS)}`, 'integer')).toBeNull()
    expect(validateTableCell('1'.repeat(MAX_INTEGER_DIGITS + 1), 'integer')).toBe(
      `Maximum ${MAX_INTEGER_DIGITS} digits`,
    )
    expect(validateTableCell(`0.${'1'.repeat(MAX_FLOAT_SIG_DIGITS)}`, 'float')).toBeNull()
    expect(validateTableCell(`0.${'1'.repeat(MAX_FLOAT_SIG_DIGITS + 1)}`, 'float')).toBe(
      `Maximum ${MAX_FLOAT_SIG_DIGITS} significant digits`,
    )
  })

  it('validateTableValue marks an over-cap integer cell with the integer-cap reason', () => {
    const result = validateTableValue({
      headers: ['id'],
      types: ['integer'],
      rows: [['1'.repeat(MAX_INTEGER_DIGITS + 1)]],
    })
    expect(result.cellErrors).toEqual([
      { row: 0, column: 'id', expected: 'integer', reason: 'integer-cap' },
    ])
    expect(tableErrorMessages(result)).toEqual([`Row 0 "id": max ${MAX_INTEGER_DIGITS} digits`])
  })

  it('validateTableCodeValue caps a digit-string integer and a long float', () => {
    const intResult = validateTableCodeValue([{ id: '1'.repeat(MAX_INTEGER_DIGITS + 1) }], [
      { name: 'id', type: 'integer' },
    ])
    expect(intResult.cellErrors).toEqual([
      { row: 0, column: 'id', expected: 'integer', reason: 'integer-cap' },
    ])
    const floatResult = validateTableCodeValue([{ r: `0.${'1'.repeat(MAX_FLOAT_SIG_DIGITS + 1)}` }], [
      { name: 'r', type: 'float' },
    ])
    expect(floatResult.cellErrors).toEqual([
      { row: 0, column: 'r', expected: 'float', reason: 'float-cap' },
    ])
    expect(tableErrorMessages(floatResult)).toEqual([
      `Row 0 "r": max ${MAX_FLOAT_SIG_DIGITS} significant digits`,
    ])
  })
})

describe('serializeTableForCode', () => {
  const schema: TableColumnSchema[] = [
    { name: 'id', type: 'integer' },
    { name: 'rate', type: 'float' },
    { name: 'label', type: 'string' },
  ]

  it('renders int/float cells as real JSON numbers and string cells quoted', () => {
    const text = serializeTableForCode([{ id: '7', rate: '111.2', label: 'hi' }], schema)
    expect(text).toBe('[\n  {\n    "id": 7,\n    "rate": 111.2,\n    "label": "hi"\n  }\n]')
    expect(JSON.parse(text)).toEqual([{ id: 7, rate: 111.2, label: 'hi' }])
  })

  it('renders precision cells (past JS number) as real number literals, never quoted', () => {
    const big = '1'.repeat(MAX_INTEGER_DIGITS)
    const text = serializeTableForCode(
      [{ id: big, rate: '-0.1231231231232131231231231231', label: '' }],
      schema,
    )
    expect(text).toContain(`"id": ${big}`)
    expect(text).toContain('"rate": -0.1231231231232131231231231231')
    expect(text).not.toContain(`"id": "${big}"`)
  })

  it('serializes an empty table as []', () => {
    expect(serializeTableForCode([], schema)).toBe('[]')
  })
})

describe('nested array / map value types', () => {
  it('inferTypeFromText commits to array / map from the opening bracket', () => {
    expect(inferTypeFromText('[1, 2]')).toBe('array')
    expect(inferTypeFromText('{"a": 1}')).toBe('map')
    // Invalid JSON stays array / map (so it is flagged), not demoted to string.
    expect(inferTypeFromText('[1, 2')).toBe('array')
    expect(inferTypeFromText('{"a": 1')).toBe('map')
    expect(inferTypeFromText('123')).toBe('string')
  })

  it('describeCellError validates array / map shape', () => {
    expect(describeCellError('[1, 2]', 'array')).toBeNull()
    expect(describeCellError('{"a": 1}', 'map')).toBeNull()
    expect(describeCellError('{"a": 1}', 'array')).toBe('expected array')
    expect(describeCellError('[1, 2]', 'map')).toBe('expected map')
    expect(describeCellError('[1, 2', 'array')).toBe('invalid JSON')
  })

  it('describeCellError flags a nested number that breaks the scalar caps', () => {
    expect(
      describeCellError('{"hi":123.123132132132132132131321321321321321313213213213219}', 'map'),
    ).toBe('nested float exceeds 28 significant digits')
    expect(describeCellError('[12345678901234567890]', 'array')).toBe(
      'nested integer exceeds 19 digits',
    )
    // Within the caps - no error.
    expect(describeCellError('{"a":{"b":1.5}}', 'map')).toBeNull()
    expect(describeCellError('[123, 1.25]', 'array')).toBeNull()
  })

  it('parseItemValue carries a nested value as verbatim text (no rounding), scalar via the cell rules', () => {
    expect(parseItemValue('[1, 2]', 'array')).toBe('[1, 2]')
    expect(parseItemValue('{"a": 1}', 'map')).toBe('{"a": 1}')
    // A high-precision nested float is kept verbatim, never normalized / rounded.
    expect(parseItemValue('{"hi":123.00000000000000000000002}', 'map')).toBe(
      '{"hi":123.00000000000000000000002}',
    )
    expect(parseItemValue('[bad', 'array')).toBe('[bad') // raw text survives, stays flagged
    expect(parseItemValue('42', 'integer')).toBe('42')
  })

  it('array Code round-trips a nested array item (scalar precision kept)', () => {
    const { items, types } = parseArrayCode('[ 12345678901234567890, [1, 2] ]')
    expect(types).toEqual(['integer', 'array'])
    expect(items[0]).toBe('12345678901234567890') // top-level scalar exact
    expect(items[1]).toBe('[1, 2]') // nested carried as text
    expect(serializeArrayForCode(items, types)).toBe('[\n  12345678901234567890,\n  [1, 2]\n]')
  })

  it('map Code round-trips a nested map value', () => {
    const { value, types } = parseMapCode('{ "outer": {"a": 1} }')
    expect(types).toEqual({ outer: 'map' })
    expect(value).toEqual({ outer: '{"a": 1}' })
    expect(serializeMapForCode(value, types)).toBe('{\n  "outer": {"a": 1}\n}')
  })

  it('overCapNumberLines points at the offending number line, not the slot start', () => {
    const text =
      '[\n  {"test":3.146546549879800000000000069},\n  [1,2,\n    3\n    ,4,\n    [1.3333330333333333333333333999]]\n]'
    const lines = overCapNumberLines(text)
    expect(lines.get(0)).toBeUndefined() // 28 sig digits, within cap
    expect(lines.get(1)).toBe(6) // the 29-digit float deep in element 1
  })

  it('overCapNumberLines attributes a nested map value to its top-level key', () => {
    const text = '{\n  "a": 1,\n  "b": {"deep": 1.2345678901234567890123456789}\n}'
    expect(overCapNumberLines(text).get('b')).toBe(3)
  })

  it('parseArrayCode keeps a nested float exact, so the cap check still sees it', () => {
    const big = '[ {"hi": 3.14654654987986000000000000000000004} ]'
    const { items, types } = parseArrayCode(big)
    expect(types).toEqual(['map'])
    // verbatim - NOT narrowed to a JS double (which would round to ~16 digits)
    expect(items[0]).toBe('{"hi": 3.14654654987986000000000000000000004}')
    expect(describeCellError(items[0] as string, 'map')).toBe(
      'nested float exceeds 28 significant digits',
    )
  })
})

describe('inferRuntimeType', () => {
  it('maps a plain-parsed value to its runtime type; a list/object is array/map', () => {
    expect(inferRuntimeType(123)).toBe('integer')
    expect(inferRuntimeType(1.5)).toBe('float')
    expect(inferRuntimeType(true)).toBe('boolean')
    expect(inferRuntimeType('abc')).toBe('string')
    expect(inferRuntimeType(null)).toBe('string')
    expect(inferRuntimeType([1, 2])).toBe('array')
    expect(inferRuntimeType({ a: 1 })).toBe('map')
  })
})

describe('array / map Code serialize + parse', () => {
  it('serializes array items as real numbers / quoted / boolean by type', () => {
    expect(serializeArrayForCode(['123', 'abc', true], ['integer', 'string', 'boolean'])).toBe(
      '[\n  123,\n  "abc",\n  true\n]',
    )
    expect(serializeArrayForCode([], [])).toBe('[]')
  })

  it('serializes map values by per-key type', () => {
    expect(
      serializeMapForCode({ a: '123', b: 'abc' }, { a: 'integer', b: 'string' }),
    ).toBe('{\n  "a": 123,\n  "b": "abc"\n}')
    expect(serializeMapForCode({}, {})).toBe('{}')
  })

  it('parses an array keeping exact numeric text + inferring types; a null item stays null (REQ-3.1.3.19)', () => {
    expect(parseArrayCode('[1231231231231231231, -0.1231231231232131231231231231, "abc", true, null]')).toEqual({
      items: ['1231231231231231231', '-0.1231231231232131231231231231', 'abc', true, null],
      types: ['integer', 'float', 'string', 'boolean', 'string'],
      exprIndices: [],
    })
  })

  it('reads a bare {{ }} item as an expression item holding its raw text, where the list takes {x}', () => {
    expect(parseArrayCode('["a", {{ x + 1 }}, 2, {{}}]', true)).toEqual({
      items: ['a', 'x + 1', '2', ''],
      types: ['string', 'string', 'integer', 'string'],
      exprIndices: [1, 3],
    })
  })

  it('refuses a bare {{ }} item as bad JSON where the list takes no {x}', () => {
    expect(() => parseArrayCode('["a", {{ x }}]')).toThrow(SyntaxError)
  })

  it('round-trips a list with {x} items through serialize -> parse', () => {
    const text = serializeArrayForCode(['a', 'n + 1'], ['string', 'integer'], 'pretty', new Set([1]))
    expect(text).toBe('[\n  "a",\n  {{ n + 1 }}\n]')
    expect(parseArrayCode(text, true)).toEqual({ items: ['a', 'n + 1'], types: ['string', 'string'], exprIndices: [1] })
  })

  it('parses a map keeping exact numeric text + per-key types', () => {
    expect(parseMapCode('{"id": 1231231231231231231, "name": "x"}')).toEqual({
      value: { id: '1231231231231231231', name: 'x' },
      types: { id: 'integer', name: 'string' },
      exprKeys: [],
    })
  })

  it('round-trips a precision array through parse -> serialize', () => {
    const text = '[\n  1231231231231231231,\n  -0.1231231231232131231231231231,\n  "abc",\n  true\n]'
    const { items, types } = parseArrayCode(text)
    expect(serializeArrayForCode(items, types)).toBe(text)
  })
})

describe('parseTableCodeText', () => {
  it('keeps each numeric literal as its exact source text (never a rounded JS float)', () => {
    const text =
      '[{"id":1231231231231231231,"rate":-0.1231231231232131231231231231,"s":"yoyoy"}]'
    expect(parseTableCodeText(text)).toEqual([
      { id: '1231231231231231231', rate: '-0.1231231231232131231231231231', s: 'yoyoy' },
    ])
  })

  it('keeps a quoted string value as the string (the user may still type quotes)', () => {
    expect(parseTableCodeText('[{"id":"123"}]')).toEqual([{ id: '123' }])
  })

  it('round-trips a precision table through serialize -> parse without rounding', () => {
    const value = [{ id: '1234567890123456789', rate: '-0.1231231231232131231231231231' }]
    const text = serializeTableForCode(value, [
      { name: 'id', type: 'integer' },
      { name: 'rate', type: 'float' },
    ])
    expect(parseTableCodeText(text)).toEqual(value)
  })
})

describe('deriveTableSchema', () => {
  it('infers column types from the first row of a row-object array', () => {
    expect(deriveTableSchema([{ id: 1, name: 'alpha' }])).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'string' },
    ])
  })

  it('preserves explicit column types from a {columns, rows} dict', () => {
    // `flag` is declared a string even though its value "true" would infer boolean.
    expect(
      deriveTableSchema({
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'flag', type: 'string' },
        ],
        rows: [[1, 'true']],
      }),
    ).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'flag', type: 'string' },
    ])
  })

  it('infers a dict column type when none is declared', () => {
    expect(deriveTableSchema({ columns: [{ name: 'n' }], rows: [[3.5]] })).toEqual([
      { name: 'n', type: 'float' },
    ])
  })

  it('returns an empty schema for an empty array', () => {
    expect(deriveTableSchema([])).toEqual([])
  })

  it('returns an empty schema for a non-table value', () => {
    expect(deriveTableSchema('garbage')).toEqual([])
    expect(deriveTableSchema(null)).toEqual([])
  })
})

// The suite / regression / system editors accept a table the "Edit value" window saved with its column types (REQ-3.5.5.1).
describe('validateVariableValue - a table stored with column types', () => {
  const TYPED_TABLE = {
    columns: [
      { name: 'zip', type: 'string' },
      { name: 'n', type: 'integer' },
    ],
    rows: [['02134', '7']],
  }

  it('accepts the stored typed form', () => {
    expect(validateVariableValue('table', TYPED_TABLE)).toBeNull()
  })

  it('accepts the stored typed form written as JSON text', () => {
    expect(validateVariableValue('table', JSON.stringify(TYPED_TABLE))).toBeNull()
  })

  it('accepts a typed table with no rows', () => {
    expect(validateVariableValue('table', { columns: TYPED_TABLE.columns, rows: [] })).toBeNull()
  })

  it('still accepts a plain list of rows', () => {
    expect(validateVariableValue('table', [{ id: 1 }])).toBeNull()
    expect(validateVariableValue('table', '[{"id": 1}]')).toBeNull()
    expect(validateVariableValue('table', [])).toBeNull()
    expect(validateVariableValue('table', '[]')).toBeNull()
  })

  it.each([
    ['an object that is no table', { a: 1 }],
    ['object text that is no table', '{"a": 1}'],
    ['columns with no rows list', { columns: TYPED_TABLE.columns }],
    ['rows with no columns list', { rows: [['02134']] }],
    ['columns that are not a list', { columns: 'zip', rows: [] }],
    ['typed text with columns that are not a list', '{"columns": "zip", "rows": []}'],
    ['a text value', '"hello"'],
    ['a number', '42'],
  ])('still refuses %s with "Must be a JSON array of objects"', (_label, value) => {
    expect(validateVariableValue('table', value)).toBe('Must be a JSON array of objects')
  })

  it('lets an editor save a row holding a typed table', () => {
    expect(
      hasVariableErrors([{ id: '1', name: 'zips', type: 'table', secret: false, value: TYPED_TABLE as never }]),
    ).toBe(false)
  })
})

// The window's table text: rows typed into a table with no columns define them by their JSON tokens (REQ-3.5.5.1).
describe('tableSchemaFromCode - columns from the first typed row', () => {
  it('types each column by the token of its first-row cell', () => {
    expect(tableSchemaFromCode('[{"zip": "02134", "n": 7, "rate": 1.50, "ok": false, "note": null}]')).toEqual([
      { name: 'zip', type: 'string' },
      { name: 'n', type: 'integer' },
      { name: 'rate', type: 'float' },
      { name: 'ok', type: 'boolean' },
      { name: 'note', type: 'string' },
    ])
  })

  it('reads the first row only', () => {
    expect(tableSchemaFromCode('[{"a": 1}, {"b": "x"}]')).toEqual([{ name: 'a', type: 'integer' }])
  })

  it.each([
    ['an empty list', '[]'],
    ['a list of numbers', '[1, 2]'],
    ['a list of lists', '[[1]]'],
    ['an object', '{"a": 1}'],
    ['null', 'null'],
  ])('defines no columns for %s', (_label, text) => {
    expect(tableSchemaFromCode(text)).toEqual([])
  })
})
