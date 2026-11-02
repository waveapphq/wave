import { createContext } from 'react'

/** The id of the message describing the enclosing field's control while it is in error (FIELDERR-1). */
export const FieldErrorContext = createContext<string | undefined>(undefined)

/** The id of an advisory note under the enclosing field: it describes the control and never marks it in error. */
export const FieldNoteContext = createContext<string | undefined>(undefined)

/** The ids a control's aria-describedby lists, or none. */
export function describedByOf(...ids: ReadonlyArray<string | undefined>): string | undefined {
  const present = ids.filter((id) => id !== undefined)
  return present.length > 0 ? present.join(' ') : undefined
}
