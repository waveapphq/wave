/**
 * StringCodeMirror - the string-flavored inspect editor (read-only display body
 * + editable edit body). Wrapping, line-numbered plain text. Rendering, fill, and
 * scroll come from the shared FillCodeMirror; this only adds the plain-text
 * extensions and the editable draft. Read-only follows the incoming value;
 * editable holds a local draft and forwards each change.
 *
 * A per-watcher `format` layers the shared language + advisory linter over the
 * plain-text base; `extraExtensions` lets the modal host inject the {{}} template
 * stack. Both are optional - a plain string watcher passes neither.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useMemo, useState } from 'react'
import type { Extension } from '@codemirror/state'

import { FillCodeMirror } from '@/components/shared/variable-bodies/fill-code-mirror'
import { createPlainTextEditorExtensions } from '@/lib/codemirror/plain-text-editor'
import { createFormatExtensions, type ResolvedFormat } from '@/lib/codemirror/format-editor'
import { useThemeSafe } from '@/design-system/theme-provider'
import { valueToText } from '@/lib/variable-format'

// A script or query body is code, not a string value, so it keeps the normal text color.
const CODE_FORMATS: ReadonlySet<ResolvedFormat | undefined> = new Set<ResolvedFormat>([
  'python',
  'sql',
  'dql',
  'query-dsl',
  'aggregation-json',
])

const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
}

export interface StringCodeMirrorProps {
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  readOnly?: boolean
  onChange?: (value: string) => void
  /** Syntax highlighting + advisory linting for the chosen data format. */
  format?: ResolvedFormat
  /** Host-injected extensions (e.g. the {{}} template stack). */
  extraExtensions?: Extension[]
}

export function StringCodeMirror({
  value,
  readOnly,
  onChange,
  format,
  extraExtensions,
}: Readonly<StringCodeMirrorProps>) {
  const [draft, setDraft] = useState(() => valueToText(value ?? ''))
  const { resolvedTheme } = useThemeSafe()
  const isDark = resolvedTheme === 'dark'
  const extensions = useMemo(
    () => [
      ...createPlainTextEditorExtensions({ valueColor: !CODE_FORMATS.has(format) }),
      ...(format ? createFormatExtensions(format, isDark) : []),
      ...(extraExtensions ?? []),
    ],
    [format, extraExtensions, isDark],
  )

  const handleChange = (next: string) => {
    setDraft(next)
    onChange?.(next)
  }

  return (
    <FillCodeMirror
      value={readOnly ? valueToText(value ?? '') : draft}
      onChange={readOnly ? undefined : handleChange}
      extensions={extensions}
      basicSetup={BASIC_SETUP}
      readOnly={readOnly}
    />
  )
}
