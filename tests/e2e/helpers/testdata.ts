/**
 * The per-test Test Data HTTP surface: upload, create folder, list, read back.
 * This is the seeding and read-back anchor for every spec that touches a test's
 * own files. Sheet locators and fixture builders stay with their suite.
 */

import { expect, type APIRequestContext } from './playwright-fixtures'
import { BACKEND_URL } from './config'

export interface TestDataEntry {
  path: string
  kind: 'file' | 'dir'
  size_bytes: number
  modified_at: string
}

export interface TestDataListing {
  entries: TestDataEntry[]
  total_files: number
  total_bytes: number
}

/** The body the upload route answers with. */
export interface TestDataUpload {
  path: string
  size_bytes: number
  replaced: boolean
}

/** The body the folder route answers with: the path it created. */
export interface TestDataFolder {
  path: string
}

export interface UploadOptions {
  replace?: boolean
  mimeType?: string
}

/** Upload ONE file; the fields go path, replace, then the file part. */
export async function uploadTestData(
  request: APIRequestContext,
  testId: string,
  folder: string,
  name: string,
  content: Buffer | string,
  options: UploadOptions = {},
): Promise<TestDataUpload> {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const response = await request.post(`${BACKEND_URL}/tests/${testId}/testdata/upload`, {
    multipart: {
      path: folder,
      replace: String(options.replace ?? false),
      files: { name, mimeType: options.mimeType ?? 'application/octet-stream', buffer },
    },
  })
  const raw = await response.text()
  expect(
    response.status(),
    `POST testdata/upload "${name}" into "${folder}" answered ${response.status()}: ${raw}`,
  ).toBe(201)
  return JSON.parse(raw) as TestDataUpload
}

/** Create one folder level under the test's own root. */
export async function createTestDataFolder(
  request: APIRequestContext,
  testId: string,
  folder: string,
): Promise<TestDataFolder> {
  const response = await request.post(`${BACKEND_URL}/tests/${testId}/testdata/folders`, {
    data: { path: folder },
  })
  const raw = await response.text()
  expect(
    response.status(),
    `POST testdata/folders "${folder}" answered ${response.status()}: ${raw}`,
  ).toBe(201)
  return JSON.parse(raw) as TestDataFolder
}

/** Remove one entry from a test's own folder. */
export async function deleteTestDataEntry(
  request: APIRequestContext,
  testId: string,
  path: string,
): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}/tests/${testId}/testdata/${path}`)
  expect(
    response.status(),
    `DELETE testdata/${path} answered ${response.status()}: ${await response.text()}`,
  ).toBe(204)
}

/** One file on its way in, as every session watching sees it. */
export interface TestDataUploadRow {
  id: string
  folder: string
  name: string
  path: string
  total_bytes: number
  loaded_bytes: number
  started_at: number
  session: string
}

/** One file that did not land, kept with the test until it is dismissed. */
export interface TestDataInterruptionRow {
  id: string
  folder: string
  name: string
  path: string
  reason: string
  replace: boolean
  at: number
}

/** What is in flight for a test, and what did not land. */
export async function readTestDataUploads(
  request: APIRequestContext,
  testId: string,
): Promise<{ uploads: TestDataUploadRow[]; interruptions: TestDataInterruptionRow[] }> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}/testdata/uploads`)
  expect(
    response.ok(),
    `GET /tests/${testId}/testdata/uploads answered ${response.status()}`,
  ).toBeTruthy()
  return (await response.json()) as {
    uploads: TestDataUploadRow[]
    interruptions: TestDataInterruptionRow[]
  }
}

/** The flat listing of a test's files and folders plus its aggregates. */
export async function readTestDataListing(
  request: APIRequestContext,
  testId: string,
): Promise<TestDataListing> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}/testdata`)
  expect(
    response.ok(),
    `GET /tests/${testId}/testdata answered ${response.status()}: ${await response.text()}`,
  ).toBeTruthy()
  // The Test Data routes answer bare bodies - there is no success envelope.
  return (await response.json()) as TestDataListing
}

/** Just the listed paths, in the order the listing carries them. */
export async function listTestDataPaths(
  request: APIRequestContext,
  testId: string,
): Promise<string[]> {
  return (await readTestDataListing(request, testId)).entries.map((entry) => entry.path)
}

/** The stored bytes of one file, as text. */
export async function readTestDataContent(
  request: APIRequestContext,
  testId: string,
  relativePath: string,
): Promise<string> {
  const response = await request.get(
    `${BACKEND_URL}/tests/${testId}/testdata/content/${relativePath}`,
  )
  expect(
    response.ok(),
    `GET testdata/content/${relativePath} answered ${response.status()}`,
  ).toBeTruthy()
  return await response.text()
}

/** The stored bytes of one file, raw, for content that is not text. */
export async function readTestDataBytes(
  request: APIRequestContext,
  testId: string,
  relativePath: string,
): Promise<Buffer> {
  const response = await request.get(
    `${BACKEND_URL}/tests/${testId}/testdata/content/${relativePath}`,
  )
  expect(
    response.ok(),
    `GET testdata/content/${relativePath} answered ${response.status()}`,
  ).toBeTruthy()
  return await response.body()
}
