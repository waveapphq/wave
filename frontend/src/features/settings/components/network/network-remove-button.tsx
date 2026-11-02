/**
 * Trash button of the Network tables and lists (NET-3, NET-7), named by its `aria-label`.
 */

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface NetworkRemoveButtonProps {
  'aria-label': string
  onClick: () => void
  disabled?: boolean
}

export function NetworkRemoveButton({
  'aria-label': ariaLabel,
  onClick,
  disabled = false,
}: Readonly<NetworkRemoveButtonProps>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 p-0 text-muted-foreground"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  )
}
