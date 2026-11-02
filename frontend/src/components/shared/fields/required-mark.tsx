/** The accessible red star after a required field's label (REQ-3.1.3.11, FIELD-12). */
export function RequiredMark() {
  return (
    <>
      <span className="text-destructive ml-0.5" aria-hidden="true">
        *
      </span>
      {/* The leading space keeps "required" a separate word in the accessible name. */}
      <span className="sr-only">{' required'}</span>
    </>
  )
}
