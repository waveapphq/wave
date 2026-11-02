/**
 * StringEditBody - controlled string editor for the inspect-modal edit state.
 * Wraps the shared StringCodeMirror (wrapping, line-numbered, auto-heights to
 * 5 lines then scrolls) in an editable mode. A string is always valid, so it
 * emits onValidChange(true) on every change; the host holds the draft and gates
 * Save.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useMemo } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { StringCodeMirror } from '@/components/shared/variable-bodies/string-code-mirror'
import type { ResolvedFormat } from '@/lib/codemirror/format-editor'

export interface StringEditBodyProps {
  value: unknown
  onChange: (value: string) => void
  onValidChange: (valid: boolean) => void
  /** Syntax highlighting + advisory lint for the chosen format. */
  format?: ResolvedFormat
  /** Host-injected extensions (e.g. the {{}} template stack). */
  extraExtensions?: Extension[]
  /** The editor's accessible name. */
  ariaLabel?: string
}

export function StringEditBody({
  value,
  onChange,
  onValidChange,
  format,
  extraExtensions,
  ariaLabel,
}: Readonly<StringEditBodyProps>) {
  const extensions = useMemo(
    () =>
      ariaLabel === undefined
        ? extraExtensions
        : [...(extraExtensions ?? []), EditorView.contentAttributes.of({ 'aria-label': ariaLabel })],
    [extraExtensions, ariaLabel],
  )
  const handleChange = (next: string) => {
    onChange(next)
    onValidChange(true)
  }

  return (
    <div data-testid="scalar-edit-body" className="h-full">
      <div
        data-testid="string-edit-editor"
        className="relative h-full overflow-hidden rounded-md border"
      >
        <StringCodeMirror
          value={value}
          onChange={handleChange}
          format={format}
          extraExtensions={extensions}
        />
      </div>
    </div>
  )
}
