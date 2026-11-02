/**
 * FillCodeMirror - the shared CodeMirror fill mechanism behind the inspect
 * editors (the string value editor + the complex Code view). It sits as
 * `absolute inset-0` inside a `relative` host and renders the editor with
 * `className="h-full" height="100%"`, which gives the editor a DEFINITE height
 * (the host's) so it FILLS the host and SCROLLS past it - instead of keeping its
 * content height and clipping when the watcher is resized below the content.
 *
 * The caller owns the host (`relative` + a definite height + `overflow-hidden`)
 * and supplies the language/format via `extensions` (plain text, JSON, ...), so
 * this stays language-agnostic and both editors share one fill/scroll code path.
 */

import CodeMirror, { type BasicSetupOptions } from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'

import { useThemeSafe } from '@/design-system/theme-provider'

export interface FillCodeMirrorProps {
  value: string
  onChange?: (value: string) => void
  extensions: Extension[]
  basicSetup?: BasicSetupOptions
  readOnly?: boolean
  /** Keep the editor focusable + selectable even when readOnly, so a read view
   *  can be Ctrl+A / Ctrl+C copied. Defaults to !readOnly (edit = editable). */
  editable?: boolean
  /** Focus the editor when it mounts. */
  autoFocus?: boolean
}

export function FillCodeMirror({
  value,
  onChange,
  extensions,
  basicSetup,
  readOnly,
  editable,
  autoFocus,
}: Readonly<FillCodeMirrorProps>) {
  const { resolvedTheme } = useThemeSafe()
  return (
    <div className="absolute inset-0">
      <CodeMirror
        className="h-full"
        value={value}
        onChange={readOnly ? undefined : onChange}
        editable={editable ?? !readOnly}
        readOnly={readOnly}
        extensions={extensions}
        basicSetup={basicSetup}
        theme={resolvedTheme}
        height="100%"
        autoFocus={autoFocus}
      />
    </div>
  )
}
