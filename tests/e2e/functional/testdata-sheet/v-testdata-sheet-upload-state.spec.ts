/**
 * V-TESTDATA-SHEET-UPLOAD-STATE: the upload state routes the sheet reads answer for the test they name
 * Design Decisions: TDATA-14, TDATA-15
 * REQ: REQ-3.4.3.2, REQ-5.2.4.12
 *
 * No page is opened: the case calls the routes the sheet uses for what is in
 * flight and what did not land, and reads their answers. The saved test is
 * created through POST /tests and deleted in teardown.
 *
 * Pass Criteria:
 * 1. A saved test with nothing in flight answers two empty lists.
 * 2. For a test that does not exist, the listing, reading what is in flight,
 *    stopping an upload, clearing a notice and recording a refusal each answer
 *    404 with error code `NOT_FOUND` and the message `Test not found: {id}`.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/testdata-sheet/v-testdata-sheet-upload-state.spec.ts
 */

import { randomUUID } from 'crypto'
import type { APIResponse } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { readTestDataUploads } from '../../helpers/testdata'
import { createOwnTest, deleteOwnTest, loadFixture } from './helpers'

let ownTestId: string | null = null

test.afterEach(async ({ request }) => {
  await deleteOwnTest(request, ownTestId)
  ownTestId = null
})

async function expectUnknownTest(response: APIResponse, testId: string, route: string): Promise<void> {
  expect(response.status(), `${route} answers 404`).toBe(404)
  const body = await response.json()
  expect(body.error.code, `${route} answers NOT_FOUND`).toBe('NOT_FOUND')
  expect(body.error.message, `${route} names the test`).toBe(`Test not found: ${testId}`)
}

test.describe('Test Data sheet - upload state', () => {
  test('every upload state route answers not found for a test that does not exist', async ({ page, request }) => {
    const own = await createOwnTest(page, loadFixture())
    ownTestId = own.id
    expect(await readTestDataUploads(request, own.id)).toEqual({ uploads: [], interruptions: [] })

    const unknown = randomUUID()
    const base = `${BACKEND_URL}/tests/${unknown}/testdata`
    await expectUnknownTest(await request.get(base), unknown, 'GET testdata')
    await expectUnknownTest(await request.get(`${base}/uploads`), unknown, 'GET uploads')
    await expectUnknownTest(
      await request.post(`${base}/uploads/u1/cancel`, { data: { session: 'e2e-session' } }),
      unknown,
      'POST cancel'
    )
    await expectUnknownTest(await request.post(`${base}/uploads/u1/dismiss`), unknown, 'POST dismiss')
    await expectUnknownTest(
      await request.post(`${base}/uploads/u1/interrupt`, { data: { name: 'huge.bin', reason: 'no room' } }),
      unknown,
      'POST interrupt'
    )
  })
})
