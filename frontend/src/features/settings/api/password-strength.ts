/**
 * Password strength API client (REQ-5.2.7.1): the score shown while a new password is typed.
 */

import { apiClient } from '@/lib/api'

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** `userInputs` are words that count against the password, such as the username. */
export async function scorePassword(
  password: string,
  userInputs?: string[],
): Promise<PasswordStrengthResult> {
  const response = await apiClient.post<PasswordStrengthResult>(
    '/api/v1/system/password-strength',
    { password, user_inputs: userInputs },
  )
  return response.data
}
