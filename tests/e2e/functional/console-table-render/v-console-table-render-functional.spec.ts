/**
 * V-CONSOLE-TABLE-RENDER-FUNCTIONAL: a Table logged to the run console renders as
 * pretty-printed, capped, aligned columns, and a registered secret in a cell is
 * masked BEFORE the column widths are measured.
 *
 * REQ: REQ-3.5.5.1-4 (table type) / REQ-3.1.3.5 (secret masking on every runtime surface)
 *
 * The rendering contract lives in `backend/wavecore/core/table.py` (`Table.__str__`)
 * and the whole-message backstop in `backend/wavecore/core/logging/formatter.py`
 * (`cap_message`). Both are pinned by backend unit tests
 * (`tests/core/test_table.py::TestPrettyLayout`, `tests/core/test_log_formatter.py`);
 * the golden lines below are the same wording, asserted against the console text of a
 * real run so the whole path - plugin output, variable binding, expression, console
 * stream - is covered end to end.
 *
 * What each leg discriminates:
 *  - align  : a 28-character cell shows IN FULL and the column types read `string` /
 *             `integer` / `float` in full, under one dash rule PER COLUMN. The previous
 *             renderer cut cells at 15 characters with no marker, abbreviated types to
 *             three letters and drew a single fixed-width rule, so any of those three
 *             fails this leg. Numbers are right-aligned, strings left-aligned.
 *  - rowcap : more than 10 rows renders 10 and announces `... and N more rows`.
 *  - colcap : more than 12 columns renders 12 and announces `... and N more columns`.
 *  - cutcap : a cell over 200 characters is replaced by `a N-character value`, and a
 *             cell between 40 and 200 is cut to the 40-character column with `...`.
 *  - backstop: a message over 16384 characters is cut and announces
 *             `... and N more characters`; the tail token is gone.
 *  - secret : a registered secret in a cell shows the mask AND the column is the width
 *             of the mask, not of the real value. Masking after layout would leave the
 *             column 31 wide (the plaintext length), which the width assertion catches.
 *             The second test proves the same for the STORED execution record, which is
 *             where the rendered table was being written unmasked.
 *
 * Assertions read each entry's `data-copy-text` (via getLogCopyTexts), never its text
 * content: only the copy attribute preserves the newlines the layout is made of.
 *
 * Known and accepted, NOT asserted: below roughly an 1800px window the console line
 * wraps and the columns stop lining up on screen. The copy text is unaffected.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/console-table-render/v-console-table-render-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { importFixtureTest, importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, runTrackedTest, startRun } from '../../helpers/k8s-run'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// The renderer's caps, mirrored from the backend contract
// ---------------------------------------------------------------------------

const MAX_MESSAGE_DISPLAY = 16_384
const MESSAGE_MARKER_BUDGET = 64
const BACKSTOP_BODY_LEN = MAX_MESSAGE_DISPLAY - MESSAGE_MARKER_BUDGET

const BACKSTOP_HEAD = 'CAPMSG-HEAD-'
const BACKSTOP_TAIL = '-CAPMSG-TAIL'
const BACKSTOP_TEXT =
  BACKSTOP_HEAD +
  'F'.repeat(20_000 - BACKSTOP_HEAD.length - BACKSTOP_TAIL.length) +
  BACKSTOP_TAIL
const BACKSTOP_CUT = BACKSTOP_TEXT.length - BACKSTOP_BODY_LEN

/** The two over-cap cells the fixture's cut leg carries (same literals as fixture.json). */
const CUT_WIDE = 'cutcap-width-' + 'w'.repeat(47)
const CUT_HUGE = 'cutcap-huge-' + 'h'.repeat(238)

/** The registered secret and the cell that carries it (same literals as fixture.json). */
const SECRET = 'SEKRET-console-table-4f7a91b3c5'
const SECRET_FAMILY = 'SEKRET-'

const RUN_MARKER = 'CONSOLE-TABLE-RENDER-DONE'

// ---------------------------------------------------------------------------
// Golden renderings (verbatim from Table.__str__ for these fixtures)
// ---------------------------------------------------------------------------

const ALIGN_GOLDEN = [
  'Table (2 rows x 3 columns)',
  'align_resource                align_replicas  align_ratio',
  'string                               integer        float',
  '----------------------------  --------------  -----------',
  'kubernetes-dashboard-metrics               3          0.5',
  'web                                       12        10.25',
]

const ROWCAP_GOLDEN = [
  'Table (12 rows x 1 columns)',
  'rowcap_idx',
  'string',
  '----------',
  'rowcap-r01',
  'rowcap-r02',
  'rowcap-r03',
  'rowcap-r04',
  'rowcap-r05',
  'rowcap-r06',
  'rowcap-r07',
  'rowcap-r08',
  'rowcap-r09',
  'rowcap-r10',
  '... and 2 more rows',
]

const CUTCAP_GOLDEN = [
  'Table (1 rows x 2 columns)',
  'cutcap_wide                               cutcap_huge',
  'string                                    string',
  '----------------------------------------  ---------------------',
  'cutcap-width-wwwwwwwwwwwwwwwwwwwwwwww...  a 250-character value',
]

