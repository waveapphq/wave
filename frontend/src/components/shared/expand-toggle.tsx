/** The one button that opens and closes a row: a chevron and, when given, the row's own text. */

import type { ComponentProps } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type ButtonProps = Omit<
  ComponentProps<'button'>,
  'type' | 'name' | 'onClick' | 'aria-expanded' | 'aria-label'
>

export interface ExpandToggleProps extends ButtonProps {
  expanded: boolean
  onToggle: () => void
  /** The text after "Expand" / "Collapse" in the label. */
  name: string
}

const CHEVRON_CLASS = 'h-4 w-4 shrink-0'

export function ExpandToggle({
  expanded,
  onToggle,
  name,
  children,
  className,
  ...buttonProps
}: Readonly<ExpandToggleProps>) {
  return (
    <button
      {...buttonProps}
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
      onClick={onToggle}
      className={cn('group flex items-center gap-2 text-left', className)}
    >
      {expanded ? (
        <ChevronDown className={CHEVRON_CLASS} />
      ) : (
        <ChevronRight className={CHEVRON_CLASS} />
      )}
      {children}
    </button>
  )
}
