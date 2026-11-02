/**
 * useStagedFields (REQ-4.7.16, SETTINGS-18): the staging core of a Settings page - staged
 * values over the saved ones, the dirty flag, Cancel, and a Save that sends what the page says.
 */

import { useCallback, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'

export interface StagedFieldsOptions<T extends object, U> {
  /** The saved values; undefined until the page's first read answers. */
  saved: T | undefined
  /** The page's compare rule for one staged field; without it a field differs when its value is another one. */
  differs?: (field: keyof T, saved: T, staged: T) => boolean
  /** What a Save sends. */
  toUpdate: (saved: T, staged: T) => U
  /** Writes the update; the page keeps the answer and hands it back as `saved`. */
  send: (update: U) => Promise<unknown>
  failureTitle: string
}

export interface StagedFields<T extends object> {
  staged: T | undefined
  dirty: boolean
  saving: boolean
  stage: <K extends keyof T>(field: K, value: T[K]) => void
  cancel: () => void
  /** Resolves true once saved and false after a reported failure; it never rejects. */
  save: () => Promise<boolean>
}

const NO_EDITS = {}

function valueDiffers<T extends object>(field: keyof T, saved: T, staged: T): boolean {
  return staged[field] !== saved[field]
}

/** What a password field stages: an empty password removes a stored one and is no edit (undefined) when none is stored. */
export function stagedPassword<V>(stored: boolean, value: V): V | undefined {
  return value === '' && !stored ? undefined : value
}

export function useStagedFields<T extends object, U>({
  saved,
  differs = valueDiffers,
  toUpdate,
  send,
  failureTitle,
}: StagedFieldsOptions<T, U>): StagedFields<T> {
  const { report } = useFailureToast(failureTitle)
  const [edits, setEdits] = useState<Partial<T>>(NO_EDITS)
  const [saving, setSaving] = useState(false)

  const values = useMemo(() => saved && { saved, staged: { ...saved, ...edits } }, [saved, edits])
  const dirty =
    values !== undefined &&
    (Object.keys(edits) as (keyof T)[]).some((field) => differs(field, values.saved, values.staged))

  const stage = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setEdits((prev) => ({ ...prev, [field]: value }))
  }, [])

  const cancel = useCallback(() => {
    setEdits(NO_EDITS)
  }, [])

  const save = useCallback(async () => {
    if (!values) return false
    setSaving(true)
    let saved = true
    try {
      await send(toUpdate(values.saved, values.staged))
      setEdits(NO_EDITS)
    } catch (err) {
      report(err)
      saved = false
    } finally {
      setSaving(false)
    }
    return saved
  }, [values, toUpdate, send, report])

  return { staged: values?.staged, dirty, saving, stage, cancel, save }
}
