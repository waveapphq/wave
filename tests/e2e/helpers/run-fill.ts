/** The run fill specs: their Test Data, the kwok workload they roll, and stored-field reads. */

import { expect, type APIRequestContext } from './playwright-fixtures'
import { K8S_ADMIN_TOKEN, K8S_API_HOST, K8S_API_PORT } from './config'
import { buildWorkbook, type SheetCell } from './table-transform'
import { uploadTestData } from './testdata'

export const RUN_FILL_NOTE = 'run-fill-note.txt'
export const RUN_FILL_NOTE_TEXT = 'run fill note\nsecond line\n'
export const RUN_FILL_BOOK = 'run-fill-book.xlsx'
export const RUN_FILL_BOOK_ROWS: ReadonlyArray<readonly SheetCell[]> = [
  ['id', 'qty'],
  ['a', 1],
  ['b', 2],
]

/** kubectl's restart stamp on a workload's pod template. */
export const RESTARTED_AT = 'kubectl.kubernetes.io/restartedAt'

const K8S_ROOT = `https://${K8S_API_HOST}:${K8S_API_PORT}`
const K8S_HEADERS = { Authorization: `Bearer ${K8S_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }

export type StoredBlock = { id: string; data: Record<string, any> }

/** Upload the note and the workbook the File I/O and Excel Blocks read. */
export async function uploadRunFillData(request: APIRequestContext, testId: string): Promise<void> {
  await uploadTestData(request, testId, '', RUN_FILL_NOTE, RUN_FILL_NOTE_TEXT)
  await uploadTestData(request, testId, '', RUN_FILL_BOOK, buildWorkbook(RUN_FILL_BOOK_ROWS, 'Items'))
}

const deploymentPath = (namespace: string, name: string): string =>
  `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`

/** A one-replica Deployment the K8s Rollout Block restarts. */
export async function createDeployment(request: APIRequestContext, namespace: string, name: string): Promise<void> {
  const resp = await request.post(`${K8S_ROOT}/apis/apps/v1/namespaces/${namespace}/deployments`, {
    headers: K8S_HEADERS,
    data: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: { containers: [{ name: 'app', image: 'busybox:1.36' }] },
        },
      },
    },
  })
  expect(resp.ok(), `create Deployment ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

/** The restart stamp the Deployment's pod template carries, if any. */
export async function restartStamp(
  request: APIRequestContext,
  namespace: string,
  name: string,
): Promise<string | undefined> {
  const resp = await request.get(`${K8S_ROOT}${deploymentPath(namespace, name)}`, { headers: K8S_HEADERS })
  expect(resp.ok(), `read Deployment ${name}: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, any>
  return body.spec?.template?.metadata?.annotations?.[RESTARTED_AT]
}

/** One stored Block, by id or by Name. */
export function storedBlock(test: Record<string, any>, idOrName: string): StoredBlock {
  const nodes = test.workflow.nodes as StoredBlock[]
  const found = nodes.find((node) => node.id === idOrName || node.data.label === idOrName)
  expect(found, `Block ${idOrName} is stored`).toBeTruthy()
  return found!
}

/** The stored values hold none of the named fields: the run never writes a default back. */
export function expectLeftOut(block: StoredBlock, names: readonly string[]): void {
  const values = (block.data.config?.values ?? {}) as Record<string, unknown>
  for (const name of names) {
    expect(Object.keys(values), `${String(block.data.label)} stores no '${name}'`).not.toContain(name)
  }
}

/** The console line HTTP Request prints as it sends: the method it used and the timeout. */
export function httpSendLine(method: string, url: string, timeoutSeconds: number): string {
  return `HTTP ${method} ${url} (timeout: ${timeoutSeconds}s)`
}

/** The console line K8s Rollout prints for a restart of a Deployment. */
export function deploymentRestartLine(name: string): string {
  return `Rollout restart on deployment.apps/${name}`
}
