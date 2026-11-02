/**
 * String case helpers.
 */

/**
 * Convert camelCase to snake_case for backend API params.
 * e.g. `startedAt` → `started_at`, `testsCount` → `tests_count`.
 */
export function toSnakeCase(field: string): string {
  return field.replaceAll(/([A-Z])/g, '_$1').toLowerCase()
}
