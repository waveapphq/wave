// @vitest-environment node
/**
 * The unit test run's console policy: every console line a test does not assert on reaches
 * the run's output, so the local frontend CI fails on it.
 */

import { describe, it, expect } from 'vitest'
import config from '../vite.config'

describe('vitest config', () => {
  it('drops no console output from the test run', () => {
    expect(config.test).toBeDefined()
    expect(config.test).not.toHaveProperty('onConsoleLog')
  })
})
