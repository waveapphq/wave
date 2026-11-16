/**
 * V-PYTHON-TOOLS-INTERPRETER: an Interpreter row that names a program that is not Python
 * Design Decisions: PYRUN-19 (completion, documentation and rename are server-backed; a row
 *   that does not resolve to a local interpreter falls back to WAVE's own interpreter)
 * REQ: REQ-3.4.2.2
 *
 * The script editor's completion and F2 rename ask the server, which introspects the
 * interpreter the block's Interpreter row names. A row naming a program that exists but is
 * not Python is no local interpreter, so it answers exactly what a row naming nothing does.
 *
 * Pass Criteria:
 * 1. Rename with such a row answers 200 with the edits WAVE's own interpreter gives.
 * 2. Completion with such a row answers the members WAVE's own interpreter gives.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/python-block/v-python-tools-interpreter-functional.spec.ts
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'

// A program on every host the suite runs on that is not Python: it exits at once.
const NOT_PYTHON = '/bin/true'
const NO_FILE = '/no/such/python3'
const RENAME_SCRIPT = 'count = 1\ncount += 1\nprint(count)\n'
const MEMBER_SCRIPT = 'import os\nos.'

interface Answer {
  status: number
  body: { success?: boolean; data?: Record<string, unknown> }
}

async function ask(request: APIRequestContext, route: string, data: Record<string, unknown>): Promise<Answer> {
  const response = await request.post(`${BACKEND_URL}/python-tools/${route}`, { data })
  return { status: response.status(), body: await response.json().catch(() => ({})) }
}

function rename(request: APIRequestContext, interpreter: string): Promise<Answer> {
  return ask(request, 'rename', {
    script: RENAME_SCRIPT,
    line: 1,
    column: 0,
    new_name: 'total',
    interpreter,
  })
}

async function labels(request: APIRequestContext, interpreter: string): Promise<string[]> {
  const answer = await ask(request, 'complete', { script: MEMBER_SCRIPT, line: 2, column: 3, interpreter })
  expect(answer.status, `complete with ${JSON.stringify(interpreter)}: ${JSON.stringify(answer.body)}`).toBe(200)
  return ((answer.body.data?.items ?? []) as Array<{ label: string }>).map((item) => item.label)
}

test.describe('V-PYTHON-TOOLS-INTERPRETER: a program that is not Python is no interpreter', () => {
  test('rename with an Interpreter row naming a program that is not Python gives the edits of WAVE\'s own', async ({
    request,
  }) => {
    const own = await rename(request, '')
    expect(own.status, `rename under WAVE's own interpreter: ${JSON.stringify(own.body)}`).toBe(200)
    expect((own.body.data?.edits as unknown[]).length, 'the script holds three uses of count').toBe(3)

    const named = await rename(request, NOT_PYTHON)

    expect(named.status, `rename with ${NOT_PYTHON} must answer like WAVE's own: ${JSON.stringify(named.body)}`).toBe(200)
    expect(named.body.data).toEqual(own.body.data)
  })

  test('completion with an Interpreter row naming a program that is not Python gives the members of WAVE\'s own', async ({
    request,
  }) => {
    const own = await labels(request, NO_FILE)
    expect(own, 'WAVE\'s own interpreter offers os.getcwd after a dot').toContain('getcwd')

    expect(await labels(request, NOT_PYTHON)).toEqual(own)
  })
})
