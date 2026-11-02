/** True when an input declares allowed values, the one marker of an enum input (REQ-3.1.2.11). */
export function isEnumInput<T extends { enumValues?: readonly unknown[] }>(
  spec: T,
): spec is T & { enumValues: NonNullable<T['enumValues']> } {
  return spec.enumValues !== undefined
}
