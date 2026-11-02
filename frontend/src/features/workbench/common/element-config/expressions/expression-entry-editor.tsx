/**
 * The {x} entry slot the list, map and Parts editors take: the expression field drawn as the one 32px row box,
 * its full editor opened by the host's expand or by Ctrl+E (FIELD-1).
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 */

import { ENTRY_SOURCE_BOX_CLASS } from '@/components/shared/variable-bodies/body-parts'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { ExpressionField, type AvailableVariable } from './expression-field'

export function makeExpressionEditor(availableVariables: AvailableVariable[]) {
  return function ExpressionEntryEditor(props: MapExpressionEditorProps) {
    return (
      <div data-testid={props.testId} className={ENTRY_SOURCE_BOX_CLASS}>
        <ExpressionField
          name={props.testId}
          displayName={props.ariaLabel}
          value={props.value}
          onChange={props.onChange}
          availableVariables={availableVariables}
          isFieldExpression
          editorOpen={props.editorOpen}
          onEditorOpenChange={props.onEditorOpenChange}
        />
      </div>
    )
  }
}
