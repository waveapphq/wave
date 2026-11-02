/**
 * Tests Validation API
 *
 * Validation and auto-fix operations for test definitions.
 */

import { apiClient } from '@/lib/api'
import type { ApiError } from '@/services/api-client'
import type {
  TestValidationResult,
  UnsavedTestBody,
  FixTestResponse,
  FixTestWarning,
  FixTestResult,
} from './types'

/**
 * Validate a test definition on the backend.
 * Returns structured validation result with fatal flag, errors, and warnings.
 *
 * The API returns 200 when clean (no errors) and 422 when validation errors
 * are found. Both cases return the validation result for the caller.
 */
export async function validateTest(
  testId: string,
  context: 'load' | 'import' | 'run' = 'load',
  unsaved?: UnsavedTestBody,
): Promise<TestValidationResult> {
  const url = `/tests/${testId}/validate?context=${context}`
  try {
    // An unsaved body is checked in place of the stored test.
    const response = unsaved
      ? await apiClient.post<TestValidationResult>(url, unsaved)
      : await apiClient.post<TestValidationResult>(url)
    return response.data
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.status === 422 && apiError.details?.length) {
      return apiError.details[0] as unknown as TestValidationResult
    }
    throw error
  }
}

/**
 * Apply automatic fixes to a test.
 * Returns the fixed test data and any post-fix warnings.
 */
export async function fixTest(testId: string): Promise<FixTestResult> {
  const response = await apiClient.post<{
    data: FixTestResponse
    warnings: FixTestWarning[]
  }>(`/tests/${testId}/fix`, undefined, { rawResponse: true })
  const raw = response.data
  return { test: raw.data, warnings: raw.warnings ?? [] }
}
