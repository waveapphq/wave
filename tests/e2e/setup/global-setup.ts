/**
 * Global Setup for Playwright Tests
 *
 * Runs once before all tests start. Resets every backend stack's DB so each
 * worker begins with a clean slate, then resets its network settings, which
 * also trusts the stack's SSH hosts in WAVE's own list (STACK_TRUSTED_HOSTS).
 * N_STACKS matches playwright.config.ts - one reset per spawned backend.
 */

import { execSync } from 'child_process'
import path from 'path'
import { resetNetworkSettings } from '../helpers/network-settings'

const projectRoot = path.resolve(__dirname, '../../..')

export default async function globalSetup() {
  const nStacks = Number(process.env.WAVE_E2E_N_STACKS || '4')
  const backendBasePort = Number(process.env.WAVE_E2E_BACKEND_PORT || '8000')
  const frontendBasePort = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')

  console.log(`[Global Setup] Resetting ${nStacks} backend stack(s)...`)

  for (let i = 0; i < nStacks; i++) {
    const bePort = backendBasePort + i
    const fePort = frontendBasePort + i
    try {
      execSync('./tests/e2e/scripts/reset.sh', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 30000,
        env: {
          ...process.env,
          WAVE_E2E_BACKEND_PORT: String(bePort),
          WAVE_E2E_FRONTEND_PORT: String(fePort),
        },
      })
      await resetNetworkSettings(`http://localhost:${bePort}`)
    } catch (error) {
      console.error(`[Global Setup] Failed to reset stack ${i} (port ${bePort}):`, error)
      throw error
    }
  }

  console.log('[Global Setup] All stacks reset, stack SSH hosts trusted')
}
