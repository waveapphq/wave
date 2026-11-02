/**
 * ArrayBody - shared array Visual value body.
 *
 * Dumb renderer: muted right-aligned 0-based index column + value rows with
 * hairline separators; per-element tint by the value's own type; first 500
 * items with the overflow line beyond the cap.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { cn } from '@/lib/utils'
import {
  declaredElementRenderType,
  formatDeclaredElementCell,
  getCellColorClass,
} from '@/lib/variable-format'
import {
  BodyEmptyLine,
  BodyOverflowLine,
  VISUAL_CAP,
  type ComplexBodyProps,
} from '@/components/shared/variable-bodies/body-parts'

export function ArrayBody({ value, variant, elementTypes }: Readonly<ComplexBodyProps>) {
  const items = Array.isArray(value) ? value : []
  const declared: unknown[] = Array.isArray(elementTypes) ? elementTypes : []
  const visible = items.slice(0, VISUAL_CAP)

  return (
    <div
      data-testid="array-body"
      // Fills its host so the empty line stays centered both ways (VMGR-94).
      className={cn(
        'flex min-h-full flex-col font-mono text-[13px] select-text',
        variant === 'initial' && 'italic opacity-70',
      )}
    >
      {items.length === 0 ? (
        <BodyEmptyLine label="no items" />
      ) : (
        <>
          {visible.map((element, index) => {
            const rowKey = `row-${index}`
            return (
              <div
                key={rowKey}
                data-testid="array-row"
                className="flex items-start gap-3 border-b border-border/40 px-1 py-1.5 last:border-b-0"
              >
                <span
                  data-testid="array-index"
                  className="w-7 shrink-0 text-right text-xs leading-5 text-muted-foreground"
                >
                  {index}
                </span>
                <span
                  className={cn(
                    'min-w-0 whitespace-pre-wrap break-words',
                    getCellColorClass(declaredElementRenderType(element, declared[index])),
                  )}
                >
                  {formatDeclaredElementCell(element, declared[index])}
                </span>
              </div>
            )
          })}
          {items.length > VISUAL_CAP && (
            <BodyOverflowLine hiddenCount={items.length - VISUAL_CAP} />
          )}
        </>
      )}
    </div>
  )
}
