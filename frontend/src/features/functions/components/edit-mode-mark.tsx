/**
 * Red SVG asterisk overlay shown on a Published Function's lifecycle badge
 * when the instance carries an in-Test edit-mode draft.
 *
 * The component renders the inner SVG only. Positioning + color theming is
 * applied by the wrapping element on `FunctionLifecycleBadge`.
 */

export function EditModeMark() {
  return (
    <svg
      data-testid="edit-mode-mark"
      viewBox="0 0 16 16"
      width="8"
      height="8"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 2 L8 14 M3 5 L13 11 M3 11 L13 5"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
