import { useRef } from 'react'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

export type SwitchModeDirection = 'to-expression' | 'to-plain'

export interface SwitchModeDialogProps {
  open: boolean
  direction: SwitchModeDirection
  hasDefault: boolean
  /** True for text, list, map and table fields, which have an empty value. */
  offersEmpty: boolean
  onCancel: () => void
  onClearDefault: () => void
  onClearEmpty: () => void
}

const TO_PLAIN_TITLE = 'Switch the field to a plain value?'
const BODY = 'The current value is cleared.'
const CLEAR_EMPTY_LABEL = 'Clear & Empty'
const CLEAR_DEFAULT_TEST_ID = 'switch-mode-clear-default'

/** The FIELD-7 switch warning, asked before a field holding a value goes into or out of {x}. */
export function SwitchModeDialog({
  open,
  direction,
  hasDefault,
  offersEmpty,
  onCancel,
  onClearDefault,
  onClearEmpty,
}: Readonly<SwitchModeDialogProps>) {
  // The dialog closes itself after an action; only a close with no action is a Cancel.
  const actedRef = useRef(false)
  const reportAction = (handler: () => void) => () => {
    actedRef.current = true
    handler()
  }
  const handleClose = () => {
    if (actedRef.current) {
      actedRef.current = false
      return
    }
    onCancel()
  }

  const clearLabel = hasDefault ? 'Clear & Default' : 'Clear'
  const clearDefault = reportAction(onClearDefault)

  return (
    <ConfirmationDialog
      isOpen={open}
      onClose={handleClose}
      variant="switch"
      // Into {x} uses the switch variant's own title.
      title={direction === 'to-plain' ? TO_PLAIN_TITLE : undefined}
      description={BODY}
      cancelTestId="switch-mode-cancel"
      data-testid="switch-mode-dialog"
      // Three actions on one line: Cancel, Clear & Default, Clear & Empty.
      className="max-w-[440px]"
      {...(offersEmpty
        ? {
            secondaryAction: { label: clearLabel, onClick: clearDefault, testId: CLEAR_DEFAULT_TEST_ID },
            confirmLabel: CLEAR_EMPTY_LABEL,
            confirmTestId: 'switch-mode-clear-empty',
            onConfirm: reportAction(onClearEmpty),
          }
        : {
            confirmLabel: clearLabel,
            confirmTestId: CLEAR_DEFAULT_TEST_ID,
            onConfirm: clearDefault,
          })}
    />
  )
}
