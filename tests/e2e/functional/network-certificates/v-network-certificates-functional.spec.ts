/**
 * V-NET-CERT-FUNCTIONAL: Settings > Network > Certificates decides what a blank CA trusts.
 * Design Decisions: NET-5, NET-6, NET-7, NET-8
 * REQ: REQ-4.5.16, REQ-4.7.16, REQ-4.7.17
 *
 * One fixture runs three verify-on HTTP GETs, each inside its own Try/Catch, against the tls-lab
 * chain (root -> intermediate -> leaf): CA blank to the full-chain port, CA blank to the leaf-only
 * port, and CA set to the WAVE Test CA (which never signed the chain) to the full-chain port.
 *
 * Pass Criteria:
 * 1. The fixture passes run validation with zero errors.
 * 2. Built-in list only: both blank-CA requests and the block-CA request fail with the exact
 *    `Certificate verification failed: no trusted issuer found for certificate "..."` text, and
 *    each blank-CA block logs exactly `Trusting WAVE's built-in certificate list ({label})` at DEBUG.
 * 3. Add certificate, paste the chain intermediate: one Intermediate row; Add + Save stores it
 *    (read back); both blank-CA requests return 200 and log
 *    `Trusting WAVE's built-in certificate list ({label}) and 1 additional certificate`.
 * 4. Trash the intermediate and drop the chain root as a DER file: the text area shows the PEM
 *    the API returned and one Root row; Add + Save stores only the root; the full-chain request
 *    returns 200 and the leaf-only request fails naming the leaf.
 * 5. The block whose CA is set fails against the full-chain port in every state, including while
 *    Settings trusts the chain root, and logs no trust line (a block CA is the only trust).
 * 6. Pasting a private key shows exactly `The text contains a private key; paste certificates only`
 *    with no rows; re-pasting the saved root lists it "Already added" with its checkbox disabled.
 * 7. Host store: when the WAVE host has a store, selecting it + Save stores `host` and the run logs
 *    `Trusting this WAVE host's certificate store {path} and 1 additional certificate`; when it has
 *    none, the card is disabled and the change set is refused with the exact no-store message.
 * 8. Config file: with a host store, selecting it with a pasted root + Save writes
 *    `public_source: host` into the stack's config file (nothing before Save) while
 *    `<data>/network/certificates.yaml` holds `certificates` and no `public_source`; the network
 *    reset writes `public_source: builtin` back and empties the Additional Certificates. Without a
 *    host store the refused change leaves the config file at `builtin`.
 */

import { X509Certificate } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { importFixtureTest } from '../../helpers/fixture-import'
import { getLogEntries, setConsoleMinimumLevel, type LogEntry } from '../../helpers/log-reader'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { configSection, stackPaths } from '../../helpers/config-file'
import { resetNetworkSettings } from '../../helpers/network-settings'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  TLS_LAB_CHAIN_INTERMEDIATE_PEM,
  TLS_LAB_CHAIN_ROOT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'

const CERTIFICATES_URL = `${BACKEND_URL}/network/certificates`

const ROOT_NAME = 'WAVE E2E Chain Root CA'
const INTERMEDIATE_NAME = 'WAVE E2E Chain Intermediate CA'
const NO_ISSUER = 'Certificate verification failed: no trusted issuer found for certificate'
const INTERMEDIATE_UNTRUSTED = `${NO_ISSUER} "CN=${INTERMEDIATE_NAME}, O=WAVE Test"`
const LEAF_UNTRUSTED = `${NO_ISSUER} "CN=tls-lab, O=WAVE Test"`
const PRIVATE_KEY_MESSAGE = 'The text contains a private key; paste certificates only'
const HOST_STORE_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/tls/cacert.pem',
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
  '/etc/ssl/cert.pem',
]

const FULL_PASSED = 'chain-full passed status=200'
const FULL_FAILED = `chain-full caught msg=${INTERMEDIATE_UNTRUSTED}`
const LEAF_PASSED = 'chain-leaf passed status=200'
const LEAF_FAILED = `chain-leaf caught msg=${LEAF_UNTRUSTED}`
const BLOCK_CA_FAILED = `chain-blockca caught msg=${INTERMEDIATE_UNTRUSTED}`

