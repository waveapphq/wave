/**
 * Shared secret-leak canary harness.
 *
 * The surface-sweep helpers a per-plugin canary reuses so a new plugin joins
 * the leak suite by adding one entry (declaration-driven). Promoted
 * out of secret-leak-canary: the raw store inspection (at-rest bytes) plus the
 * absence assertion that a secret (and an optional shared family prefix) sits
 * nowhere in a captured surface (console, WS stream, report, export, disk).
 */

import { expect, type APIRequestContext } from './playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from './config'
import fs from 'fs'
import path from 'path'

/** The runtime mask placeholder (backend MASK_PLACEHOLDER). */
export const SECRET_MASK = '********'

/** The at-rest seal envelope prefix (a sealed literal is `wave:enc:v1:<b64>`). */
export const SECRET_ENVELOPE = 'wave:enc:v1:'

/** An envelope this instance cannot open: valid base64 whose local decryption fails. */
export const FOREIGN_ENVELOPE = 'wave:enc:v1:Zm9yZWlnbi1lbnZlbG9wZS1nYXJiYWdl'

/** Assert none of `needles` (nor an optional shared `family` prefix that no
 *  base64 envelope body can contain) sits in `haystack`. */
export function expectNoSecret(
  haystack: string,
  where: string,
  needles: string[],
  family?: string,
): void {
  for (const needle of needles) {
    expect(haystack, `${where} leaked secret ${needle}`).not.toContain(needle)
  }
  if (family) {
    expect(haystack, `${where} leaked a ${family} family secret`).not.toContain(family)
  }
}

/** Every file (recursive) under `dir`; empty when the dir is absent. */
export function listStoreFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** Every store file whose raw bytes contain the needle. */
export function sweepStore(needle: string): string[] {
  return listStoreFiles(STORAGE_BASE_PATH).filter((file) =>
    fs.readFileSync(file).includes(needle),
  )
}

/** Concatenated raw bytes of every file under `dir` (at-rest envelope / canary checks). */
export function dirBytes(dir: string): Buffer {
  return Buffer.concat(listStoreFiles(dir).map((file) => fs.readFileSync(file)))
}

/** How an export or a backup writes secret values. */
export type SecretsMode = 'mask' | 'encrypted' | 'plaintext'

/** Every `key` field of the objects named `name` anywhere in a document: a Function's
 *  parameters and locals at any depth, every stored version included. */
export function declaredFields(document: unknown, name: string, key: string): unknown[] {
  const found: unknown[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.name === name && key in record) found.push(record[key])
    Object.values(record).forEach(walk)
  }
  walk(document)
  return found
}

/** Each value reads as the mode writes a secret: the mask, a sealed envelope, or the plain value. */
export function expectSecretUnderMode(
  values: unknown[],
  mode: SecretsMode,
  plain: string,
  where: string,
): void {
  expect(values.length, `${where} carries the secret`).toBeGreaterThan(0)
  for (const value of values) {
    if (mode === 'mask') expect(value, `${where} (mask)`).toBe(SECRET_MASK)
    else if (mode === 'encrypted') expect(String(value), `${where} (encrypted)`).toMatch(/^wave:enc:v1:/)
    else expect(value, `${where} (plaintext)`).toBe(plain)
  }
}

/** A JSON export: its raw text and the parsed document. */
export interface JsonExport {
  text: string
  doc: unknown
}

/** One Test exported as JSON under a secrets mode (POST /tests/export). */
export async function exportTestJson(
  request: APIRequestContext,
  testId: string,
  mode: SecretsMode,
): Promise<JsonExport> {
  const resp = await request.post(`${BACKEND_URL}/tests/export`, {
    data: { test_ids: [testId], format: 'json', secrets: mode },
  })
  expect(resp.ok(), `Test export (${mode}) failed: ${resp.status()}`).toBeTruthy()
  const text = await resp.text()
  return { text, doc: JSON.parse(text) }
}

/** One library Function exported as JSON under a secrets mode, every version included. */
export async function exportFunctionJson(
  request: APIRequestContext,
  functionId: string,
  mode: SecretsMode,
): Promise<JsonExport> {
  const resp = await request.get(
    `${BACKEND_URL}/functions/${functionId}/export?format=json&secrets=${mode}`,
  )
  expect(resp.ok(), `Function export (${mode}) failed: ${resp.status()}`).toBeTruthy()
  const text = await resp.text()
  return { text, doc: JSON.parse(text) }
}

/** A JSON backup archive of one entity type, stored uncompressed so its bytes are searchable. */
export async function backupArchive(
  request: APIRequestContext,
  entityType: 'tests' | 'functions',
  mode: SecretsMode,
): Promise<Buffer> {
  const resp = await request.post(`${BACKEND_URL}/api/backup/create`, {
    data: { entity_types: [entityType], format: 'json', compression_method: 'stored', secrets: mode },
  })
  expect(resp.ok(), `backup (${entityType}, ${mode}) failed: ${resp.status()}`).toBeTruthy()
  return Buffer.from(await resp.body())
}
