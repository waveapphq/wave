/**
 * Tests for per-type inspect-watcher geometry (REQ-3.1.3.14).
 *
 * Compact scalars have separate
 * per-type groups (boolean / integer / float) so the float watcher can be
 * sized to fit its full 28-significant-digit value (+ sign + dot) un-truncated
 * in Initial / Current AND, roughly doubled, in Compare. All three groups stay
 * fixed-size (non-resizable).
 *
 * The exact pixel widths are set empirically from captures (the
 * watcher has no layout engine in a unit test), so these tests assert the
 * RELATIONSHIPS the design guarantees, not absolute pixels: the float watcher
 * is wider than the integer/boolean watchers, Compare is wider than single, and
 * every compact scalar stays fixed-size.
 */

import { describe, it, expect } from 'vitest'

import {
  SCRIPT_VALUE_EDITOR_SIZE,
  SQL_VALUE_EDITOR_SIZE,
  cascadeOffset,
  getCreateSheetWidth,
  getSheetSize,
  getValueEditorSheetSize,
  isCompactScalarWatcher,
} from '@/features/workbench/common/variables/variable-inspect-modal/sheet-sizes'

describe('getSheetSize - per-type compact widths', () => {
  it('sizes the float single watcher wider than the integer watcher', () => {
    const float = getSheetSize('float', false, 'initial')
    const integer = getSheetSize('integer', false, 'initial')
    expect(float.width).toBeGreaterThan(integer.width)
  })

  it('sizes the float single watcher wider than the boolean watcher', () => {
    const float = getSheetSize('float', false, 'initial')
    const boolean = getSheetSize('boolean', false, 'initial')
    expect(float.width).toBeGreaterThan(boolean.width)
  })

  it('sizes the float Compare watcher wider than its single watcher (two panes)', () => {
    const single = getSheetSize('float', false, 'current')
    const compare = getSheetSize('float', false, 'compare')
    expect(compare.width).toBeGreaterThan(single.width)
  })

  it('sizes the float Compare watcher wider than the integer Compare watcher', () => {
    const float = getSheetSize('float', false, 'compare')
    const integer = getSheetSize('integer', false, 'compare')
    expect(float.width).toBeGreaterThan(integer.width)
  })

  it('opens the float watcher at its default width (grow-only floor: min === default)', () => {
    const single = getSheetSize('float', false, 'initial')
    expect(single.minWidth).toBe(single.width)
  })
})

// VMGR-91: the "Edit value" string sheet footer (Kind + Format + Format
// button + Cancel + Save) overflows when the sheet is sized down to its minimum,
// pushing Save outside the sheet. The string min width must clear the footer.
// Exact px are tuned from captures; the test asserts the footer-fit
// FLOOR the design guarantees, not an absolute pixel.
const FOOTER_FIT_MIN_WIDTH = 440

describe('getValueEditorSheetSize - string footer fit (VMGR-91)', () => {
  it('sizes the string min width to clear the full footer', () => {
    expect(getValueEditorSheetSize('string').minWidth).toBeGreaterThanOrEqual(
      FOOTER_FIT_MIN_WIDTH,
    )
  })

  it('opens the string sheet at or above its footer-fit minimum', () => {
    const size = getValueEditorSheetSize('string')
    expect(size.width).toBeGreaterThanOrEqual(size.minWidth)
  })
})

describe('getValueEditorSheetSize - Python and scaffolded-map geometry', () => {
  it('opens a Python body wider than a plain string value (PYRUN-13)', () => {
    const python = getValueEditorSheetSize('string', 'python')
    expect(python.width).toBeGreaterThan(getValueEditorSheetSize('string').width)
  })

  it('opens a Python body at the script editor size (PYRUN-13)', () => {
    expect(getValueEditorSheetSize('string', 'python')).toEqual({
      width: 720,
      height: 460,
      minWidth: 520,
      minHeight: 320,
    })
    expect(getValueEditorSheetSize('string', 'python')).toEqual(SCRIPT_VALUE_EDITOR_SIZE)
  })

  it('opens a scaffolded map editor taller than a plain map value', () => {
    const scaffolded = getValueEditorSheetSize('map', null, true)
    expect(scaffolded.height).toBeGreaterThan(getValueEditorSheetSize('map').height)
  })

  it('opens a scaffolded Python body as a code editor', () => {
    expect(getValueEditorSheetSize('string', 'python', true)).toEqual(
      getValueEditorSheetSize('string', 'python'),
    )
  })

  it('sizes a value with no script mode by its type', () => {
    expect(getValueEditorSheetSize('string', null)).toEqual(getValueEditorSheetSize('string'))
    expect(getValueEditorSheetSize('table', null)).toEqual(getValueEditorSheetSize('table'))
  })
})

// The SQL and OpenSearch footers hold Kind, Format, Help and the catalog chip, so their floor is wider (SQL-10, OS-12).
describe('getValueEditorSheetSize - the SQL and OpenSearch editors (SQL-10, OS-12)', () => {
  it.each([['sql' as const], ['dql' as const], ['query-dsl' as const], ['aggregation-json' as const]])(
    'opens the %s editor at 720 x 460 with a 720 minimum width',
    (mode) => {
      const size = getValueEditorSheetSize('string', mode)
      expect(size.width).toBe(720)
      expect(size.height).toBe(460)
      expect(size.minWidth).toBe(720)
      expect(size).toEqual(SQL_VALUE_EDITOR_SIZE)
    },
  )

  it('keeps the SQL editor size for a scaffolded body', () => {
    expect(getValueEditorSheetSize('string', 'dql', true)).toEqual(SQL_VALUE_EDITOR_SIZE)
  })

  it('keeps the script editor height and height floor for the SQL editor size', () => {
    expect(SQL_VALUE_EDITOR_SIZE).toEqual({ ...SCRIPT_VALUE_EDITOR_SIZE, minWidth: 720 })
  })
})

describe('isCompactScalarWatcher - scalars stack in compare and grow from a small default', () => {
  it('reports the float watcher as a compact scalar', () => {
    expect(isCompactScalarWatcher('float', false)).toBe(true)
  })

  it('reports the integer watcher as a compact scalar', () => {
    expect(isCompactScalarWatcher('integer', false)).toBe(true)
  })

  it('reports the boolean watcher as a compact scalar', () => {
    expect(isCompactScalarWatcher('boolean', false)).toBe(true)
  })
})

describe('getSheetSize - the watcher has no edit size (VMGR-106)', () => {
  it('takes the type, the expression flag and the view, and no editing flag', () => {
    expect(getSheetSize).toHaveLength(3)
  })

  it.each(['boolean', 'integer', 'float'] as const)(
    'opens the %s watcher at its one single size for Initial and Current',
    (type) => {
      expect(getSheetSize(type, false, 'current')).toEqual(getSheetSize(type, false, 'initial'))
    },
  )
})

describe('cascadeOffset - one cascade for watchers and windows (VMGR-15, VMGR-101)', () => {
  it.each([
    [0, 0],
    [1, 24],
    [2, 48],
    [7, 168],
    [8, 0],
    [9, 24],
    [17, 24],
  ])('offsets window %i by %ipx', (index, px) => {
    expect(cascadeOffset(index)).toBe(px)
  })
})

describe('getCreateSheetWidth - the window widths (VMGR-106, VMGR-98)', () => {
  it.each([
    ['variable', 410],
    ['input', 560],
    ['output', 560],
  ] as const)('opens the %s window %ipx wide', (mode, width) => {
    const size = getCreateSheetWidth(mode)
    expect(size.width).toBe(width)
    expect(size.minWidth).toBeLessThanOrEqual(width)
  })
})
