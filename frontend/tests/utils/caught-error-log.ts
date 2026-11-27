import { expect } from 'vitest'

/** The console.error arguments React 19 logs when an error boundary catches an error. */
export function caughtErrorReport(message: string, boundary: string, component?: string): unknown[] {
  return [
    '%o\n\n%s\n\n%s\n',
    expect.objectContaining({ message }),
    component === undefined
      ? 'The above error occurred in one of your React components.'
      : `The above error occurred in the <${component}> component.`,
    `React will try to recreate this component tree from scratch using the error boundary you provided, ${boundary}.`,
  ]
}
