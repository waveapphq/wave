/**
 * ConvertTypeDialog - Confirmation dialog for converting profile type to custom
 *
 * Shown when user modifies parameter structure on a non-custom profile type.
 */

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

export interface ConvertTypeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentType: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConvertTypeDialog({
  open,
  onOpenChange,
  currentType,
  onConfirm,
  onCancel,
}: Readonly<ConvertTypeDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Convert to Custom Type?</DialogTitle>
          <DialogDescription>
            Modifying the parameter structure will convert this profile from {currentType} to custom type. This allows full customization but the profile will no longer match the predefined schema.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
          >
            Convert to Custom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
