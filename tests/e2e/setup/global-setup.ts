/** Resets the shard backend's DB and network settings once before all tests; the reset trusts the stack's SSH hosts. */

import { execSync } from 'child_process'
import path from 'path'
import { BACKEND_PORT, BACKEND_URL } from '../helpers/config'
import { resetNetworkSettings } from '../helpers/network-settings'

const projectRoot = path.resolve(__dirname, '../../..')

export default async function globalSetup() {
  console.log('[Global Setup] Resetting the backend...')

  try {
    execSync('./tests/e2e/scripts/reset.sh', {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 30000,
      env: { ...process.env, WAVE_E2E_BACKEND_PORT: BACKEND_PORT },
    })
    await resetNetworkSettings(BACKEND_URL)
  } catch (error) {
    console.error(`[Global Setup] Failed to reset the backend (port ${BACKEND_PORT}):`, error)
    throw error
  }

  console.log('[Global Setup] Backend reset, stack SSH hosts trusted')
}
