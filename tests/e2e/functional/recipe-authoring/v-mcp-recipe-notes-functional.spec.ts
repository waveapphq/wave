/**
 * V-MCP-RECIPE-NOTES-FUNCTIONAL: a Note keeps its place in a recipe, in the flow or beside it,
 * and a readback names what it cannot write
 * Wireframes: none (recipe format over MCP)
 * Design Decisions: none (recipe compile and readback)
 * REQ: REQ-5.2.7.3, REQ-5.2.7.6
 *
 * Pass Criteria:
 * 1. A hand-built Test with a Note wired between two Logs reads back expressible with a `note`
 *    step between the two log steps; an amend with that untouched readback succeeds and the
 *    stored wires still run Log, Note, Log.
 * 2. The served guide says a note step stands in the flow, that Notes with no connection go in
 *    `notes:` at the top and in a Function entry, and how a readback writes them.
 * 3. A note step in a For body is stored wired in from the step before it and out to the step
 *    after it, a `notes:` Note is stored with no wire, and the readback is the written recipe.
 * 4. A note step in a local Function flow is stored wired there, and the readback is the
 *    written recipe.
 * 5. A `notes:` item `- delay: 10` is refused with INVALID_CONSTRUCT and a note step after a
 *    Halt with UNREACHABLE_BLOCK, each with its exact text, and nothing is stored.
 * 6. A recipe with `flow: []` beside one Note creates a Test holding only that Note, and the
 *    readback is the written recipe.
 * 7. A Block after a Halt in a local Function is refused at compile with UNREACHABLE_BLOCK by
 *    validate_recipe and by create_test_from_recipe, and nothing is stored.
 * 8. A Log nothing reaches on a hand-built local Function canvas is named in `inexpressible`,
 *    and the amend is refused with the Log still stored.
 * 9. A wired Note holding a description and a disabled mark reads back with both named in
 *    `inexpressible`, and the amend is refused with both still stored.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-notes-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { runToken } from '../../helpers/element-types'
import {
  chainEdges,
  cleanUp,
  createTest,
  localFunctionBlock,
  storedBlock,
  testIdsNamed,
} from '../../helpers/fn-block'
import { rawPersistTest } from '../../helpers/fn-seed'
import { resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  NOT_REACHED,
  allWires,
  asReadBack,
  functionCanvas,
  logAt,
  logStep,
  noteAt,
  noteStep,
  noteWithText,
  readBack,
  recipeOf,
  refusal,
  startMcp,
  storedCanvas,
  tool,
  wiresAt,
  type Doc,
} from './notes-helpers'

const GUIDE_TEXTS = [
  'flow: [] # required; ordered list of steps, empty only beside notes',
  'notes: [] # optional; Notes beside the flow, with no connection',
  "A `note` step stands in the flow at its place, wired in and out like a `delay`, so it can hold the place of a block not added yet. When the run reaches it, it passes the flow straight on, with no outputs and no side effects. A Note with no connection at all is an annotation only, and the run never reaches it: write it in `notes:` beside `flow:`, at the top of the recipe for the test's canvas or in a Function entry for that Function's canvas. Each item of `notes:` is a note step, with `label` and `key` beside it as in the flow; any other item is refused (`INVALID_CONSTRUCT`).",
  'A readback writes each Note where it is: in the flow at its place, or in the `notes:` of its canvas. A test whose canvas holds only Notes reads back as `flow: []` beside its `notes:`; `flow` may be empty only when `notes:` holds a Note, else it is refused (`EMPTY_FLOW`). A Note that is connected but never reached from the start is reported in `inexpressible`, like any unreachable block.',
  "A Function entry takes `notes:` beside its `flow:` for the Notes on the Function's canvas that nothing connects to, as the test does.",
]

const NOT_EXPRESSIBLE = 'TARGET_NOT_RECIPE_EXPRESSIBLE'

function name(what: string): string {
  return `zz-mcp-notes-${what}-${runToken()}`
}

test.describe('V-MCP-RECIPE-NOTES-FUNCTIONAL: a Note keeps its place in a recipe', () => {
  const testIds: string[] = []

  /** Keep the id of a Test an answer says was stored, so it is deleted after. */
  function keep(answer: Doc): void {
    if (typeof answer.test_id === 'string') testIds.push(answer.test_id)
  }

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    await cleanUp(request, testIds)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a Note wired between two Blocks reads back at its place and its readback amends', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const chain = [
      'start -> log first',
      'log first -> note Add the login here',
      'note Add the login here -> log second',
    ].sort()

    const testId = await createTest(request, {
      name: name('wired'),
      nodes: [
        logAt('log-1', 'Log', 'first', 100),
        noteAt('note-1', 'Add the login here', 'yellow', 250),
        logAt('log-2', 'Log', 'second', 400),
      ],
    })
    testIds.push(testId)
    expect(allWires(await storedCanvas(request, testId)), 'the seed wires Log, Note, Log').toEqual(chain)

    let readback = ''
    await test.step('get_test_recipe writes the Note as a note step between the two logs', () => {
      const { answer, recipe } = readBack(testId)
      expect(answer.expressible, JSON.stringify(answer)).toBe(true)
      expect(answer.inexpressible).toEqual([])
      const flow = (recipe.flow ?? []) as Doc[]
      expect(flow, String(answer.recipe)).toHaveLength(3)
      expect(flow[0]).toMatchObject(logStep('first'))
      expect(flow[1], 'the Note reads back as a note step at its place').toEqual(
        noteStep('Add the login here', 'yellow'),
      )
      expect(flow[2]).toMatchObject(logStep('second'))
      readback = String(answer.recipe)
    })

    await test.step('an amend with the untouched readback keeps the Note between the same Blocks', async () => {
      const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: readback })
      expect(amended.amended, JSON.stringify(amended)).toBe(true)
      expect(allWires(await storedCanvas(request, testId))).toEqual(chain)
    })
  })

  test('the served guide places a Note in the flow or beside it', async ({ page, request }) => {
    await startMcp(page, request)
    const guide = String(tool('get_recipe_guide', {}).guide ?? '').replace(/\s+/g, ' ')
    expect(guide.length, 'the guide is served').toBeGreaterThan(0)
    for (const text of GUIDE_TEXTS) {
      expect(guide.includes(text), `the guide says: ${text}`).toBe(true)
    }
  })

  test('a note step in a For body is wired there and a Note in notes: has no wire', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const doc = {
      test: { name: name('loop'), description: 'A note step in a loop body and a Note beside the flow' },
      flow: [
        {
          for: {
            count: 2,
            body: [logStep('loop-before'), noteStep('Loop placeholder', 'slate'), logStep('loop-after')],
          },
        },
        logStep('after-loop'),
      ],
      notes: [noteStep('Test owner note', 'blue')],
    }

    const created = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
    keep(created)
    expect(created.created, JSON.stringify(created)).toBe(true)
    const testId = String(created.test_id)

    await test.step('the stored body Note is wired in and out; the Note beside the flow has no wire', async () => {
      const canvas = await storedCanvas(request, testId)
      const placeholder = noteWithText(canvas, 'Loop placeholder')
      expect(wiresAt(canvas, placeholder.id), JSON.stringify(canvas.edges)).toEqual(
        ['log loop-before -> note Loop placeholder', 'note Loop placeholder -> log loop-after'].sort(),
      )
      const owner = noteWithText(canvas, 'Test owner note')
      expect(wiresAt(canvas, owner.id), JSON.stringify(canvas.edges)).toEqual([])
    })

    await test.step('get_test_recipe writes each Note back where it was written', () => {
      const { answer, recipe } = readBack(testId)
      expect(answer.inexpressible, JSON.stringify(answer)).toEqual([])
      expect(answer.expressible).toBe(true)
      expect(recipe, String(answer.recipe)).toEqual(asReadBack(doc))
    })
  })

  test('a note step in a local Function flow is wired on the Function canvas', async ({ page, request }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const doc = {
      test: { name: name('function-flow'), description: 'A note step in a local Function flow' },
      functions: [
        {
          name: 'noted_helper',
          inputs: [],
          outputs: [],
          flow: [logStep('helper-before'), noteStep('Helper placeholder', 'slate'), logStep('helper-after')],
        },
      ],
      flow: [{ function: 'noted_helper' }],
    }

    const created = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
    keep(created)
    expect(created.created, JSON.stringify(created)).toBe(true)
    const testId = String(created.test_id)

    await test.step('the Function canvas runs Log, Note, Log', async () => {
      const inner = functionCanvas(await storedCanvas(request, testId))
      noteWithText(inner, 'Helper placeholder')
      expect(allWires(inner), JSON.stringify(inner.edges)).toEqual(
        [
          'start -> log helper-before',
          'log helper-before -> note Helper placeholder',
          'note Helper placeholder -> log helper-after',
        ].sort(),
      )
    })

    await test.step('get_test_recipe writes the note step back in the Function flow', () => {
      const { answer, recipe } = readBack(testId)
      expect(answer.inexpressible, JSON.stringify(answer)).toEqual([])
      expect(answer.expressible).toBe(true)
      expect(recipe, String(answer.recipe)).toEqual(asReadBack(doc))
    })
  })

  test('a notes: item that is not a note step and a note step after a Halt are refused', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)

    await test.step('a delay in notes: is refused and nothing is stored', async () => {
      const testName = name('notes-delay')
      const doc = { test: { name: testName }, flow: [logStep('only')], notes: [{ delay: 10 }] }
      const answer = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
      keep(answer)
      expect(answer.findings, JSON.stringify(answer)).toEqual([
        refusal(
          'notes[0]',
          'INVALID_CONSTRUCT',
          "'notes' construct is malformed: each item must be a note step",
          "Write it as '- note: ...', or move it into flow",
        ),
      ])
      expect(answer.created).toBe(false)
      expect(await testIdsNamed(request, testName)).toEqual([])
    })

    await test.step('a note step after a Halt is refused as unreachable and nothing is stored', async () => {
      const testName = name('note-after-halt')
      const doc = { test: { name: testName }, flow: [logStep('only'), { halt: {} }, { note: 'Never reached' }] }
      const answer = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
      keep(answer)
      expect(answer.findings, JSON.stringify(answer)).toEqual([
        refusal('flow[2]', 'UNREACHABLE_BLOCK', NOT_REACHED, null),
      ])
      expect(answer.created).toBe(false)
      expect(await testIdsNamed(request, testName)).toEqual([])
    })
  })

  test('an empty flow beside one Note creates a Test that holds only that Note', async ({ page, request }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const doc = {
      test: { name: name('only-notes'), description: 'A Test that holds only a Note' },
      flow: [],
      notes: [noteStep('Write this test', 'yellow')],
    }

    const created = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
    keep(created)
    expect(created.created, JSON.stringify(created)).toBe(true)
    const testId = String(created.test_id)

    const canvas = await storedCanvas(request, testId)
    expect(canvas.nodes.map((node) => node.type)).toEqual(['noteNode'])
    noteWithText(canvas, 'Write this test')
    expect(canvas.edges).toEqual([])

    const { answer, recipe } = readBack(testId)
    expect(answer.inexpressible, JSON.stringify(answer)).toEqual([])
    expect(answer.expressible).toBe(true)
    expect(recipe, String(answer.recipe)).toEqual(asReadBack(doc))
  })

  test('a Block after a Halt in a local Function is refused at compile', async ({ page, request }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const testName = name('function-halt')
    const doc = {
      test: { name: testName },
      functions: [{ name: 'halting_helper', inputs: [], outputs: [], flow: [{ halt: {} }, logStep('after-halt')] }],
      flow: [{ function: 'halting_helper' }],
    }
    const expected = [refusal('functions[halting_helper].flow[1]', 'UNREACHABLE_BLOCK', NOT_REACHED, null)]

    const verdict = tool('validate_recipe', { recipe: recipeOf(doc) })
    expect(verdict.findings, JSON.stringify(verdict)).toEqual(expected)
    expect(verdict.valid).toBe(false)

    const answer = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
    keep(answer)
    expect(answer.findings, JSON.stringify(answer)).toEqual(expected)
    expect(answer.created).toBe(false)
    expect(await testIdsNamed(request, testName)).toEqual([])
  })

  test('an unreachable Block on a hand-built local Function canvas is named in the readback', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    // The save refuses a Block nothing reaches on a Function canvas (NODE_UNREACHABLE), so the Test is stored raw.
    const testId = await rawPersistTest(request, {
      name: name('function-unreached'),
      nodes: [
        localFunctionBlock('fn-1', 'unreached_helper', {
          nodes: [logAt('fn-log-reached', 'Log', 'reached', 100), logAt('fn-log-orphan', 'Orphan Log', 'orphan', 250)],
          edges: chainEdges(['fn-log-reached']),
        }),
      ],
      edges: chainEdges(['fn-1']),
    })
    testIds.push(testId)

    let readback = ''
    await test.step('get_test_recipe names the unreachable Log and is not expressible', () => {
      const { answer } = readBack(testId)
      expect(answer.inexpressible, JSON.stringify(answer)).toEqual([
        { what: "unreachable block 'Orphan Log'", where: 'fn-log-orphan' },
      ])
      expect(answer.expressible).toBe(false)
      readback = String(answer.recipe)
    })

    await test.step('the amend is refused and the Log stays on the Function canvas', async () => {
      const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: readback })
      expect(amended.amended, JSON.stringify(amended)).toBe(false)
      expect((amended.findings as Doc[]).map((item) => item.code)).toEqual([NOT_EXPRESSIBLE])
      const inner = functionCanvas(await storedCanvas(request, testId))
      expect(inner.nodes.map((node) => node.id).sort()).toEqual(['fn-log-orphan', 'fn-log-reached'])
    })
  })

  test('a Note description and disabled mark are named in the readback', async ({ page, request }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const testId = await createTest(request, {
      name: name('note-identity'),
      nodes: [
        logAt('log-1', 'Log', 'first', 100),
        noteAt('note-1', 'Add the login here', 'yellow', 250, { description: 'Login goes here', disabled: true }),
        logAt('log-2', 'Log', 'second', 400),
      ],
    })
    testIds.push(testId)
    const seeded = await storedBlock(request, testId, 'note-1')
    expect([seeded.description, seeded.disabled], 'the seed stores both on the Note').toEqual(['Login goes here', true])

    let readback = ''
    await test.step('get_test_recipe names the description and the disabled mark', () => {
      const { answer } = readBack(testId)
      expect(answer.inexpressible, JSON.stringify(answer)).toEqual([
        { what: "the description of block 'Note'", where: 'note-1' },
        { what: "the disabled mark of block 'Note'", where: 'note-1' },
      ])
      expect(answer.expressible).toBe(false)
      readback = String(answer.recipe)
    })

    await test.step('the amend is refused and the Note keeps both', async () => {
      const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: readback })
      expect(amended.amended, JSON.stringify(amended)).toBe(false)
      expect((amended.findings as Doc[]).map((item) => item.code)).toEqual([NOT_EXPRESSIBLE])
      const stored = await storedBlock(request, testId, 'note-1')
      expect([stored.description, stored.disabled]).toEqual(['Login goes here', true])
    })
  })
})
