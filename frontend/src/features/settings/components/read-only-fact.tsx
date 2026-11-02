/**
 * Lock-marked read-only settings fact (WSRV-2): label, lock, mono value and an optional copy button.
 */

import { Lock } from 'lucide-react'
import { CopyButton } from '@/components/shared/copy-button'

export interface ReadOnlyFactProps {
  label: string
  value: string
  copyable?: boolean
  /** `columns` hands label, lock and value to the parent grid, so stacked facts line up (NET-10). */
  layout?: 'inline' | 'columns'
  'data-testid'?: string
}

export function ReadOnlyFact({
  label,
  value,
  copyable = false,
  layout = 'inline',
  'data-testid': testId,
}: Readonly<ReadOnlyFactProps>) {
  const columns = layout === 'columns'
  return (
    <span data-testid={testId} className={columns ? 'contents' : 'flex min-w-0 items-center gap-1.5'}>
      {columns ? <span>{label}</span> : label}
      <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-all font-mono text-foreground" translate="no">
        {value}
      </span>
      {/* The button's size class outranks plain h-/w-/p- utilities, so the 20 px box needs `!`. */}
      {copyable && (
        <CopyButton
          value={value}
          ariaLabel={`Copy ${label}`}
          size="sm"
          className="!h-5 !w-5 shrink-0 !p-0"
          announcement={`${label} copied`}
        />
      )}
    </span>
  )
}
