/**
 * Dark Mode Setup for Playwright Tests
 *
 * Resets the database before dark mode tests run.
 * This ensures empty-state-dark tests have a clean database
 * after fixture-desktop tests have seeded data.
 */

import { execSync } from 'child_process'
import path from 'path'
import { test as setup } from '@playwright/test'

const projectRoot = path.resolve(__dirname, '../../..')

setup('reset database for dark mode tests', async () => {
  console.log('[Dark Mode Setup] Resetting database for dark mode tests...')

  try {
    execSync('./tests/e2e/scripts/reset.sh', {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: 30000,
    })
    console.log('[Dark Mode Setup] Database reset complete')
  } catch (error) {
    console.error('[Dark Mode Setup] Failed to reset database:', error)
    throw error
  }
})