interface CertificatesView {
  settings: {
    public_source: string
    builtin: { label: string; count: number }
    host_store: { path: string | null; count: number; last_changed: string | null }
  }
  additional: Array<{ id: string; name: string; organization: string; type: string; expires: string }>
}

interface ParseResult {
  certificates: Array<{ id: string; name: string; type: string; pem: string }>
  errors: Array<{ index: number | null; message: string }>
}

interface Expected {
  full: string
  leaf: string
  done: string
  trust: string
}

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.variables.ca_pem.value = CA_CERT_PEM
  return fixture
}

async function readCertificates(request: APIRequestContext): Promise<CertificatesView> {
  const response = await request.get(CERTIFICATES_URL)
  const text = await response.text()
  expect(response.ok(), `GET /network/certificates: ${response.status()} ${text}`).toBeTruthy()
  const body = JSON.parse(text)
  return (body.data ?? body) as CertificatesView
}

const withoutSpace = (pem: string) => pem.replace(/\s+/g, '')

const sourceLineOf = (source: string): string[] => [`    public_source: ${source}`]

/** The `network.certificates.public_source` line as the config file holds it. */
function sourceLines(configFile: string): string[] {
  return configSection(configFile, 'network')
    .split('\n')
    .filter((line) => /^\s+public_source:/.test(line))
}

/** The Additional Certificates file holds `certificates` and nothing of the public source. */
function expectCertificatesOnly(certificatesFile: string): void {
  const text = fs.readFileSync(certificatesFile, 'utf-8')
  const keys = text.split('\n').flatMap((line) => /^([A-Za-z_][\w-]*):/.exec(line)?.[1] ?? [])
  expect(keys, 'the certificates file holds the certificates only').toEqual(['certificates'])
  expect(text, 'the certificates file never holds the public source').not.toContain('public_source')
}

async function openCertificatesPage(page: Page): Promise<Locator> {
  await page.goto('/settings/network/certificates')
  const tab = page.getByTestId('network-certificates-tab')
  await expect(tab.getByRole('radiogroup', { name: 'Public Certificate Authorities' })).toBeVisible({
    timeout: 15_000,
  })
  return tab
}

function additionalRows(tab: Locator): Locator {
  return tab.getByTestId('additional-certificates-table').getByTestId('certificate-row')
}

async function openAddDialog(page: Page, tab: Locator): Promise<Locator> {
  await tab.getByRole('button', { name: 'Add certificate', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add Certificate' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function pasteInto(page: Page, dialog: Locator, text: string): Promise<ParseResult> {
  const parsed = page.waitForResponse(
    (r) => r.url().endsWith('/network/certificates/parse') && r.request().method() === 'POST',
  )
  await dialog.getByLabel('Certificate PEM').fill(text)
  const response = await parsed
  const body = await response.json()
  return (body.data ?? body) as ParseResult
}

async function savePage(page: Page, tab: Locator): Promise<void> {
  const save = tab.getByRole('button', { name: 'Save', exact: true })
  const patched = page.waitForResponse(
    (r) => r.url().endsWith('/network/certificates') && r.request().method() === 'PATCH',
  )
  await save.click()
  const response = await patched
  expect(response.ok(), `PATCH /network/certificates: ${response.status()} ${await response.text()}`).toBeTruthy()
  await expect(save).toBeDisabled()
}

/** Open the Test on a fresh workbench, run it and return the console once the summary line lands. */
async function runChain(page: Page, testId: string): Promise<LogEntry[]> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  // The trust line is DEBUG (REQ-4.5.16).
  await setConsoleMinimumLevel(page, 'DEBUG')
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
  // At DEBUG the summary text also rides the Log block's echo lines, so the harvest waits for the INFO line.
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = await getLogEntries(page)
        return entries.some((e) => e.level === 'INFO' && e.message.startsWith('chain-done '))
      },
      { timeout: 30_000, message: 'expected the console to render the chain-done line' },
    )
    .toBe(true)
  const dump = entries.map((e) => `${e.level} ${e.source} ${e.message}`).join('\n')
  expect(await status.getAttribute('data-status'), dump).toBe('passed')
  return entries
}

