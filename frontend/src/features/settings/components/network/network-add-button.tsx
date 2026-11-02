/**
 * Outlined add button of the Network tables and lists (NET-3, NET-7).
 */

export interface NetworkAddButtonProps {
  label: string
  /** The accessible name, when the visible word alone does not say what is added. */
  'aria-label'?: string
  onClick: () => void
  disabled?: boolean
}

export function NetworkAddButton({
  label,
  'aria-label': ariaLabel,
  onClick,
  disabled = false,
}: Readonly<NetworkAddButtonProps>) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent px-3 text-sm shadow-sm enabled:hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  )
}