const SECRET_GOLDEN = [
  'Table (1 rows x 3 columns)',
  'lbl              tok           prt',
  'string           string    integer',
  '---------------  --------  -------',
  'secret-leg-prod  ********     8080',
]

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
  // The over-cap message is built here rather than stored, so fixture.json stays readable.
  const variables = fixture.variables as Record<string, { value: unknown }>
  variables.backstop_text.value = BACKSTOP_TEXT
  return fixture
}

// ---------------------------------------------------------------------------
// Reading a rendered table out of the console
// ---------------------------------------------------------------------------

/**
 * The console entry carrying one rendered table, split into lines. Line 0 keeps the
 * entry's timestamp / level / source prefix; every later line starts at column 0,
 * which is what the alignment assertions read.
 */
function tableEntryLines(copyTexts: string[], title: string, token: string): string[] {
  const matches = copyTexts.filter((t) => t.includes(title) && t.includes(token))
  expect(
    matches.length,
    `expected exactly one console entry carrying "${title}" and "${token}". Console:\n${copyTexts.join('\n---\n')}`,
  ).toBe(1)
  return matches[0].split('\n')
}

/** One column width per dash run in the rule line. Fails if the rule is a single run. */
function ruleWidths(rule: string): number[] {
  const runs = rule.split('  ')
  for (const run of runs) {
    expect(run, `the rule line must be dash runs separated by two spaces, got "${rule}"`).toMatch(
      /^-+$/,
    )
  }
  return runs.map((run) => run.length)
}

/** The character offset each column starts at, given the widths and the two-space gap. */
function columnOffsets(widths: number[]): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const width of widths) {
    offsets.push(cursor)
    cursor += width + 2
  }
  return offsets
}

