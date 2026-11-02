/** A second WAVE backend for one test: its own config file, data folder and port (REQ-4.7.15). */

import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'

export const BACKEND_DIR = path.resolve(__dirname, '../../../backend')

/** The tracked example as shipped: its `security.secret_key` is empty, so WAVE refuses to start on it. */
export const SHIPPED_EXAMPLE_CONFIG_TEXT = fs.readFileSync(
  path.join(BACKEND_DIR, 'config', 'config.example.yaml'),
  'utf-8'
)

const EMPTY_KEY_LINE = '  secret_key: ""'

function withThrowawayKey(text: string): string {
  const found = text.split('\n').filter((line) => line === EMPTY_KEY_LINE).length
  if (found !== 1) {
    throw new Error(
      `Expected exactly one line '${EMPTY_KEY_LINE}' in backend/config/config.example.yaml, found ${found}`
    )
  }
  const keyLine = `  secret_key: "${randomBytes(32).toString('base64')}"`
  return text
    .split('\n')
    .map((line) => (line === EMPTY_KEY_LINE ? keyLine : line))
    .join('\n')
}

/** The example with this run's throwaway key: every spawned backend's config file starts from it. */
export const EXAMPLE_CONFIG_TEXT = withThrowawayKey(SHIPPED_EXAMPLE_CONFIG_TEXT)

const STARTUP_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 10_000
const POLL_MS = 200

export interface SpawnedBackend {
  baseUrl: string
  configFile: string
  dataDir: string
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string
  /** `null` while the process runs or after a signal ended it. */
  readonly exitCode: number | null
  /** Ends the process; the folder stays until `removeSpawnedBackends`. */
  stop(): Promise<void>
}

export interface SpawnOptions {
  /** The config file's text: `EXAMPLE_CONFIG_TEXT` when omitted, no file at all when `null`. */
  configText?: string | null
  /** Variables set in the backend's environment on top of the helper's own. */
  env?: Record<string, string>
  /** Start again on an earlier backend's config file and data folder, as they are. */
  reuse?: SpawnedBackend
}

const folders: string[] = []
const running: SpawnedBackend[] = []

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function answersHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

/** The stack's own `WAVE_*` variables never reach a spawned backend. */
function backendEnvironment(configFile: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('WAVE_'))
  )
  const env = {
    ...inherited,
    PYTHONUNBUFFERED: '1',
    WAVE_ADMIN_ALLOWED: 'true',
    WAVE_CONFIG_FILE: configFile,
    ...extra,
  }
  // Without a named file WAVE reads the config file of the checkout it runs from.
  if (!env.WAVE_CONFIG_FILE) throw new Error('A spawned backend needs WAVE_CONFIG_FILE')
  return env
}

function newFolder(configText: string | null): { configFile: string; dataDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-cfg-'))
  folders.push(root)
  const configFile = path.join(root, 'config', 'config.yaml')
  fs.mkdirSync(path.dirname(configFile))
  if (configText !== null) fs.writeFileSync(configFile, configText)
  // The example's `storage.base_path: ../data` starts at the config file's folder.
  return { configFile, dataDir: path.join(root, 'data') }
}

/** Start a backend and wait until it answers `/health` or its process ends. */
export async function spawnBackend(options: SpawnOptions = {}): Promise<SpawnedBackend> {
  const { configFile, dataDir } = options.reuse ?? newFolder(
    options.configText === undefined ? EXAMPLE_CONFIG_TEXT : options.configText
  )
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const child = spawn(
    'poetry',
    ['run', 'uvicorn', 'wavecore.api.app:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: BACKEND_DIR,
      env: backendEnvironment(configFile, options.env ?? {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so stop() reaches uvicorn behind the poetry launcher.
      detached: true,
    }
  )

  let text = ''
  child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()))
  let ended = false
  const end = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      text += `\n${String(error)}`
      ended = true
      resolve()
    })
    child.once('close', () => {
      ended = true
      resolve()
    })
  })

  const signal = (name: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name)
    } catch {
      // The group is already gone.
    }
  }

  const backend: SpawnedBackend = {
    baseUrl,
    configFile,
    dataDir,
    output: () => text,
    get exitCode() {
      return child.exitCode
    },
    stop: async () => {
      if (ended) return
      signal('SIGTERM')
      await Promise.race([end, delay(STOP_GRACE_MS)])
      if (!ended) {
        signal('SIGKILL')
        await end
      }
    },
  }
  running.push(backend)

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (!ended && !(await answersHealth(baseUrl))) {
    if (Date.now() > deadline) {
      await backend.stop()
      throw new Error(`The spawned backend did not answer /health in 60 s:\n${text}`)
    }
    await Promise.race([end, delay(POLL_MS)])
  }
  return backend
}

/** Stop every spawned backend and remove every folder made for one. */
export async function removeSpawnedBackends(): Promise<void> {
  await Promise.all(running.splice(0).map((backend) => backend.stop()))
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
}
