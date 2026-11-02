/**
 * ComplexValueBody - the shared array / map / table value body, authored in the
 * inline Visual editor (per-element widgets) or as raw JSON in the lazy Code
 * body. Driven entirely by useComplexValueEditor's bodyData (the host adds the
 * active `view` and the Format re-mount `formatKey`); used by both the create
 * modal and the inspect modal's edit state so the orchestration lives once.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 */

import { lazy, Suspense, type ReactNode } from 'react'

import { ArrayEditBody, type ArrayEditBodyProps } from '@/components/shared/variable-bodies/array-edit-body'
import type { ItemTextEditorProps } from '@/components/shared/variable-bodies/body-parts'
import { MapEditBody } from '@/components/shared/variable-bodies/map-edit-body'
import { TableEditBody } from '@/components/shared/variable-bodies/table-edit-body'
import { maskBareExpressionsForLint } from '@/lib/variable-validation'
import type { ComplexValueBodyData } from './use-complex-value-editor'

// Lazy raw-JSON editor (CodeMirror), shared with the read-only Code view.
const CodeBody = lazy(() =>
  import('@/components/shared/variable-bodies/code-body').then((module) => ({
    default: module.CodeBody,
  })),
)

/** What a host adds to the list editor, with the items held as {x} (array only). */
export type ListEditorSlots = Pick<
  ArrayEditBodyProps,
  | 'expressionEditor'
  | 'expressionIndices'
  | 'onExpressionIndicesChange'
  | 'renderItemInput'
  | 'positionLabel'
  | 'newItem'
>

export interface ComplexValueBodyProps extends ComplexValueBodyData {
  /** The active value view (host-owned). */
  view: 'visual' | 'code'
  /** Re-mounts the Code editor onto the freshly pretty-printed draft (Format). */
  formatKey: number
  listEditor?: ListEditorSlots
  /** The editor a text, List or Map item or map value opens from its expand. */
  textEditor?: (props: ItemTextEditorProps) => ReactNode
  /** The nested level of a list or map: 1 opened from the field. */
  level?: number
}

export function ComplexValueBody({
  type,
  value,
  view,
  formatKey,
  arrayTypes,
  mapTypes,
  tableSchema,
  tableWidths,
  mapEntry,
  onChange,
  onValidChange,
  onArrayChange,
  onMapChange,
  onTableSchemaChange,
  onTableWidthsChange,
  onTableValidation,
  onVisualErrors,
  onCodeChange,
  onCodeValidChange,
  serialize,
  stringValuesOnly,
  itemType,
  mapExprKeys,
  onMapExprKeysChange,
  listEditor,
  textEditor,
  level,
}: Readonly<ComplexValueBodyProps>) {
  if (view === 'code') {
    return (
      <Suspense fallback={<div className="h-full" />}>
        <CodeBody
          key={`complex-code-${type}-${formatKey}`}
          value={value}
          variant="current"
          editable
          serialize={serialize}
          onChange={onCodeChange}
          onValidChange={onCodeValidChange}
          jsonMask={
            stringValuesOnly ||
            mapEntry?.expressionEditor !== undefined ||
            listEditor?.expressionEditor !== undefined
              ? maskBareExpressionsForLint
              : undefined
          }
        />
      </Suspense>
    )
  }
  if (type === 'array') {
    return (
      <ArrayEditBody
        value={value as unknown[]}
        types={arrayTypes}
        onChange={onArrayChange}
        onValidChange={onValidChange}
        onValidation={onVisualErrors}
        stringValuesOnly={stringValuesOnly}
        itemType={itemType}
        textEditor={textEditor}
        level={level}
        {...listEditor}
      />
    )
  }
  if (type === 'map') {
    return (
      <MapEditBody
        value={value as Record<string, unknown>}
        types={mapTypes}
        onChange={onMapChange}
        onValidChange={onValidChange}
        onValidation={onVisualErrors}
        stringValuesOnly={stringValuesOnly}
        expressionEditor={mapEntry?.expressionEditor}
        expressionKeys={mapExprKeys}
        onExpressionKeysChange={onMapExprKeysChange}
        generatedRows={mapEntry?.generatedRows}
        quickInserts={mapEntry?.quickInserts}
        note={mapEntry?.note}
        keyPolicy={mapEntry?.keyPolicy}
        credentialAdvisory={mapEntry?.credentialAdvisory}
        textEditor={textEditor}
        level={level}
      />
    )
  }
  return (
    <TableEditBody
      value={value}
      schema={tableSchema}
      widths={tableWidths}
      onWidthsChange={onTableWidthsChange}
      onChange={onChange as (value: Record<string, unknown>[]) => void}
      onValidChange={onValidChange}
      onSchemaChange={onTableSchemaChange}
      onValidation={onTableValidation}
    />
  )
}
