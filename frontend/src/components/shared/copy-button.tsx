/**
 * Copy-to-clipboard button (icon only, or icon plus visible text): Copy turns
 * into Check for two seconds with a screen-reader announcement; a failed copy
 * stays silent.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, type ButtonSize } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { copyText } from '@/lib/clipboard'

const COPY_RESET_MS = 2000

interface CopyButtonChrome {
  value: string
  size?: ButtonSize
  className?: string
  /** Stamped on the button itself. */
  testId?: string
  /** Stamped on the transient check icon. */
  copiedTestId?: string
  /** What a screen reader hears after a successful copy. */
  announcement?: string
  /** Hover hint; empty renders the button unwrapped. */
  tooltip?: ReactNode
  /** Forces the cue off, so sibling buttons can show it one at a time. */
  copied?: boolean
  /** Fired on a successful copy, before the cue appears. */
  onCopied?: () => void
  /** Visible text beside the icon; it also names the button unless ariaLabel does. */
  text?: string
}

export type CopyButtonProps = CopyButtonChrome &
  (
    | { label: string; ariaLabel?: never }
    | { ariaLabel: string; label?: never }
    | { text: string; label?: never; ariaLabel?: never }
  )

export function CopyButton({
  value,
  label,
  ariaLabel,
  text,
  size,
  className,
  testId = 'copy-path-button',
  copiedTestId,
  announcement = 'Path copied',
  tooltip,
  copied,
  onCopied,
}: Readonly<CopyButtonProps>) {
  const [selfCopied, setSelfCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const showsCue = copied ?? selfCopied
  const buttonSize = size ?? (text === undefined ? 'icon' : 'sm')
  const iconClass = buttonSize === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  const handleCopy = () => {
    // However the copy ends, the copied cue only appears on a real success.
    const showCopyResult = (copyResult: unknown): void => {
      if (copyResult !== true) return
      onCopied?.()
      setSelfCopied(true)
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setSelfCopied(false), COPY_RESET_MS)
    }
    copyText(value).then(showCopyResult, showCopyResult)
  }

  return (
    <ConditionalTooltip content={tooltip}>
      <Button
        variant="ghost"
        size={buttonSize}
        className={className}
        aria-label={ariaLabel ?? text ?? `Copy path of ${label}`}
        data-testid={testId}
        data-copied={showsCue ? 'true' : undefined}
        onClick={handleCopy}
      >
        {showsCue ? (
          <Check className={iconClass} data-testid={copiedTestId} />
        ) : (
          <Copy className={iconClass} />
        )}
        {text}
        <output className="sr-only">{showsCue ? announcement : ''}</output>
      </Button>
    </ConditionalTooltip>
  )
}
