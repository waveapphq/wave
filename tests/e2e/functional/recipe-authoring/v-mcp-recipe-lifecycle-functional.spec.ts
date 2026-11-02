/**
 * V-MCP-RECIPE-LIFECYCLE-FUNCTIONAL: the recipe surface an LLM actually uses,
 * end to end over the live MCP endpoint.
 * Wireframes: none (tool-surface behavior; no UI of its own)
 * Design Decisions: RUNM-7 (tracked-run shape); recipe-guide contract
 * REQ: REQ-5.2.7.16, REQ-3.5.1.11
 *
 * Guards:
 * - The packaged guide teaches item['value'] and its loop example must EXECUTE with
 *   real item values.
 * - An if with no else (or a switch with no default) wires the next sibling from the
 *   section, so a then ending in break never orphans the next block.
 * - A well-formed switch emits no spurious validator finding.
 * - The compiler keeps a switch's authored label.
 * - Sticky notes do not make a saved test read back as inexpressible.
 *
 * Pass Criteria:
 * 1. Every packaged guide example still parses through validate_recipe; the
 *    self-contained examples (01-03) validate fully clean, and the packaged
 *    switch example carries no removed `on`/`equals` key.
 * 2. The branching-loops example creates and RUNS green with real per-item
 *    log lines (no envelope repr, no vacuous pass), including its switch: only
 *    the matching case body logs and the step after the switch runs.
 * 3. Fall-through lanes execute: the step after an if-with-no-else runs, the
 *    step after a switch whose cases all miss runs through the `then` egress,
 *    and the loop tail after a then-ending-in-break runs on non-break passes.
 * 4. A note round-trips: create with a note, read the recipe back
 *    expressible with the note preserved.
 * 5. A split fail_current_scope assert in a for_each runs as a TRACKED
 *    execution: its on_fail branch records the blocking node and the loop goes
 *    on; status failed, failure report names exactly one failed test and one
 *    failed block with the assert's label and exact error, the expression
 *    detail and the FATAL verdict in the log excerpt.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

const MCP_PORT = Number(BACKEND_PORT) + 765

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function pollTerminal(
  request: APIRequestContext,
  executionId: string,
): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        status = ((((await resp.json()).data ?? {}) as { status?: string }).status ?? '') as string
        return ['passed', 'failed', 'stopped', 'skipped'].includes(status)
      },
      { timeout: 60_000, message: `execution ${executionId} should reach a terminal state` },
    )
    .toBe(true)
  return status
}

interface HistoryLog {
  level?: string
  source?: string
  message?: string
}

async function fetchLogs(
  request: APIRequestContext,
  executionId: string,
): Promise<HistoryLog[]> {
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(
    resp.ok(),
    `GET /executions/history/${executionId} failed: ${resp.status()}`,
  ).toBeTruthy()
  return (((await resp.json()).data ?? {}) as { logs?: HistoryLog[] }).logs ?? []
}

async function fetchLogMessages(
  request: APIRequestContext,
  executionId: string,
): Promise<string[]> {
  return (await fetchLogs(request, executionId)).map((entry) => entry.message ?? '')
}

/** Rendered block output only: excludes the DEBUG Inputs/Outputs echo lines,
 *  which quote the raw template before rendering. */
async function fetchRenderedMessages(
  request: APIRequestContext,
  executionId: string,
): Promise<string[]> {
  return (await fetchLogs(request, executionId))
    .filter((entry) => (entry.level ?? '').toUpperCase() !== 'DEBUG')
    .map((entry) => entry.message ?? '')
}

