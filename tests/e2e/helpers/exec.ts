import { execSync } from 'child_process';
import path from 'path';
import { BACKEND_PORT, FRONTEND_PORT } from './config';

// Project root is 2 levels up from tests/e2e/helpers/
const projectRoot = path.resolve(__dirname, '../../..');

/**
 * Execute a shell command from the project root.
 * Output is suppressed by default for cleaner test logs.
 * Set WAVE_VERBOSE=1 to see command output during tests.
 *
 * Passes WAVE_E2E_BACKEND_PORT and WAVE_E2E_FRONTEND_PORT to child processes
 * to ensure shell scripts use the same ports as the test configuration.
 */
export function exec(cmd: string): void {
  const verbose = process.env.WAVE_VERBOSE === '1';
  execSync(cmd, {
    stdio: verbose ? 'inherit' : 'pipe',
    cwd: projectRoot,
    env: {
      ...process.env,
      WAVE_E2E_BACKEND_PORT: BACKEND_PORT,
      WAVE_E2E_FRONTEND_PORT: FRONTEND_PORT,
    },
  });
}