async function expectChainRun(page: Page, entries: LogEntry[], expected: Expected): Promise<void> {
  const messages = entries.map((e) => e.message)
  const dump = messages.join('\n')
  const lines = (prefix: string) => messages.filter((m) => m.startsWith(prefix))
  expect(lines('chain-full '), dump).toEqual([expected.full])
  expect(lines('chain-leaf '), dump).toEqual([expected.leaf])
  expect(lines('chain-blockca '), dump).toEqual([BLOCK_CA_FAILED])
  expect(lines('chain-done '), dump).toEqual([expected.done])
  // One DEBUG line per blank-CA block; the block whose CA is set never consults Settings.
  const trustLines = entries
    .filter((e) => e.message.startsWith('Trusting '))
    .map((e) => `${e.level} ${e.message}`)
  expect(trustLines, dump).toEqual([`DEBUG ${expected.trust}`, `DEBUG ${expected.trust}`])

  const nodeStatus = (id: string) => page.locator(`[data-testid="workflow-node-${id}"]`)
  const statusOf = (line: string) => (line.includes(' passed status=200') ? 'success' : 'failed')
  await expect(nodeStatus('http-full')).toHaveAttribute('data-execution-status', statusOf(expected.full))
  await expect(nodeStatus('http-leaf')).toHaveAttribute('data-execution-status', statusOf(expected.leaf))
  await expect(nodeStatus('http-blockca')).toHaveAttribute('data-execution-status', 'failed')
}

