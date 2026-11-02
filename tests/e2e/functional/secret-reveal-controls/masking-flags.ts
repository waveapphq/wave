/** The four system reveal settings, set through PUT /admin/secret-masking for the Function reveal specs. */

import { expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

/** Every reveal setting off: the state each spec starts from and restores. */
export const ALL_MASKED = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

export type MaskingFlags = Partial<typeof ALL_MASKED>

/** Set the given reveal settings; the others keep their value. */
export async function setMasking(request: APIRequestContext, flags: MaskingFlags): Promise<void> {
  const resp = await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: flags })
  expect(resp.ok(), `PUT /admin/secret-masking: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}
