/**
 * Toast payload contract: the data any caller hands to the toast API.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
  dismissOnAction?: boolean
}

export interface ToastOptions {
  id?: string
  title?: string
  message: string
  variant: ToastVariant
  duration?: number
  action?: ToastAction
}
