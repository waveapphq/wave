/**
 * Shared settings row group: a bordered group of rows, each with a label, an
 * optional help line and a control at the right edge, centered vertically (NET-11).
 */

import {
  cloneElement,
  isValidElement,
  useId,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface SettingsRowGroupProps {
  children: ReactNode
  'data-testid'?: string
}

export interface SettingsRowGroupRowProps {
  label: string
  help?: string
  adornment?: ReactNode
  /** Gets the label's `id` and the `aria-describedby` of the help and message lines; a composite control forwards both to its focusable element. */
  control: ReactNode
  /** Fades the row while its control is off (MCP-7). */
  muted?: boolean
  /** `top` keeps the label and help level with a field that holds content under it. */
  align?: 'center' | 'top'
  /** A problem with the row's value, shown under the control, which is marked `aria-invalid`. */
  message?: string
  messageTestId?: string
  /** Content across the whole row, under the control and the message. */
  below?: ReactNode
  'data-testid'?: string
}

export interface SettingsRowGroupMessageProps {
  /** The id the field's `aria-describedby` names while the message shows. */
  id: string
  message?: string
  /** Places the line while it holds a message. */
  className?: string
  'data-testid'?: string
}

export interface SettingsRowGroupFullWidthRowProps {
  children: ReactNode
  'data-testid'?: string
}

export interface SettingsRowGroupSkeletonProps {
  rows: readonly string[]
  help: boolean
  controlClassName: string
  'data-testid'?: string
}

export interface SettingsRowGroupFooterProps {
  children: ReactNode
  'data-testid'?: string
}

type WirableElement = ReactElement<
  Pick<HTMLAttributes<HTMLElement>, 'id' | 'aria-describedby' | 'aria-invalid'>
>

const GROUP_CLASS = 'divide-y divide-border rounded-md border border-border'

/** The control wired to the row's label, help line and message, and the id the label points at. */
function wireControl(
  control: ReactNode,
  fallbackId: string,
  helpId: string | undefined,
  messageId: string | undefined,
): { node: ReactNode; controlId?: string } {
  if (!isValidElement(control)) return { node: control }
  const element = control as WirableElement
  const controlId = element.props.id ?? fallbackId
  const describedBy = [element.props['aria-describedby'], helpId, messageId].filter(Boolean).join(' ')
  const node = cloneElement(element, {
    id: controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': messageId ? true : element.props['aria-invalid'],
  })
  return { node, controlId }
}

/** A field's problem line; a screen reader speaks the message when it appears or changes. */
function SettingsRowGroupMessage({
  id,
  message,
  className,
  'data-testid': testId,
}: Readonly<SettingsRowGroupMessageProps>) {
  return (
    // The region stays mounted while empty: one that arrives with its text is not spoken.
    <div aria-live="polite" className={message ? className : 'sr-only'}>
      {message ? (
        <p id={id} data-testid={testId} className="mt-1.5 text-xs text-error">
          {message}
        </p>
      ) : null}
    </div>
  )
}

function SettingsRowGroupRoot({ children, 'data-testid': testId }: Readonly<SettingsRowGroupProps>) {
  return (
    <div data-testid={testId} className={GROUP_CLASS}>
      {children}
    </div>
  )
}

function SettingsRowGroupRow({
  label,
  help,
  adornment,
  control,
  muted = false,
  align = 'center',
  message,
  messageTestId,
  below,
  'data-testid': testId,
}: Readonly<SettingsRowGroupRowProps>) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const messageId = `${id}-message`
  const { node, controlId } = wireControl(
    control,
    `${id}-control`,
    helpId,
    message ? messageId : undefined,
  )
  const top = align === 'top'
  // The message and the content under it wrap onto their own lines, so the control keeps its place and its focus.
  const wraps = Boolean(message || below)
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex',
        top ? 'items-start' : 'items-center',
        'justify-between',
        wraps ? 'flex-wrap gap-x-4' : 'gap-4',
        'p-3',
        muted && 'cursor-not-allowed opacity-50',
      )}
    >
      {/* A top-aligned label block is as tall as a field, so it stays level with the field. */}
      <div
        className={cn('min-w-0', wraps && 'flex-1', top && 'flex min-h-10 flex-col justify-center')}
      >
        <div className="flex items-center gap-2">
          <label htmlFor={controlId} className="text-sm">
            {label}
          </label>
          {adornment}
        </div>
        {help && (
          <p id={helpId} className="text-xs text-muted-foreground">
            {help}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center">{node}</div>
      <SettingsRowGroupMessage
        id={messageId}
        message={message}
        className="w-full text-right"
        data-testid={messageTestId}
      />
      {below ? <div className="mt-3 w-full">{below}</div> : null}
    </div>
  )
}

function SettingsRowGroupFullWidthRow({
  children,
  'data-testid': testId,
}: Readonly<SettingsRowGroupFullWidthRowProps>) {
  return (
    <div data-testid={testId} className="p-3">
      {children}
    </div>
  )
}

function SettingsRowGroupSkeleton({
  rows,
  help,
  controlClassName,
  'data-testid': testId,
}: Readonly<SettingsRowGroupSkeletonProps>) {
  return (
    <div data-testid={testId} aria-busy="true" className={GROUP_CLASS}>
      {rows.map((row) => (
        <div key={row} className="flex items-center justify-between gap-4 p-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            {help ? <Skeleton className="h-3 w-96" /> : null}
          </div>
          <Skeleton className={controlClassName} />
        </div>
      ))}
    </div>
  )
}

function SettingsRowGroupFooter({
  children,
  'data-testid': testId,
}: Readonly<SettingsRowGroupFooterProps>) {
  return (
    <p data-testid={testId} className="mt-3 text-xs text-muted-foreground">
      {children}
    </p>
  )
}

export const SettingsRowGroup = Object.assign(SettingsRowGroupRoot, {
  Row: SettingsRowGroupRow,
  Message: SettingsRowGroupMessage,
  FullWidthRow: SettingsRowGroupFullWidthRow,
  Skeleton: SettingsRowGroupSkeleton,
  Footer: SettingsRowGroupFooter,
})
