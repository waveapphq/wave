import { within } from '@testing-library/react'
import { expect } from 'vitest'

/** The label a form control is bound to through `for` / `id`. */
export function labelOf(control: HTMLElement): HTMLElement {
  const label = (control as HTMLInputElement).labels?.[0]
  if (!label) throw new Error(`No label is bound to <${control.tagName.toLowerCase()}>`)
  return label
}

/** The host shows the one RequiredMark: an aria-hidden red star and the sr-only word "required". */
export function expectRequiredMark(host: HTMLElement): void {
  const star = within(host).getByText('*')
  expect(star).toHaveAttribute('aria-hidden', 'true')
  expect(star).toHaveClass('text-destructive')
  expect(within(host).getByText('required')).toHaveClass('sr-only')
}

export function expectNoRequiredMark(host: HTMLElement): void {
  expect(within(host).queryByText('*')).not.toBeInTheDocument()
  expect(within(host).queryByText('required')).not.toBeInTheDocument()
}
