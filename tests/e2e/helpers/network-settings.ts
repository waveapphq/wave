/** The network settings every stack starts from: WAVE's trusted SSH hosts for the strict host-key specs (REQ-4.5.14). */

import fs from 'fs'
import path from 'path'
import { SSH_MAIN_PORT, SSH_MAIN_SERVICE, SSH_NO_FWD_PORT, SSH_TARGET_HOST } from './config'

const SSH_KEYS_DIR = path.resolve(__dirname, '../services/sshd/keys')

function publicKeyOf(file: string): string {
  const [algorithm, blob] = fs.readFileSync(path.join(SSH_KEYS_DIR, file), 'utf-8').trim().split(/\s+/)
  return `${algorithm} ${blob}`
}

/** The host key every sshd variant offers. */
export const SSH_HOST_KEY = publicKeyOf('ssh_host_ed25519_key.pub')

/** A valid ED25519 key that is not the host's (the committed client key). */
export const WRONG_HOST_KEY = publicKeyOf('client_ed25519.pub')

interface TrustedHostAddition {
  host: string
  port: number
  key_type: 'ED25519'
  key: string
}

/** Port 9447 (`sshd-no-sftp`) is never trusted, so `accept-new` makes first contact there. */
export const STACK_TRUSTED_HOSTS: readonly TrustedHostAddition[] = [
  { host: SSH_TARGET_HOST, port: Number(SSH_MAIN_PORT), key_type: 'ED25519', key: SSH_HOST_KEY },
  { host: SSH_TARGET_HOST, port: Number(SSH_NO_FWD_PORT), key_type: 'ED25519', key: WRONG_HOST_KEY },
  { host: SSH_MAIN_SERVICE, port: 22, key_type: 'ED25519', key: SSH_HOST_KEY },
]

interface Reply {
  ok: boolean
  status: number
  text: string
}

async function send(method: string, url: string, body?: unknown): Promise<Reply> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { ok: response.ok, status: response.status, text: await response.text() }
}

function expectOk(reply: Reply, what: string): void {
  if (!reply.ok) throw new Error(`${what} failed: ${reply.status} ${reply.text}`)
}

/** Clear the host key policy, certificates and trusted hosts, then trust STACK_TRUSTED_HOSTS. */
export async function resetNetworkSettings(backendUrl: string): Promise<void> {
  const status = await send('GET', `${backendUrl}/admin/status`)
  expectOk(status, 'GET /admin/status')
  // The reset needs admin mode; leave it as it was found.
  const adminWasOn = JSON.parse(status.text).enabled === true
  if (!adminWasOn) {
    expectOk(
      await send('POST', `${backendUrl}/admin/enable`, { reason: 'E2E network settings reset' }),
      'POST /admin/enable'
    )
  }
  const reset = await send('POST', `${backendUrl}/admin/reset`, {
    confirm: true,
    scope: ['network', 'ssh-hosts'],
  })
  if (!adminWasOn) expectOk(await send('POST', `${backendUrl}/admin/disable`), 'POST /admin/disable')
  expectOk(reset, 'POST /admin/reset')
  expectOk(
    await send('PATCH', `${backendUrl}/network/ssh-hosts`, { add: STACK_TRUSTED_HOSTS }),
    'PATCH /network/ssh-hosts'
  )
}
