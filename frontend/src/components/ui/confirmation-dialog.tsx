/**
 * ConfirmationDialog Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.23: Confirmation dialogs for destructive actions
 *
 * Confirmation dialog component following design system specifications.
 *
 * Built on Radix AlertDialog which provides:
 * - Portal rendering (no manual createPortal)
 * - Focus trapping (no manual Tab/Shift+Tab handling)
 * - Scroll lock (no manual body overflow manipulation)
 * - No ESC/backdrop dismiss (users MUST click a button)
 *
 * Specifications:
 * - Modal overlay with focused decision point
 * - 5 coordinated elements: icon, title, description, confirm button, cancel button
 * - Visual hierarchy: centered vertically/horizontally over dimmed background
 * - Container: width 400px (sm), max-height 90vh, padding 24px, border-radius 12px
 * - Backdrop clicking does NOT dismiss (must use buttons)
 * - Type-to-confirm for high-risk actions
 */

/* v8 ignore next - COV-V8-001 */
import {
  useCallback,
  useRef,
  useState,
  type HTMLAttributes,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  X,
  Unlink,
  FolderInput,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from './alert-dialog'

export type ConfirmationDialogVariant =
  | 'delete'
  | 'delete-multiple'
  | 'reset'
  | 'overwrite'
  | 'discard'
  | 'disconnect'
  | 'move'
  | 'make-secret'
  | 'switch'

/** An extra action shown between Cancel and the confirm button. */
export interface ConfirmationSecondaryAction {
  label: string
  onClick: () => void
  testId?: string
}

export interface ConfirmationDialogProps extends HTMLAttributes<HTMLDivElement> {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when the dialog should close */
  onClose: () => void
  /** Called when confirm button is clicked */
  onConfirm: () => void
  /** Dialog title */
  title?: string
  /** Dialog description */
  description?: ReactNode
  /** Dialog variant determines icon and default labels */
  variant?: ConfirmationDialogVariant
  /** Custom confirm button label */
  confirmLabel?: string
  /** Custom cancel button label */
  cancelLabel?: string
  /** Item name for dynamic title generation */
  itemName?: string
  /** Item count for bulk operations */
  itemCount?: number
  /** List of item names for bulk operations */
  itemNames?: string[]
  /** Require user to type this phrase to confirm */
  requireConfirmation?: string
  /** Whether the dialog is in loading state */
  isLoading?: boolean
  /** Error message to display */
  error?: string
  /** Extra body content rendered between the description and the actions. */
  children?: ReactNode
  secondaryAction?: ConfirmationSecondaryAction
  cancelTestId?: string
  confirmTestId?: string
}

interface VariantConfig {
  icon: LucideIcon
  iconName: string
  /** Tinted-circle icon treatment (wireframe idiom); plain icon-xl when absent. */
  iconCircleClassName?: string
  defaultConfirmLabel: string
  defaultTitle: (itemName?: string, itemCount?: number) => string
  /** The title color; the primary accent when absent. */
  titleClassName?: string
}

const variantConfigs: Record<ConfirmationDialogVariant, VariantConfig> = {
  delete: {
    icon: Trash2,
    iconName: 'trash',
    defaultConfirmLabel: 'Delete',
    defaultTitle: (itemName) => (itemName ? `Delete "${itemName}"?` : 'Delete item?'),
  },
  'delete-multiple': {
    icon: Trash2,
    iconName: 'trash',
    defaultConfirmLabel: 'Delete All',
    defaultTitle: (_, itemCount) => `Delete ${itemCount ?? 0} items?`,
  },
  reset: {
    icon: RotateCcw,
    iconName: 'rotate-ccw',
    iconCircleClassName: 'bg-error/10 text-error',
    defaultConfirmLabel: 'Reset',
    defaultTitle: () => 'Reset settings?',
  },
  overwrite: {
    icon: AlertTriangle,
    iconName: 'alert-triangle',
    defaultConfirmLabel: 'Overwrite',
    defaultTitle: (itemName) => (itemName ? `Overwrite "${itemName}"?` : 'Overwrite file?'),
  },
  discard: {
    icon: X,
    iconName: 'x',
    defaultConfirmLabel: 'Discard',
    defaultTitle: () => 'Discard changes?',
  },
  disconnect: {
    icon: Unlink,
    iconName: 'unlink',
    defaultConfirmLabel: 'Disconnect',
    defaultTitle: (itemName) =>
      itemName ? `Disconnect "${itemName}"?` : 'Disconnect server?',
  },
  move: {
    icon: FolderInput,
    iconName: 'folder-input',
    defaultConfirmLabel: 'Move',
    defaultTitle: (itemName) =>
      itemName ? `Move "${itemName}"?` : 'Move item?',
  },
  'make-secret': {
    icon: AlertTriangle,
    iconName: 'alert-triangle',
    defaultConfirmLabel: 'Make secret and save',
    defaultTitle: (_, itemCount) =>
      Number(itemCount) > 1 ? `Make ${itemCount} variables secret?` : 'Make this variable secret?',
  },
  switch: {
    icon: X,
    iconName: 'x',
    defaultConfirmLabel: 'Clear & Default',
    defaultTitle: () => 'Switch the field to an expression?',
    titleClassName: 'text-foreground',
  },
}

const PRIMARY_CONFIRM_VARIANTS: ReadonlySet<ConfirmationDialogVariant> = new Set(['move', 'switch'])

/** Whether the bordered name list shows: every name for make-secret (SECUI-12), at most 10 for a bulk delete. */
function showsItemList(variant: ConfirmationDialogVariant, itemNames: string[] | undefined): itemNames is string[] {
  if (!itemNames || itemNames.length === 0) return false
  if (variant === 'make-secret') return true
  return variant === 'delete-multiple' && itemNames.length <= 10
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title: providedTitle,
  description,
  variant = 'delete',
  confirmLabel: providedConfirmLabel,
  cancelLabel = 'Cancel',
  itemName,
  itemCount,
  itemNames,
  requireConfirmation,
  isLoading = false,
  error,
  className = '',
  children,
  secondaryAction,
  cancelTestId,
  confirmTestId,
  ref,
  ...props
}: ConfirmationDialogProps & { ref?: Ref<HTMLDivElement> }) {
  const confirmInputRef = useRef<HTMLInputElement>(null)
  const [confirmInput, setConfirmInput] = useState('')
  const [showInputError, setShowInputError] = useState(false)

  const config = variantConfigs[variant]
  const IconComponent = config.icon
  const title = providedTitle ?? config.defaultTitle(itemName, itemCount)
  const confirmLabel = providedConfirmLabel ?? config.defaultConfirmLabel

  // Check if confirm input matches
  const isConfirmInputValid =
    !requireConfirmation || confirmInput === requireConfirmation

  // Determine if confirm button should be disabled
  const isConfirmDisabled = isLoading || Boolean(requireConfirmation && !isConfirmInputValid)

  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  const handleSecondary = (action: ConfirmationSecondaryAction) => {
    action.onClick()
    onClose()
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setConfirmInput(e.target.value)
    setShowInputError(false)
  }

  const handleInputBlur = () => {
    if (requireConfirmation && confirmInput && confirmInput !== requireConfirmation) {
      setShowInputError(true)
    }
  }

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isConfirmInputValid && !isLoading) {
      handleConfirm()
    }
  }

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isLoading) {
        // Reset state when closing
        setConfirmInput('')
        setShowInputError(false)
        onClose()
      }
    },
    [isLoading, onClose]
  )

  const shouldShowItemList = showsItemList(variant, itemNames)

  const iconToneClass = variant === 'move' ? 'text-primary' : 'text-error'
  const iconWrapperClassName = config.iconCircleClassName
    ? cn(
        'mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full',
        config.iconCircleClassName
      )
    : cn('icon-xl mb-4', iconToneClass)

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        ref={ref}
        className={cn(
          'max-w-[400px]',
          'max-h-[90vh]',
          'p-6',
          'rounded-xl',
          'shadow-lg',
          'bg-elevated',
          'text-center',
          'gap-0',
          className
        )}
        onOpenAutoFocus={(e) => {
          if (requireConfirmation) {
            e.preventDefault()
            confirmInputRef.current?.focus()
          }
        }}
        // Per REQ-5.2.1.23: destructive-action dialogs must NOT dismiss on
        // ESC - the user has to explicitly choose Cancel or the confirm
        // action. AlertDialog already does not dismiss on outside click,
        // so only the ESC handler is needed here.
        onEscapeKeyDown={(e) => e.preventDefault()}
        {...props}
      >
        {/* Icon */}
        <div
          data-confirmation-icon
          data-icon={config.iconName}
          className={iconWrapperClassName}
          aria-hidden="true"
        >
          <IconComponent size={config.iconCircleClassName ? 20 : 24} />
        </div>

        {/* Title */}
        <AlertDialogTitle className={cn(config.titleClassName ?? 'text-primary', 'mb-2')}>
          {title}
        </AlertDialogTitle>

        {/* Description */}
        {description ? (
          <AlertDialogDescription className="font-normal text-secondary leading-normal mb-6">
            {description}
          </AlertDialogDescription>
        ) : (
          /* Hidden description to satisfy Radix accessibility requirement */
          <AlertDialogDescription className="sr-only">
            Confirmation required
          </AlertDialogDescription>
        )}

        {/* Caller-provided body content (e.g. the artifact-loss callout) */}
        {children}

        {/* Item list for bulk operations */}
        {shouldShowItemList && (
          <div
            data-item-list
            translate={variant === 'make-secret' ? 'no' : undefined}
            className={cn(
              'overflow-y-auto max-h-32 text-left mb-4 p-2 border rounded bg-subtle text-sm',
              variant === 'make-secret' && 'font-mono'
            )}
          >
            <ul className="list-disc list-inside">
              {itemNames.map((name) => (
                <li key={name} className="text-secondary">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Type-to-confirm input */}
        {requireConfirmation && (
          <div data-confirm-input-wrapper className="mt-4 mb-6 text-left">
            <p className="text-sm text-secondary mb-2">
              Type <span className="font-semibold font-mono">{requireConfirmation}</span> to
              confirm
            </p>
            <input
              ref={confirmInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmInput}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              className={cn(
                'input',
                'w-full',
                'h-10',
                'px-3',
                'text-sm',
                'outline-none',
                'transition-colors',
                showInputError && confirmInput !== requireConfirmation
                  ? 'border-error'
                  : ''
              )}
              aria-label={`Type ${requireConfirmation} to confirm`}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <p role="alert" className="text-error text-sm mb-4">
            {error}
          </p>
        )}

        {/* Action group */}
        <div data-action-group className="flex justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button
              variant="secondary"
              size="md"
              disabled={isLoading}
              data-testid={cancelTestId}
              className="whitespace-nowrap"
            >
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          {secondaryAction ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => handleSecondary(secondaryAction)}
              disabled={isLoading}
              data-testid={secondaryAction.testId}
              className="whitespace-nowrap"
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          <Button
            variant={PRIMARY_CONFIRM_VARIANTS.has(variant) ? 'default' : 'danger'}
            size="md"
            data-testid={confirmTestId}
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            loading={isLoading}
            aria-busy={isLoading || undefined}
            className="whitespace-nowrap"
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