test.describe('V-NET-CERT-FUNCTIONAL: certificate trust for a blank CA (tls-lab chain)', () => {
  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test('built-in list, pasted intermediate, dropped DER root, block CA, dialog checks, host store', async ({
    page,
  }) => {
    test.setTimeout(360_000)
    const testId = await importFixtureTest(page, loadFixture(), { injectHttp: true })
    const initial = await readCertificates(page.request)
    const label = initial.settings.builtin.label
    const builtinTrust = `Trusting WAVE's built-in certificate list (${label})`
    const oneAdditional = ' and 1 additional certificate'

    await test.step('2. built-in list only: every request fails with the exact verification text', async () => {
      expect(initial.settings.public_source).toBe('builtin')
      expect(initial.additional).toEqual([])
      const entries = await runChain(page, testId)
      await expectChainRun(page, entries, {
        full: FULL_FAILED,
        leaf: LEAF_FAILED,
        done: 'chain-done full=0 leaf=0 blockca=0',
        trust: builtinTrust,
      })
    })

    await test.step('3. paste the intermediate, Add, Save: both blank-CA requests return 200', async () => {
      const tab = await openCertificatesPage(page)
      await expect(tab.getByText('No additional certificates', { exact: true })).toBeVisible()
      const dialog = await openAddDialog(page, tab)
      const parsed = await pasteInto(page, dialog, TLS_LAB_CHAIN_INTERMEDIATE_PEM)
      expect(parsed.errors).toEqual([])
      expect(parsed.certificates.map((c) => [c.name, c.type])).toEqual([[INTERMEDIATE_NAME, 'Intermediate']])

      const rows = dialog.getByTestId('certificate-row')
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByRole('cell', { name: 'Intermediate', exact: true })).toBeVisible()
      await expect(rows.first().getByTestId('row-checkbox')).toBeChecked()
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(dialog).toBeHidden()

      await expect(additionalRows(tab)).toHaveCount(1)
      await expect(additionalRows(tab).first()).toContainText(INTERMEDIATE_NAME)
      await savePage(page, tab)

      const saved = await readCertificates(page.request)
      expect(saved.additional.map((r) => [r.id, r.name, r.type])).toEqual([
        [parsed.certificates[0].id, INTERMEDIATE_NAME, 'Intermediate'],
      ])

      const entries = await runChain(page, testId)
      await expectChainRun(page, entries, {
        full: FULL_PASSED,
        leaf: LEAF_PASSED,
        done: 'chain-done full=200 leaf=200 blockca=0',
        trust: `${builtinTrust}${oneAdditional}`,
      })
    })

    let rootId = ''
    await test.step('4. trash the intermediate, drop the root as DER, Save: only the full chain passes', async () => {
      const tab = await openCertificatesPage(page)
      await expect(additionalRows(tab)).toHaveCount(1)
      await tab.getByRole('button', { name: `Remove ${INTERMEDIATE_NAME}`, exact: true }).click()
      await expect(additionalRows(tab)).toHaveCount(0)

      const dialog = await openAddDialog(page, tab)
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-chain-root-'))
      let parsed: ParseResult
      try {
        const derPath = path.join(folder, 'chain-root.cer')
        fs.writeFileSync(derPath, new X509Certificate(TLS_LAB_CHAIN_ROOT_PEM).raw)
        const transfer = await page.evaluateHandle(
          ({ name, encoded }) => {
            const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
            const data = new DataTransfer()
            data.items.add(new File([bytes], name, { type: 'application/pkix-cert' }))
            return data
          },
          { name: 'chain-root.cer', encoded: fs.readFileSync(derPath).toString('base64') },
        )
        const uploaded = page.waitForResponse(
          (r) =>
            r.url().endsWith('/network/certificates/parse') &&
            (r.request().headers()['content-type'] ?? '').startsWith('multipart/form-data'),
        )
        const zone = dialog.getByRole('button', { name: /Click or drop file here/ })
        await zone.dispatchEvent('dragover', { dataTransfer: transfer })
        await zone.dispatchEvent('drop', { dataTransfer: transfer })
        const body = await (await uploaded).json()
        parsed = (body.data ?? body) as ParseResult
      } finally {
        fs.rmSync(folder, { recursive: true, force: true })
      }

      expect(parsed.errors).toEqual([])
      expect(parsed.certificates.map((c) => [c.name, c.type])).toEqual([[ROOT_NAME, 'Root']])
      expect(withoutSpace(parsed.certificates[0].pem)).toBe(withoutSpace(TLS_LAB_CHAIN_ROOT_PEM))
      rootId = parsed.certificates[0].id
      await expect(dialog.getByLabel('Certificate PEM')).toHaveValue(parsed.certificates[0].pem)
      await expect(dialog.getByRole('button', { name: /chain-root\.cer/ })).toBeVisible()
      const rows = dialog.getByTestId('certificate-row')
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByRole('cell', { name: 'Root', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(dialog).toBeHidden()

      await expect(additionalRows(tab)).toHaveCount(1)
      await expect(additionalRows(tab).first()).toContainText(ROOT_NAME)
      await savePage(page, tab)

      const saved = await readCertificates(page.request)
      expect(saved.additional.map((r) => [r.id, r.name, r.type])).toEqual([[rootId, ROOT_NAME, 'Root']])

      const entries = await runChain(page, testId)
      // 5. The block CA request fails here too, while Settings trusts the chain root.
      await expectChainRun(page, entries, {
        full: FULL_PASSED,
        leaf: LEAF_FAILED,
        done: 'chain-done full=200 leaf=0 blockca=0',
        trust: `${builtinTrust}${oneAdditional}`,
      })
    })

    await test.step('6. dialog: a private key is refused; the saved root reads "Already added"', async () => {
      const tab = await openCertificatesPage(page)
      const dialog = await openAddDialog(page, tab)
      const add = dialog.getByRole('button', { name: 'Add', exact: true })
      const problems = dialog.locator('[aria-live="polite"] p')
      const rows = dialog.getByTestId('certificate-row')

      const refused = await pasteInto(page, dialog, TLS_LAB_CLIENT_KEY_PEM)
      expect(refused).toEqual({ certificates: [], errors: [{ index: null, message: PRIVATE_KEY_MESSAGE }] })
      await expect(problems).toHaveText([PRIVATE_KEY_MESSAGE])
      await expect(rows).toHaveCount(0)
      await expect(add).toBeDisabled()

      const again = await pasteInto(page, dialog, TLS_LAB_CHAIN_ROOT_PEM)
      expect(again.certificates.map((c) => c.id)).toEqual([rootId])
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByText('Already added', { exact: true })).toBeVisible()
      await expect(rows.first().getByTestId('row-checkbox')).toBeDisabled()
      await expect(rows.first().getByTestId('row-checkbox')).not.toBeChecked()
      await expect(problems).toHaveCount(0)
      await expect(add).toBeDisabled()

      await dialog.getByTestId('edit-dialog-cancel').click()
      await expect(dialog).toBeHidden()
      await expect(tab.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
      const unchanged = await readCertificates(page.request)
      expect(unchanged.additional.map((r) => r.id)).toEqual([rootId])
    })

    await test.step("7. this WAVE host's store: the run names the store, or the change is refused", async () => {
      const storePath = (await readCertificates(page.request)).settings.host_store.path
      test.info().annotations.push({ type: 'host store', description: storePath ?? 'none' })
      const tab = await openCertificatesPage(page)
      const hostCard = tab.getByRole('radio', { name: "This WAVE host's store", exact: true })

      if (storePath === null) {
        await expect(hostCard).toBeDisabled()
        await expect(tab.getByText('No certificate store found on this WAVE host', { exact: true }).first()).toBeVisible()
        const refused = await page.request.patch(CERTIFICATES_URL, { data: { public_source: 'host' } })
        expect(refused.status()).toBe(400)
        expect(await refused.text()).toContain(
          JSON.stringify(`No certificate store found on this WAVE host: looked in ${HOST_STORE_PATHS.join(', ')}`),
        )
        return
      }

      await hostCard.click()
      await expect(hostCard).toBeChecked()
      await expect(tab.getByRole('heading', { name: "WAVE Host's Store", exact: true })).toBeVisible()
      await expect(tab.getByText(storePath, { exact: true })).toBeVisible()
      await savePage(page, tab)
      const saved = await readCertificates(page.request)
      expect(saved.settings.public_source).toBe('host')
      expect(saved.additional.map((r) => r.id)).toEqual([rootId])

      const entries = await runChain(page, testId)
      await expectChainRun(page, entries, {
        full: FULL_PASSED,
        leaf: LEAF_FAILED,
        done: 'chain-done full=200 leaf=0 blockca=0',
        trust: `Trusting this WAVE host's certificate store ${storePath}${oneAdditional}`,
      })
    })

    await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  })

  test('the public source is saved to the config file, never to the certificates file; a reset puts builtin back', async ({
    page,
  }) => {
    const { configFile, dataFolder } = await stackPaths(page.request)
    const certificatesFile = path.join(dataFolder, 'network', 'certificates.yaml')
    expect(sourceLines(configFile), 'the stack starts from the built-in list').toEqual(sourceLineOf('builtin'))

    const storePath = (await readCertificates(page.request)).settings.host_store.path
    test.info().annotations.push({ type: 'host store', description: storePath ?? 'none' })
    const tab = await openCertificatesPage(page)
    const hostCard = tab.getByRole('radio', { name: "This WAVE host's store", exact: true })

    if (storePath === null) {
      // NET-6: without a host store the card is disabled, so the page cannot send the change.
      await expect(hostCard).toBeDisabled()
      const refused = await page.request.patch(CERTIFICATES_URL, { data: { public_source: 'host' } })
      expect(refused.status()).toBe(400)
      expect(sourceLines(configFile), 'a refused source never reaches the config file').toEqual(
        sourceLineOf('builtin'),
      )
      return
    }

    await test.step('the host store and a pasted root are staged; nothing is written before Save', async () => {
      const dialog = await openAddDialog(page, tab)
      const parsed = await pasteInto(page, dialog, TLS_LAB_CHAIN_ROOT_PEM)
      expect(parsed.errors).toEqual([])
      expect(parsed.certificates.map((c) => [c.name, c.type])).toEqual([[ROOT_NAME, 'Root']])
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(additionalRows(tab)).toHaveCount(1)
      await hostCard.click()
      await expect(hostCard).toBeChecked()
      expect(sourceLines(configFile), 'nothing is written before Save').toEqual(sourceLineOf('builtin'))
    })

    await test.step('Save writes the source to the config file and the certificate to the data folder', async () => {
      await savePage(page, tab)
      expect(sourceLines(configFile)).toEqual(sourceLineOf('host'))
      expectCertificatesOnly(certificatesFile)
      const saved = await readCertificates(page.request)
      expect(saved.settings.public_source).toBe('host')
      expect(saved.additional.map((r) => [r.name, r.type])).toEqual([[ROOT_NAME, 'Root']])
    })

    await test.step('the network reset writes builtin back and empties the Additional Certificates', async () => {
      await resetNetworkSettings(BACKEND_URL)
      expect(sourceLines(configFile)).toEqual(sourceLineOf('builtin'))
      expectCertificatesOnly(certificatesFile)
      const view = await readCertificates(page.request)
      expect(view.settings.public_source).toBe('builtin')
      expect(view.additional).toEqual([])
      const reloaded = await openCertificatesPage(page)
      await expect(reloaded.getByRole('radio', { name: "WAVE's built-in list", exact: true })).toBeChecked()
      await expect(reloaded.getByText('No additional certificates', { exact: true })).toBeVisible()
    })
  })
})
