/**
 * CodeBody - shared Code view body, read-only by default with an editable mode.
 *
 * Read-only: CodeMirror JSON over the displayed value, 2-space pretty-printed;
 * {columns, rows} dict tables serialize as array-of-row-objects. The initial
 * variant dims without italics (italic code renders broken).
 *
 * Editable: writable via the same extensions factory (readOnly:false); the
 * doc text is forwarded to onChange and the JSON parse state to onValidChange so
 * the inspect-modal host gates Save and the invalid-JSON View guard.
 *
 * Rendering, fill, and scroll come from the shared FillCodeMirror (so the Code
 * view fills + scrolls a resized watcher exactly like the string editor); this
 * body only adds the JSON serialization + extensions.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import { tableDictToRowObjects } from '@/lib/variable-table-model'
import { createJsonDataEditorExtensions } from '@/lib/codemirror/json-data-editor'
import { FillCodeMirror } from '@/components/shared/variable-bodies/fill-code-mirror'
import type { ComplexBodyProps } from '@/components/shared/variable-bodies/body-parts'

const NOOP = (): void => {}

export interface CodeBodyProps extends ComplexBodyProps {
  editable?: boolean
  onChange?: (value: string) => void
  onValidChange?: (valid: boolean) => void
  /** Override the value->text serialization (tables render int/float as numbers). */
  serialize?: (value: unknown) => string
  /** Grammar-aware lint/validity pre-processor (e.g. masking bare {{ }} tokens);
   *  applied before JSON validation so an extended grammar validates. */
  jsonMask?: (text: string) => string
}

function serializeDoc(value: unknown): string {
  return JSON.stringify(tableDictToRowObjects(value), null, 2)
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function CodeBody({
  value,
  variant,
  editable,
  onChange = NOOP,
  onValidChange = NOOP,
  serialize = serializeDoc,
  jsonMask,
}: Readonly<CodeBodyProps>) {
  const readOnlyDoc = useMemo(() => serialize(value), [value, serialize])
  const [editDoc, setEditDoc] = useState(() => serialize(value))
  const extensions = useMemo(
    () => createJsonDataEditorExtensions({ readOnly: !editable, jsonMask }),
    [editable, jsonMask],
  )

  const handleChange = (next: string) => {
    setEditDoc(next)
    onChange(next)
    onValidChange(isValidJson(jsonMask ? jsonMask(next) : next))
  }

  return (
    <div
      data-testid="code-body"
      className={cn(
        // select-text overrides the draggable sheet's select-none so a read view
        // can be Ctrl+A / Ctrl+C copied (the editor below is kept focusable too).
        'relative h-full overflow-hidden rounded-md border select-text',
        variant === 'initial' && 'opacity-70',
      )}
    >
      <FillCodeMirror
        value={editable ? editDoc : readOnlyDoc}
        onChange={handleChange}
        extensions={extensions}
        basicSetup={{ lineNumbers: false, foldGutter: false }}
        readOnly={!editable}
        editable
      />
    </div>
  )
}
