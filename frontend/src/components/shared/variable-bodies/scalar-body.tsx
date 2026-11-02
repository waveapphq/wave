/**
 * ScalarBody - shared scalar/string Visual value body.
 *
 * Dumb renderer for the variable inspect surfaces: the host resolves WHICH
 * value to display (definition vs runtime overlay) and passes it in. A string
 * renders through the shared read-only StringCodeMirror (wrapping, line-numbered,
 * auto-heights to 5 lines then scrolls) - the same editor used in edit. Other
 * scalars render the full untruncated value in mono with the type's value color;
 * expression content renders raw (no quoting) in cyan. `variant='initial'` dims
 * the body (no italics - they render broken in the editor / read oddly).
 *
 * REQ-3.2.2.18: Live variable values display
 */

import type { Extension } from '@codemirror/state'

import { cn } from '@/lib/utils'
import { StringCodeMirror } from '@/components/shared/variable-bodies/string-code-mirror'
import type { ResolvedFormat } from '@/lib/codemirror/format-editor'
import { formatValue, getValueColorClass, valueToText } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'

export interface ScalarBodyProps {
  /** The host draws a whole null itself (one null branch in the watcher). */
  value?: unknown
  type: VariableType
  isExpression?: boolean
  variant: 'current' | 'initial'
  /** String watchers only: syntax highlighting + advisory lint for the format. */
  format?: ResolvedFormat
  /** String watchers only: host-injected extensions (e.g. the template stack). */
  extraExtensions?: Extension[]
}

export function ScalarBody({
  value,
  type,
  isExpression,
  variant,
  format,
  extraExtensions,
}: Readonly<ScalarBodyProps>) {
  if (!isExpression && type === 'string') {
    return (
      <div
        data-testid="scalar-body"
        className={cn(
          'relative h-full overflow-hidden rounded-md border',
          variant === 'initial' && 'opacity-70',
        )}
      >
        <StringCodeMirror
          value={value}
          readOnly
          format={format}
          extraExtensions={extraExtensions}
        />
      </div>
    )
  }

  const text = isExpression ? valueToText(value) : formatValue(value, type)
  const colorClass = isExpression ? 'text-cyan-400' : getValueColorClass(type)
  return (
    <div
      data-testid="scalar-body"
      className={cn(
        'font-mono text-sm whitespace-pre-wrap break-words select-text',
        colorClass,
        variant === 'initial' && 'italic opacity-70',
      )}
    >
      {text}
    </div>
  )
}
