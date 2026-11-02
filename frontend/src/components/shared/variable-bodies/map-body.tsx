/**
 * MapBody - shared map Visual value body: a Key | Value table over the shared
 * ValueGrid (resizable columns). Keys get the SAME treatment as values - quoted
 * via formatCellText (a key like `2 d` reads `"2 d"`) and tinted by type - since
 * map keys are strings, that is the string color. First 500 entries.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import {
  declaredElementRenderType,
  formatCellText,
  formatDeclaredElementCell,
  getCellColorClass,
  inferRenderType,
} from '@/lib/variable-format'
import {
  ValueGrid,
  type ValueGridColumn,
  type ValueGridRow,
} from '@/components/shared/variable-bodies/value-grid'
import type { ComplexBodyProps } from '@/components/shared/variable-bodies/body-parts'

const COLUMNS: ValueGridColumn[] = [
  { key: 'key', header: 'Key', width: 160 },
  { key: 'value', header: 'Value', width: 240 },
]

function toEntries(value: unknown): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.entries(value)
}

/** Declared type of one key, when the value carries a key -> type record. */
function declaredOf(elementTypes: ComplexBodyProps['elementTypes'], key: string): unknown {
  return elementTypes !== undefined && !Array.isArray(elementTypes) ? elementTypes[key] : undefined
}

export function MapBody({ value, variant, elementTypes }: Readonly<ComplexBodyProps>) {
  const rows: ValueGridRow[] = toEntries(value).map(([key, entryValue]) => ({
    id: key,
    testId: 'map-row',
    cells: [
      {
        content: formatCellText(key),
        className: getCellColorClass(inferRenderType(key)),
        testId: 'map-key',
      },
      {
        content: formatDeclaredElementCell(entryValue, declaredOf(elementTypes, key)),
        className: getCellColorClass(
          declaredElementRenderType(entryValue, declaredOf(elementTypes, key)),
        ),
      },
    ],
  }))

  return (
    <ValueGrid
      data-testid="map-body"
      columns={COLUMNS}
      rows={rows}
      variant={variant}
      emptyLabel="no entries"
    />
  )
}