test.describe('V-MCP-RECIPE-LIFECYCLE-FUNCTIONAL: guide, fall-through, notes, tracked failure shape', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('packaged guide examples stay valid; the loops example runs with real item values', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const guide = callTool(MCP_PORT, 'get_recipe_guide', {})
    expect(guide.isError).toBe(false)
    const examples = (guide.payload.examples ?? []) as Array<{ name: string; recipe: string }>
    expect(examples.length).toBeGreaterThanOrEqual(5)

    let loopsRecipe = ''
    for (const example of examples) {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: example.recipe })
      expect(verdict.isError, `${example.name} crashed validate_recipe`).toBe(false)
      expect(Array.isArray(verdict.payload.findings), `${example.name} returns findings`).toBe(true)
      // 04 calls a published library Function and 05 binds profiles/secrets;
      // those references do not exist in a fresh E2E store. The self-contained
      // teaching examples must validate fully clean.
      if (/^0[123]/.test(example.name)) {
        expect(
          verdict.payload.valid,
          `${example.name} must stay valid: ${JSON.stringify(verdict.payload.findings)}`,
        ).toBe(true)
      }
      if (example.name.includes('branching-loops')) loopsRecipe = example.recipe
    }
    expect(loopsRecipe, 'the branching-loops example is packaged').toBeTruthy()
    expect(
      loopsRecipe,
      'the guide example teaches the loop-item envelope access',
    ).toContain("current_host['value']")
    // Guards the stale 'on' expression check that flagged every well-formed switch.
    expect(loopsRecipe, 'the packaged switch example drops the removed on key').not.toMatch(
      /^\s*on:/m,
    )
    expect(loopsRecipe, 'the packaged switch example drops the removed equals key').not.toMatch(
      /^\s*- equals:/m,
    )

    // Execute the example's construct set; the loop-item envelope template and
    // the switch condition shape mirror the guide.
    const name = uniqueName('Guide Loops Example')
    const recipe = `test:
  name: ${name}
  description: Executable slice of the branching-loops guide example
  tags: [e2e, recipe]
variables:
  transport: {type: string, value: TCP}
  health: {type: integer, value: 200}
  hosts: {type: array, value: [alpha, beta, gamma]}
  retries: {type: integer, value: 0}
flow:
  - if:
      when: "health == 200"
      then:
        - block: log
          settings: {message: Service healthy}
      else:
        - block: log
          settings: {message: Service down}
  - switch:
      label: Route on status
      cases:
        - when: "health == 404"
          steps:
            - block: log
              settings: {message: Not found}
        - when: "health == 200"
          steps:
            - block: log
              settings: {message: All good}
      default:
        - block: log
          settings: {message: Unexpected status}
  - block: log
    settings: {message: Status routed}
  - for:
      count: 3
      body:
        - block: log
          settings: {message: Ping attempt}
  - for:
      range: {start: 0, end: 10, step: 2}
      body:
        - block: log
          settings: {message: Even tick}
  - for_each:
      collection: {expr: "hosts"}
      capture: {item: current_host, index: host_index}
      body:
        - block: log
          settings: {message: "Checking {{ current_host['value'] }}"}
  - while:
      label: retry_loop
      conditions: "retries < 5"
      body:
        - set: {retries: {expr: "retries + 1"}}
        - if:
            when: "retries == 3"
            then:
              - break: {loop: retry_loop}
`
    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)

    const started = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: created.payload.test_id as string,
      environment: E2E_ENV_NAME,
    })
    expect(started.isError, JSON.stringify(started.payload)).toBe(false)
    const executionId = started.payload.execution_id as string
    expect(await pollTerminal(request, executionId)).toBe('passed')

    const viaMcp = callTool(MCP_PORT, 'get_execution', { execution_id: executionId })
    expect(viaMcp.payload.status).toBe('passed')

    const messages = await fetchRenderedMessages(request, executionId)
    const all = messages.join('\n')
    for (const host of ['alpha', 'beta', 'gamma']) {
      expect(all, `loop item value '${host}' reaches the log line`).toContain(`Checking ${host}`)
    }
    expect(all, 'no typed-envelope repr leaks into the rendered line').not.toMatch(
      /Checking \{/,
    )
    expect(messages.filter((m) => m === 'Ping attempt')).toHaveLength(3)
    expect(messages.filter((m) => m === 'Even tick')).toHaveLength(5)
    expect(all).toContain('Service healthy')
    expect(all).not.toContain('Service down')
    expect(all, 'the matching case body runs').toContain('All good')
    expect(all, 'a non-matching case body never runs').not.toContain('Not found')
    expect(all, 'a matching case that breaks stops before the default').not.toContain(
      'Unexpected status',
    )
    expect(all, 'the step after the switch runs through the then egress').toContain('Status routed')
  })

  test('fall-through lanes: if with no else, switch with no default, then ending in break', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const name = uniqueName('Recipe Fall-Through Lanes')
    const recipe = `test:
  name: ${name}
  description: Fall-through lanes for if with no else, incl. a then ending in break
  tags: [e2e, recipe]
variables:
  counter: {type: integer, value: 0}
  mode: {type: string, value: none}
flow:
  - if:
      when: "mode == 'never'"
      then:
        - block: log
          settings: {message: top-if-never}
  - block: log
    settings: {message: top-fallthrough}
  - while:
      label: loop_a
      conditions: "counter < 5"
      body:
        - set: {counter: {expr: "counter + 1"}}
        - if:
            when: "counter == 2"
            then:
              - break: {loop: loop_a}
        - block: log
          settings: {message: "loop-tail {{ counter }}"}
  - block: log
    settings: {message: after-loop}
`
    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
    expect(
      created.payload.created,
      `fall-through recipe must compile without orphaning any block: ${JSON.stringify(created.payload)}`,
    ).toBe(true)

    const started = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: created.payload.test_id as string,
      environment: E2E_ENV_NAME,
    })
    const executionId = started.payload.execution_id as string
    expect(await pollTerminal(request, executionId)).toBe('passed')

    const messages = await fetchLogMessages(request, executionId)
    const all = messages.join('\n')
    expect(all).not.toContain('top-if-never')
    expect(all, 'the step after an if with no else executes').toContain('top-fallthrough')
    expect(all, 'the loop tail runs on the non-break pass').toContain('loop-tail 1')
    expect(all, 'break exits before the tail on its own pass').not.toContain('loop-tail 2')
    expect(all, 'the block after the loop executes').toContain('after-loop')

    // A switch whose only case misses and that carries no default still leaves
    // through its then egress, in the graph and at runtime.
    const switchName = uniqueName('Recipe Switch Then Lane')
    const switchRecipe = `test:
  name: ${switchName}
  description: Switch with no default leaves through the then egress
  tags: [e2e, recipe]
variables:
  mode: {type: string, value: none}
flow:
  - switch:
      label: Route mode
      cases:
        - when: "mode == 'other'"
          steps:
            - block: log
              settings: {message: switch-case-other}
  - block: log
    settings: {message: switch-next-step}
`
    const switchCreated = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: switchRecipe })
    expect(
      switchCreated.payload.created,
      `switch-no-default must not orphan the next block: ${JSON.stringify(switchCreated.payload)}`,
    ).toBe(true)
    const saved = await request.get(
      `${BACKEND_URL}/tests/${switchCreated.payload.test_id as string}`,
    )
    const workflow = (((await saved.json()).data ?? {}) as {
      workflow?: { nodes?: Array<any>; edges?: Array<any> }
    }).workflow
    const switchNode = (workflow?.nodes ?? []).find(
      (node) => node?.data?.elementType === 'switch-case',
    )
    const nextLog = (workflow?.nodes ?? []).find(
      (node) => JSON.stringify(node?.data?.config ?? {}).includes('switch-next-step'),
    )
    expect(switchNode, 'the switch node persisted').toBeTruthy()
    expect(nextLog, 'the next step persisted').toBeTruthy()
    // Guards the compiler dropping an authored switch label.
    expect(switchNode.data.label, 'the authored switch label persisted').toBe('Route mode')
    expect(
      (workflow?.edges ?? []).some(
        (edge) =>
          edge.source === switchNode.id &&
          edge.target === nextLog.id &&
          edge.sourceHandle === 'then',
      ),
      'the next step is wired from the switch then egress',
    ).toBe(true)

    const switchStarted = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: switchCreated.payload.test_id as string,
      environment: E2E_ENV_NAME,
    })
    const switchExecutionId = switchStarted.payload.execution_id as string
    expect(await pollTerminal(request, switchExecutionId)).toBe('passed')

    const switchFlow = (await fetchLogMessages(request, switchExecutionId)).join('\n')
    expect(switchFlow, 'a case whose condition misses never runs').not.toContain(
      'switch-case-other',
    )
    expect(switchFlow, 'the step after a switch that matched nothing executes').toContain(
      'switch-next-step',
    )
  })

  test('a sticky note round-trips through the recipe readback', async ({ page, request }) => {
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const name = uniqueName('Recipe Note Roundtrip')
    const noteText = 'Reviewed by run-mirror e2e'
    const recipe = `test:
  name: ${name}
  description: Note round-trip
  tags: [e2e, recipe]
flow:
  - block: log
    settings: {message: note-rt-1}
  - note: {text: ${noteText}, color: yellow}
  - block: log
    settings: {message: note-rt-2}
`
    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
    expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)

    const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: created.payload.test_id as string })
    expect(readback.isError, JSON.stringify(readback.payload)).toBe(false)
    expect(
      readback.payload.expressible,
      `a note must not make the test inexpressible: ${JSON.stringify(readback.payload.inexpressible)}`,
    ).toBe(true)
    expect(readback.payload.recipe as string).toContain(noteText)
  })

  test('tracked scope-fail run: failed status and the exact failure-report shape', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const name = uniqueName('Tracked Scope Fail Gate')
    const recipe = `test:
  name: ${name}
  description: Tracked scope-fail release gate shape
  tags: [e2e, recipe]
variables:
  hosts: {type: array, value: [node-1, node-2, node-3]}
  node_host: {type: string, value: ""}
  gate_blocked: {type: boolean, value: false}
  drift_node: {type: string, value: ""}
flow:
  - for_each:
      collection: {expr: "hosts"}
      capture: {item: node_item, index: node_index}
      body:
        - set: {node_host: {expr: "node_item['value']"}}
        - block: log
          settings: {message: "{{ node_host }} evidence line"}
        - assert:
            label: Node runs the approved build
            fail_current_scope: true
            that:
              - "node_host != 'node-3'"
              - "node_host != ''"
              - "node_index < 5"
            on_fail:
              - set: {gate_blocked: true, drift_node: {expr: "node_host"}}
        - block: log
          settings: {message: "closed {{ node_host }}"}
  - if:
      when: "gate_blocked"
      then:
        - block: log
          settings: {message: "SIGN-OFF BLOCKED for gate: {{ drift_node }}", level: FATAL}
`
    const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
    expect(
      created.payload.created,
      `fail_current_scope must be accepted by the recipe surface: ${JSON.stringify(created.payload)}`,
    ).toBe(true)

    const started = callTool(MCP_PORT, 'start_execution', {
      entity_type: 'test',
      ref: created.payload.test_id as string,
      environment: E2E_ENV_NAME,
    })
    const executionId = started.payload.execution_id as string
    expect(await pollTerminal(request, executionId)).toBe('failed')

    const viaMcp = callTool(MCP_PORT, 'get_execution', { execution_id: executionId })
    expect(viaMcp.payload.status).toBe('failed')

    const report = callTool(MCP_PORT, 'get_failure_report', { execution_id: executionId })
    expect(report.isError, JSON.stringify(report.payload)).toBe(false)
    const failedTests = (report.payload.failed_tests ?? []) as Array<Record<string, any>>
    expect(failedTests, 'exactly one failed test row').toHaveLength(1)

    const failedBlocks = (failedTests[0].failed_blocks ?? []) as Array<Record<string, any>>
    expect(failedBlocks, 'exactly one failed block').toHaveLength(1)
    expect(failedBlocks[0].label).toBe('Node runs the approved build')
    expect(failedBlocks[0].error).toBe('Assertion failed: 1 of 3 assertions failed')

    const excerpt = (failedTests[0].log_excerpt ?? []) as Array<Record<string, any>>
    expect(
      excerpt.some((entry) => String(entry.message).includes("Expression: node_host != 'node-3'")),
      'the failing expression reaches the log excerpt',
    ).toBe(true)
    expect(
      excerpt.some(
        (entry) =>
          entry.level === 'FATAL' &&
          String(entry.message).startsWith('SIGN-OFF BLOCKED for gate: node-3'),
      ),
      'the FATAL verdict reaches the log excerpt',
    ).toBe(true)

    const flow = (await fetchLogMessages(request, executionId)).join('\n')
    expect(flow, 'the loop kept going past the failed pass').toContain('closed node-3')
    expect(flow).toContain('node-1 evidence line')
    expect(flow).toContain('node-2 evidence line')
    expect(flow).toContain('node-3 evidence line')
  })
})