/** One column's field on one line, padding included. */
function fieldAt(line: string, widths: number[], index: number): string {
  const start = columnOffsets(widths)[index]
  return line.slice(start, start + widths[index])
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

test.describe('V-CONSOLE-TABLE-RENDER-FUNCTIONAL', () => {
  test('a logged table renders as aligned columns and every cap announces what it cut', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(page.request)
    await importValidateAndNavigate(page, loadFixture())

    const status = await startRun(page)
    await finishRun(page, status, RUN_MARKER)

    const copyTexts = await getLogCopyTexts(page)
    expect(
      copyTexts.some((t) => t.includes(RUN_MARKER)),
      'the console did not render the run bookend marker',
    ).toBeTruthy()

    await test.step('aligned columns, values in full, types in full, one rule per column', async () => {
      const lines = tableEntryLines(copyTexts, ALIGN_GOLDEN[0], 'align_resource')
      const widths = ruleWidths(lines[3])

      expect(
        widths.length,
        'one dash run per column - a single fixed-width rule is the old renderer',
      ).toBe(3)
      expect(
        widths[0],
        'the first column is as wide as its longest value (28), not a fixed width',
      ).toBe(28)

      expect(
        fieldAt(lines[4], widths, 0).trim(),
        'a value longer than 15 characters must show in full, with no truncation marker',
      ).toBe('kubernetes-dashboard-metrics')

      expect(
        [0, 1, 2].map((i) => fieldAt(lines[2], widths, i).trim()),
        'the types line spells each column type out in full',
      ).toEqual(['string', 'integer', 'float'])

      const stringField = fieldAt(lines[5], widths, 0)
      expect(stringField.startsWith('web'), 'a string column is left-aligned').toBeTruthy()
      expect(stringField.trimEnd(), 'a string column pads on the right').toBe('web')

      const numberField = fieldAt(lines[5], widths, 1)
      expect(numberField.endsWith('12'), 'a number column is right-aligned').toBeTruthy()
      expect(numberField.trimStart(), 'a number column pads on the left').toBe('12')

      expect(lines[0].endsWith(ALIGN_GOLDEN[0]), `line 0 was "${lines[0]}"`).toBeTruthy()
      expect(lines.slice(1)).toEqual(ALIGN_GOLDEN.slice(1))
    })

    await test.step('the row cap renders 10 rows and announces the 2 it left out', async () => {
      const lines = tableEntryLines(copyTexts, ROWCAP_GOLDEN[0], 'rowcap_idx')

      expect(lines[lines.length - 1], 'the row cap must announce what it cut').toBe(
        '... and 2 more rows',
      )
      const entry = lines.join('\n')
      expect(entry, 'row 11 is past the cap and must not render').not.toContain('rowcap-r11')
      expect(entry, 'row 12 is past the cap and must not render').not.toContain('rowcap-r12')

      expect(lines[0].endsWith(ROWCAP_GOLDEN[0]), `line 0 was "${lines[0]}"`).toBeTruthy()
      expect(lines.slice(1)).toEqual(ROWCAP_GOLDEN.slice(1))
    })

    await test.step('the column cap renders 12 columns and announces the 2 it left out', async () => {
      const lines = tableEntryLines(copyTexts, 'Table (1 rows x 14 columns)', 'colcap_c01')
      const widths = ruleWidths(lines[3])

      expect(widths.length, 'the column cap renders 12 columns').toBe(12)
      expect(lines[lines.length - 1], 'the column cap must announce what it cut').toBe(
        '... and 2 more columns',
      )
      expect(fieldAt(lines[1], widths, 11).trim(), 'the 12th column is the last one shown').toBe(
        'colcap_c12',
      )

      const entry = lines.join('\n')
      expect(entry, 'column 13 is past the cap and must not render').not.toContain('colcap_c13')
      expect(entry, "column 13's value is past the cap and must not render").not.toContain(
        'colcap_v13',
      )
    })

    await test.step('the per-cell cap states the length and the per-column cap cuts with an ellipsis', async () => {
      const lines = tableEntryLines(copyTexts, CUTCAP_GOLDEN[0], 'cutcap_wide')
      const widths = ruleWidths(lines[3])

      expect(widths[0], 'a column is never wider than 40 characters').toBe(40)

      const wideField = fieldAt(lines[4], widths, 0)
      expect(wideField.length, 'the over-width cell fills the capped column exactly').toBe(40)
      expect(
        wideField.endsWith('...'),
        'the per-column cap marks its cut with an ellipsis',
      ).toBeTruthy()
      expect(wideField, 'the cut keeps the first 37 characters').toBe(CUT_WIDE.slice(0, 37) + '...')

      const entry = lines.join('\n')
      expect(entry, 'the over-cell-length cap states the length it replaced').toContain(
        'a 250-character value',
      )
      expect(entry, 'no part of the 250-character cell survives the cap').not.toContain(
        'cutcap-huge-',
      )
      expect(entry, 'the whole 60-character value must not render').not.toContain(CUT_WIDE)
      expect(entry, 'the whole 250-character value must not render').not.toContain(CUT_HUGE)

      expect(lines[0].endsWith(CUTCAP_GOLDEN[0]), `line 0 was "${lines[0]}"`).toBeTruthy()
      expect(lines.slice(1)).toEqual(CUTCAP_GOLDEN.slice(1))
    })

    await test.step('the whole-message backstop cuts and announces how much it left out', async () => {
      const matches = copyTexts.filter((t) => t.includes(BACKSTOP_HEAD))
      expect(
        matches.length,
        `expected exactly one console entry carrying "${BACKSTOP_HEAD}"`,
      ).toBe(1)
      const entry = matches[0]

      expect(
        entry.endsWith(`... and ${BACKSTOP_CUT} more characters`),
        `the backstop must announce what it cut. Entry tail: "${entry.slice(-80)}"`,
      ).toBeTruthy()
      expect(entry, 'the head of the message survives the cut').toContain(BACKSTOP_HEAD)
      expect(entry, 'the tail of the message is past the backstop and must be gone').not.toContain(
        BACKSTOP_TAIL,
      )
    })

    await test.step('a registered secret masks, and its column is the width of the mask', async () => {
      const lines = tableEntryLines(copyTexts, SECRET_GOLDEN[0], 'secret-leg-prod')
      const widths = ruleWidths(lines[3])

      expect(
        widths[1],
        'the secret column is the width of the mask - masking after layout would leave it ' +
          `${SECRET.length} wide and disclose the secret's length`,
      ).toBe(SECRET_MASK.length)
      expect(widths[1], 'the column must not be the width of the real value').not.toBe(
        SECRET.length,
      )
      expect(fieldAt(lines[4], widths, 1), 'the secret cell renders as the mask').toBe(SECRET_MASK)

      const entry = lines.join('\n')
      expectNoSecret(entry, 'the rendered console table', [SECRET], SECRET_FAMILY)

      expect(lines[0].endsWith(SECRET_GOLDEN[0]), `line 0 was "${lines[0]}"`).toBeTruthy()
      expect(lines.slice(1)).toEqual(SECRET_GOLDEN.slice(1))
    })
  })

  test('the rendered table written to the stored execution record is masked too', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(page.request)
    const testId = await importFixtureTest(page, loadFixture())

    const { executionId, verdict } = await runTrackedTest(page.request, testId)
    expect(verdict, `tracked run ${executionId} did not pass`).toBe('passed')

    const resp = await page.request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
    expect(
      resp.ok(),
      `GET /executions/${executionId}/variables failed: ${resp.status()}`,
    ).toBeTruthy()
    const body = (await resp.json()) as Record<string, unknown>
    const variables = ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>

    const stored = variables.secret_table
    expect(
      typeof stored,
      `the stored record keeps the table as its rendered text. Got: ${JSON.stringify(stored).slice(0, 200)}`,
    ).toBe('string')

    const lines = (stored as string).split('\n')
    const widths = ruleWidths(lines[3])

    expect(
      widths[1],
      'the stored table masks each cell before it measures the column, same as the console',
    ).toBe(SECRET_MASK.length)
    expect(lines, 'the stored table is the same rendering the console carries').toEqual(
      SECRET_GOLDEN,
    )

    expectNoSecret(
      JSON.stringify(variables),
      'the stored execution variables',
      [SECRET],
      SECRET_FAMILY,
    )
  })
})
