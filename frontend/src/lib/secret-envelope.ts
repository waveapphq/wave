/** Sealed-secret envelope detection (the backend at-rest format for stored secrets). */
export const SECRET_ENVELOPE_PREFIX = 'wave:enc:v1:'

/** The placeholder a read path returns for a masked (unrevealed) secret value. */
export const MASK_PLACEHOLDER = '********'

/** The backend's rule: absent, null and "" hold nothing; anything else, whitespace included, is a value. */
export function holdsSecretValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/** A secret holding a value its inspector must not show; one holding nothing hides nothing. */
export function hidesSecretValue(variable: { isSecret?: boolean; value?: unknown }): boolean {
  return !!variable.isSecret && holdsSecretValue(variable.value)
}

/** True iff the value is a stored sealed secret (masked write-only in the UI). */
export function isSealedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_ENVELOPE_PREFIX)
}

/** True iff a map credential holds a STORED value: the backend seals a map
 *  credential value by value, so its keys stay readable and every value comes
 *  back a `wave:enc:v1:` envelope. A map typed this session holds none. */
export function isSealedMapCredential(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).some(isSealedSecret)
}

/** True iff the value is a STORED secret the FE must render write-only: either a
 *  sealed envelope (workflow node config) or the masked placeholder (variable /
 *  profile read paths). A value typed this session or revealed as plaintext is
 *  neither, so it stays visible and editable - never masked write-only. */
export function isStoredSecretValue(value: unknown): boolean {
  return isSealedSecret(value) || value === MASK_PLACEHOLDER
}

/** True iff a credential holds a value its next save seals: a map value by value, anything else whole. */
export function holdsUnsavedSecret(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return holdsSecretValue(value) && !isStoredSecretValue(value)
  }
  const items = Object.values(value as Record<string, unknown>)
  return items.some(holdsSecretValue) && !items.some(isStoredSecretValue)
}
