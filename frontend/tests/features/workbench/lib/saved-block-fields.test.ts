/**
 * savedBlockFields - the node fields a block's config Save writes.
 *
 * Module: frontend/src/features/workbench/lib/saved-block-fields.ts
 *
 * The same fields reach the canvas on Save and overlay the block for a run of
 * its unsaved config, so both read one mapping.
 */

import { describe, it, expect } from 'vitest'

import * as savedBlockFieldsModule from '@/features/workbench/lib/saved-block-fields'
import { savedBlockFields } from '@/features/workbench/lib/saved-block-fields'
import type { SaveData } from '@/features/workbench/common/element-config/types'

const SAVE: SaveData = {
  id: 'node-1',
  version: '1.1.0',
  name: 'Request',
  values: { url: 'https://example.test' },
  outputBindings: { status: 'code' },
  outputTypes: { status: 'integer' },
  description: 'calls the api',
  profileBindings: [{ profileId: 'p1', profileName: 'Prod', profileType: 'http', alias: 'api' }],
  expressionFields: ['url'],
  templateFields: ['body'],
  variableExpressionKeys: ['a'],
  variableTemplateKeys: ['b'],
  variableSecretKeys: ['c'],
  outputSecretFields: ['status'],
  unmaskedSecretFields: ['password'],
  secretMasking: 'reveal',
  variableTypes: { a: 'string' },
  variableElementTypes: { m: { n: 'integer' } },
  elementTypes: { driver_options: { timeout: 'integer' } },
}

describe('savedBlockFields', () => {
  it('splits a save into the node data fields and the whole config', () => {
    expect(savedBlockFields(SAVE)).toEqual({
      data: {
        description: 'calls the api',
        version: '1.1.0',
        expressionFields: ['url'],
        templateFields: ['body'],
        variableExpressionKeys: ['a'],
        variableTemplateKeys: ['b'],
        variableTypes: { a: 'string' },
        variableElementTypes: { m: { n: 'integer' } },
        elementTypes: { driver_options: { timeout: 'integer' } },
      },
      config: {
        values: { url: 'https://example.test' },
        outputBindings: { status: 'code' },
        profileBindings: [{ profileId: 'p1', profileName: 'Prod', profileType: 'http', alias: 'api' }],
        variableSecretKeys: ['c'],
        outputSecretFields: ['status'],
        unmasked_secret_fields: ['password'],
        secret_masking: 'reveal',
      },
    })
  })
})

// ---------------------------------------------------------------------------
// The name-site walker: every place a saved block names a variable (VMGR-105)
// ---------------------------------------------------------------------------

interface SavedBlock {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** The walker contract the Unused scan and the rename refactor share. */
interface NameSiteWalker {
  blockReads: (block: SavedBlock) => Set<string>
  blockWrites: (block: SavedBlock) => Set<string>
  rewriteBlockNames: (block: SavedBlock, rename: (name: string) => string) => SavedBlock
}

const walker = savedBlockFieldsModule as unknown as NameSiteWalker

function block(data: Record<string, unknown>): SavedBlock {
  return { id: 'block-1', type: 'workflowNode', position: { x: 0, y: 0 }, data: { label: 'Block', ...data } }
}

function literalRow(variable: string, extra: Record<string, unknown> = {}) {
  return {
    id: `row-${variable}`,
    type: 'literal',
    variable,
    value_type: 'boolean',
    operator: 'is_true',
    reference_value: null,
    reference_is_expression: false,
    ...extra,
  }
}

function check(elementType: string, values: Record<string, unknown>): SavedBlock {
  return block({ nodeType: 'control', elementType, config: { values } })
}

const ASSERT_ROW = check('assert', { assertions: [literalRow('checked')] })
const IF_ELSE_ROW = check('if-else', {
  branches: [
    { id: 'b1', type: 'if', label: '', conditions: [literalRow('checked')] },
    { id: 'b2', type: 'else', label: '' },
  ],
})
const SWITCH_ROW = check('switch-case', {
  branches: [
    { id: 'c1', type: 'case', label: '', conditions: [literalRow('checked')], break: true },
    { id: 'd1', type: 'default', label: '' },
  ],
})
const WHILE_ROW = check('while', { conditions: [literalRow('checked')] })
const WAIT_UNTIL_ROW = check('wait-until', { conditions: [literalRow('checked')] })
const COMPARE_TO_EXPRESSION = check('assert', {
  assertions: [
    literalRow('count', {
      value_type: 'integer',
      operator: 'greater_than',
      reference_value: 'limit + 1',
      reference_is_expression: true,
    }),
  ],
})
const EXPRESSION_ROW = check('assert', {
  assertions: [{ id: 'e1', type: 'expression', expression: 'total > threshold' }],
})
const NESTED_GROUP = check('assert', {
  assertions: [
    {
      id: 'g1',
      type: 'group',
      items: [literalRow('inner_flag'), { type: 'operator', value: 'and' }, literalRow('other_flag')],
    },
  ],
})
const EXPRESSION_SETTING = block({
  elementType: 'http-request',
  expressionFields: ['url'],
  config: { values: { url: 'base_url + path', method: 'GET' } },
})
const TEMPLATE_SETTING = block({
  elementType: 'log',
  templateFields: ['message'],
  config: { values: { message: 'Hi {{ user }} from {{ host }}' } },
})
const MAP_ENTRY = block({
  elementType: 'http-request',
  expressionFields: ['headers.Authorization'],
  config: { values: { headers: { Authorization: 'auth_token', Accept: 'application/json' } } },
})
const LIST_ENTRY = block({
  elementType: 'shell-script',
  expressionFields: ['arguments.1.value'],
  config: { values: { arguments: [{ value: '--verbose' }, { value: 'target_host' }] } },
})
const REFERENCE_SETTING = check('for-each', { collection: 'items' })
const SETTER = block({
  nodeType: 'control',
  elementType: 'variable-setter',
  variableExpressionKeys: ['next_try'],
  variableTemplateKeys: ['welcome'],
  variableTypes: { next_try: 'integer', welcome: 'string', plain: 'string' },
  config: { values: { variables: { next_try: 'attempt + 1', welcome: 'Hi {{ who }}', plain: 'attempt' } } },
})
const CALL_BINDING = block({
  elementType: 'function',
  nodeType: 'function',
  functionLifecycle: 'local',
  expressionFields: ['level'],
  config: { values: { level: 'chosen_level.upper()' }, outputBindings: { result: 'call_result' } },
})
const OUTPUT_BINDING = block({
  elementType: 'http-request',
  config: { values: { url: 'https://example.test' }, outputBindings: { status: 'code_var' } },
})

describe('saved block name sites - the names a block reads (VMGR-105)', () => {
  it.each<[string, SavedBlock, string[]]>([
    ['an expression setting', EXPRESSION_SETTING, ['base_url', 'path']],
    ['a template setting', TEMPLATE_SETTING, ['user', 'host']],
    ['a map entry expression', MAP_ENTRY, ['auth_token']],
    ['a list entry expression', LIST_ENTRY, ['target_host']],
    ['a reference setting (For Each collection)', REFERENCE_SETTING, ['items']],
    ['an Assert condition row', ASSERT_ROW, ['checked']],
    ['an If/Else branch condition row', IF_ELSE_ROW, ['checked']],
    ['a Switch case condition row', SWITCH_ROW, ['checked']],
    ['a While condition row', WHILE_ROW, ['checked']],
    ['a Wait Until condition row', WAIT_UNTIL_ROW, ['checked']],
    ['a compare-to expression', COMPARE_TO_EXPRESSION, ['count', 'limit']],
    ['an expression condition row', EXPRESSION_ROW, ['total', 'threshold']],
    ['a nested condition group', NESTED_GROUP, ['inner_flag', 'other_flag']],
    ['Variable Setter expression and template rows', SETTER, ['attempt', 'who']],
    ['a Function Block input field', CALL_BINDING, ['chosen_level']],
  ])('reads the names of %s', (_site, savedBlock, names) => {
    expect(walker.blockReads(savedBlock)).toEqual(new Set(names))
  })

  it('reads and renames nothing in an inputBindings key, which no Block stores', () => {
    const leftover = block({
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      inputBindings: { level: 'chosen_level' },
      config: { values: {} },
    })

    expect(walker.blockReads(leftover)).toEqual(new Set())
    expect(walker.rewriteBlockNames(leftover, (name) => (name === 'chosen_level' ? 'picked' : name))).toBe(leftover)
  })

  it('reads nothing from a setting that is not an expression or a template', () => {
    const plain = block({ elementType: 'log', config: { values: { message: 'user from host' } } })

    expect(walker.blockReads(plain)).toEqual(new Set())
  })

  it('does not read a name inside a string literal', () => {
    const quoted = block({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: "status == 'ready' and label != \"done\"" } },
    })

    expect(walker.blockReads(quoted)).toEqual(new Set(['status', 'label']))
  })

  it('reads a name inside an f-string placeholder', () => {
    const formatted = block({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: 'f"order-{order_id}-done"' } },
    })

    expect(walker.blockReads(formatted)).toEqual(new Set(['order_id']))
  })

  it('does not read a literal compare-to value', () => {
    const literalCompare = check('assert', {
      assertions: [
        literalRow('status', { value_type: 'string', operator: 'equals', reference_value: 'limit' }),
      ],
    })

    expect(walker.blockReads(literalCompare)).toEqual(new Set(['status']))
  })
})

describe('saved block name sites - the names a block writes (VMGR-105)', () => {
  it('writes the variables its output bindings name', () => {
    expect(walker.blockWrites(OUTPUT_BINDING)).toEqual(new Set(['code_var']))
  })

  it('writes every Variable Setter target', () => {
    expect(walker.blockWrites(SETTER)).toEqual(new Set(['next_try', 'welcome', 'plain']))
  })

  it('writes the variables a Function Block binds its outputs to', () => {
    expect(walker.blockWrites(CALL_BINDING)).toEqual(new Set(['call_result']))
  })

  it('writes nothing for a check block', () => {
    expect(walker.blockWrites(ASSERT_ROW)).toEqual(new Set())
  })
})

describe('saved block name sites - the rewrite visitor renames every site', () => {
  type Values = Record<string, unknown>
  const values = (savedBlock: SavedBlock): Values =>
    (savedBlock.data.config as { values: Values }).values
  const rows = (savedBlock: SavedBlock, key: string): Array<Record<string, unknown>> =>
    values(savedBlock)[key] as Array<Record<string, unknown>>
  const branchRow = (savedBlock: SavedBlock): Record<string, unknown> =>
    (rows(savedBlock, 'branches')[0].conditions as Array<Record<string, unknown>>)[0]
  const renameTo = (from: string, to: string) => (name: string) => (name === from ? to : name)

  it.each<[string, SavedBlock, string, string, (renamed: SavedBlock) => unknown, unknown]>([
    ['an expression setting', EXPRESSION_SETTING, 'base_url', 'root_url', (b) => values(b).url, 'root_url + path'],
    ['a template setting', TEMPLATE_SETTING, 'user', 'person', (b) => values(b).message, 'Hi {{ person }} from {{ host }}'],
    ['a map entry expression', MAP_ENTRY, 'auth_token', 'api_token', (b) => (values(b).headers as Values).Authorization, 'api_token'],
    ['a list entry expression', LIST_ENTRY, 'target_host', 'remote_host', (b) => rows(b, 'arguments')[1].value, 'remote_host'],
    ['a reference setting (For Each collection)', REFERENCE_SETTING, 'items', 'rows', (b) => values(b).collection, 'rows'],
    ['an Assert condition row', ASSERT_ROW, 'checked', 'is_ready', (b) => rows(b, 'assertions')[0].variable, 'is_ready'],
    ['an If/Else branch condition row', IF_ELSE_ROW, 'checked', 'is_ready', branchRow, expect.objectContaining({ variable: 'is_ready' })],
    ['a Switch case condition row', SWITCH_ROW, 'checked', 'is_ready', branchRow, expect.objectContaining({ variable: 'is_ready' })],
    ['a While condition row', WHILE_ROW, 'checked', 'is_ready', (b) => rows(b, 'conditions')[0].variable, 'is_ready'],
    ['a Wait Until condition row', WAIT_UNTIL_ROW, 'checked', 'is_ready', (b) => rows(b, 'conditions')[0].variable, 'is_ready'],
    ['a compare-to expression', COMPARE_TO_EXPRESSION, 'limit', 'cap', (b) => rows(b, 'assertions')[0].reference_value, 'cap + 1'],
    ['an expression condition row', EXPRESSION_ROW, 'threshold', 'floor_value', (b) => rows(b, 'assertions')[0].expression, 'total > floor_value'],
    ['a nested condition group', NESTED_GROUP, 'inner_flag', 'first_flag', (b) => (rows(b, 'assertions')[0].items as Values[]).map((item) => item.variable), ['first_flag', undefined, 'other_flag']],
    ['a Variable Setter expression row', SETTER, 'attempt', 'tries', (b) => values(b).variables, { next_try: 'tries + 1', welcome: 'Hi {{ who }}', plain: 'attempt' }],
    ['a Variable Setter template row', SETTER, 'who', 'guest', (b) => (values(b).variables as Values).welcome, 'Hi {{ guest }}'],
    ['a Function Block input field', CALL_BINDING, 'chosen_level', 'picked_level', (b) => values(b), { level: 'picked_level.upper()' }],
    ['a Function Block output binding', CALL_BINDING, 'call_result', 'answer', (b) => (b.data.config as Values).outputBindings, { result: 'answer' }],
    ['an output binding', OUTPUT_BINDING, 'code_var', 'http_code', (b) => (b.data.config as Values).outputBindings, { status: 'http_code' }],
  ])('renames %s', (_site, savedBlock, from, to, read, expected) => {
    expect(read(walker.rewriteBlockNames(savedBlock, renameTo(from, to)))).toEqual(expected)
  })

  it('renames a Variable Setter target across its value map, kind keys and types', () => {
    const renamed = walker.rewriteBlockNames(SETTER, renameTo('next_try', 'retry_count'))

    expect(values(renamed).variables).toEqual({
      retry_count: 'attempt + 1',
      welcome: 'Hi {{ who }}',
      plain: 'attempt',
    })
    expect(renamed.data.variableExpressionKeys).toEqual(['retry_count'])
    expect(renamed.data.variableTypes).toEqual({ retry_count: 'integer', welcome: 'string', plain: 'string' })
  })

  it('leaves a name inside a string literal as it is', () => {
    const quoted = block({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: "status == 'status'" } },
    })

    const renamed = walker.rewriteBlockNames(quoted, renameTo('status', 'state'))

    expect(values(renamed).message).toBe("state == 'status'")
  })

  it('renames a name inside an f-string placeholder', () => {
    const formatted = block({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: 'f"prefix_{old_var}_suffix"' } },
    })

    const renamed = walker.rewriteBlockNames(formatted, renameTo('old_var', 'new_var'))

    expect(values(renamed).message).toBe('f"prefix_{new_var}_suffix"')
  })

  it('leaves a longer name that starts with the renamed one as it is', () => {
    const similar = block({
      elementType: 'log',
      expressionFields: ['message'],
      config: { values: { message: 'count + counter' } },
    })

    const renamed = walker.rewriteBlockNames(similar, renameTo('count', 'total'))

    expect(values(renamed).message).toBe('total + counter')
  })

  it('leaves a literal compare-to value and a plain setting as they are', () => {
    const literalCompare = block({
      nodeType: 'control',
      elementType: 'assert',
      config: {
        values: {
          assertions: [
            literalRow('status', { value_type: 'string', operator: 'equals', reference_value: 'flag' }),
          ],
          note: 'flag',
        },
      },
    })

    const renamed = walker.rewriteBlockNames(literalCompare, renameTo('flag', 'marker'))

    expect(rows(renamed, 'assertions')[0].reference_value).toBe('flag')
    expect(values(renamed).note).toBe('flag')
  })

  it('returns a new block and leaves the one it was given unchanged', () => {
    const before = structuredClone(NESTED_GROUP)

    const renamed = walker.rewriteBlockNames(NESTED_GROUP, renameTo('inner_flag', 'first_flag'))

    expect(renamed).not.toBe(NESTED_GROUP)
    expect(NESTED_GROUP).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// CSV / Excel filter rows: condition items on the cell, bound as `_cell`
// ---------------------------------------------------------------------------

function filterBlock(conditions: unknown[], asType = 'integer') {
  return { id: `f-${asType}`, column: { mode: 'name', value: 'amount' }, asType, conditions }
}

const FILTER_ROWS = block({
  nodeType: 'plugin',
  elementType: 'csv-parser',
  config: {
    values: {
      sorts: [{ id: 's1', column: { mode: 'name', value: 'sort_col' }, direction: 'asc' }],
      filters: [
        filterBlock([
          literalRow('_cell', {
            value_type: 'integer',
            operator: 'greater_than',
            reference_value: 'min_amount + _cell',
            reference_is_expression: true,
          }),
          { type: 'operator', value: 'and' },
          { id: 'fe1', type: 'expression', expression: '_cell < max_amount' },
          { type: 'operator', value: 'or' },
          {
            id: 'fg1',
            type: 'group',
            items: [
              literalRow('_cell', {
                value_type: 'integer',
                operator: 'not_equals',
                reference_value: 'skipped_amount',
                reference_is_expression: true,
              }),
            ],
          },
        ]),
        filterBlock(
          [literalRow('_cell', { value_type: 'string', operator: 'equals', reference_value: 'literal_text' })],
          'string',
        ),
      ],
    },
  },
})

describe('saved block name sites - CSV / Excel filter rows', () => {
  type Values = Record<string, unknown>
  const conditionsOf = (savedBlock: SavedBlock, index: number): Values[] =>
    ((savedBlock.data.config as { values: Values }).values.filters as Values[])[index].conditions as Values[]
  const renameTo = (from: string, to: string) => (name: string) => (name === from ? to : name)

  it('reads the compare-to expressions and expression rows of every filter, never the cell itself', () => {
    expect(walker.blockReads(FILTER_ROWS)).toEqual(new Set(['min_amount', 'max_amount', 'skipped_amount']))
  })

  it('reads a filter row of an Excel block the same way', () => {
    const excel = block({
      elementType: 'excel-parser',
      config: { values: { filters: [filterBlock([{ id: 'x1', type: 'expression', expression: '_cell in allowed_codes' }])] } },
    })

    expect(walker.blockReads(excel)).toEqual(new Set(['allowed_codes']))
  })

  it('reads nothing from a literal compare-to value or from the sort and filter column names', () => {
    const literalOnly = block({
      elementType: 'csv-parser',
      config: {
        values: {
          sorts: [{ id: 's1', column: { mode: 'name', value: 'sort_col' }, direction: 'desc' }],
          filters: [filterBlock([literalRow('_cell', { operator: 'equals', reference_value: 'plain_word' })])],
        },
      },
    })

    expect(walker.blockReads(literalOnly)).toEqual(new Set())
  })

  it('reads nothing from a filters setting that is not a list or a filter that is not an object', () => {
    const malformed = block({ elementType: 'csv-parser', config: { values: { filters: 'not-a-list' } } })
    const badEntries = block({
      elementType: 'csv-parser',
      config: { values: { filters: [null, 'text', { id: 'f', conditions: 'not-a-list' }] } },
    })

    expect(walker.blockReads(malformed)).toEqual(new Set())
    expect(walker.blockReads(badEntries)).toEqual(new Set())
  })

  it('writes nothing for a filter row', () => {
    expect(walker.blockWrites(FILTER_ROWS)).toEqual(new Set())
  })

  it('renames a compare-to expression, an expression row and a grouped row, keeping the cell', () => {
    const renamed = walker.rewriteBlockNames(
      walker.rewriteBlockNames(
        walker.rewriteBlockNames(FILTER_ROWS, renameTo('min_amount', 'floor_amount')),
        renameTo('max_amount', 'cap_amount'),
      ),
      renameTo('skipped_amount', 'ignored_amount'),
    )

    const rows = conditionsOf(renamed, 0)
    expect(rows[0]).toEqual(expect.objectContaining({ variable: '_cell', reference_value: 'floor_amount + _cell' }))
    expect(rows[2]).toEqual(expect.objectContaining({ expression: '_cell < cap_amount' }))
    expect((rows[4].items as Values[])[0]).toEqual(
      expect.objectContaining({ variable: '_cell', reference_value: 'ignored_amount' }),
    )
  })

  it('never renames the cell of a filter row, even for a variable named _cell', () => {
    const shared = block({
      nodeType: 'control',
      elementType: 'assert',
      config: {
        values: {
          assertions: [literalRow('_cell')],
          filters: [filterBlock([{ id: 'e', type: 'expression', expression: '_cell > _cell_floor' }])],
        },
      },
    })

    const renamed = walker.rewriteBlockNames(shared, renameTo('_cell', 'cell_value'))

    const values = (renamed.data.config as { values: Values }).values
    expect((values.assertions as Values[])[0].variable).toBe('cell_value')
    expect(conditionsOf(renamed, 0)[0].expression).toBe('_cell > _cell_floor')
  })

  it('leaves a literal compare-to value of a filter row as it is', () => {
    const renamed = walker.rewriteBlockNames(FILTER_ROWS, renameTo('literal_text', 'other_text'))

    expect(conditionsOf(renamed, 1)[0].reference_value).toBe('literal_text')
    expect(renamed).toBe(FILTER_ROWS)
  })
})

// ---------------------------------------------------------------------------
// The expression scanner: strings, f-strings, numbers, attributes and binders
// ---------------------------------------------------------------------------

describe('saved block name sites - the expression scanner', () => {
  const { namesInText, renameNamesInText } = savedBlockFieldsModule

  it.each<[string, string, string[]]>([
    ['an escaped quote inside a string', String.raw`'it\'s' + after_escape`, ['after_escape']],
    ['a triple-quoted string holding quotes', "'''one 'two' three''' + tail_name", ['tail_name']],
    ['a string that never closes', "ready and 'never closed", ['ready']],
    ['a plain string holding braces', "'{not_read}' + real_one", ['real_one']],
    ['an f-string placeholder indexing with a string', `f"{lookup['key']}"`, ['lookup']],
    ['an f-string placeholder with a format spec', 'f"{started:%Y-%m-%d}"', ['started']],
    ['an f-string placeholder with a spec holding a second colon', 'f"{clock:%H:%M}"', ['clock']],
    ['an f-string placeholder with a conversion', 'f"{label!r}"', ['label']],
    ['an f-string placeholder comparing with !=', 'f"{a_val != b_val}"', ['a_val', 'b_val']],
    ['an f-string placeholder slicing with a colon', 'f"{rows[1:end_idx]}"', ['rows', 'end_idx']],
    ['an f-string escaped brace', 'f"{{literal}} {shown}"', ['shown']],
    ['an f-string placeholder that never closes', 'f"{dangling', ['dangling']],
    ['an f-string placeholder with a spec that never closes', 'f"{partial:>10', ['partial']],
    ['an upper-case f-string prefix', 'F"{upper_ref}"', ['upper_ref']],
    ['a raw bytes string', "rb'{raw_text}' + raw_after", ['raw_after']],
    ['a name right before a quote', 'count"s"', ['count']],
    ['a number holding a dot and a hex number', '1.5e3 + rate * 0x1F', ['rate']],
    ['a keyword argument', 'fmt(value=amount, sep = gap)', ['fmt', 'amount', 'gap']],
    ['an equality test', 'left == right', ['left', 'right']],
    ['an attribute, with and without spaces', 'user.name + user . email', ['user', 'user']],
    ['a comprehension binder', '[row for row in rows if row]', ['rows']],
    ['a lambda binder', 'sorted(items, key=lambda item: item.size + offset)', ['sorted', 'items', 'offset']],
    ['a dict literal', '{key_a: val_b}', ['key_a', 'val_b']],
    ['a membership test', 'needle in haystack', ['needle', 'haystack']],
  ])('reads the names of %s', (_case, text, names) => {
    expect(namesInText(text, 'expression')).toEqual(names)
  })

  it.each<[string, string, string[]]>([
    ['a template without markers', 'no markers here', []],
    ['a template whose last marker never closes', 'Hi {{ first }} and {{ second', ['first']],
  ])('reads the names of %s', (_case, text, names) => {
    expect(namesInText(text, 'template')).toEqual(names)
  })

  it('renames only the free names, never a bound one, an attribute or a keyword argument', () => {
    const text = 'fn(key=key, data=[key for key in key_list]) + obj.key'
    const renamed = renameNamesInText(text, 'expression', (name) => (name === 'key' ? 'id' : name))

    expect(renamed).toBe(text)
  })

  it('renames a name inside an f-string placeholder and leaves its format spec', () => {
    const renamed = renameNamesInText('f"{when:%Y} {when!r}"', 'expression', (name) =>
      name === 'when' ? 'stamp' : name,
    )

    expect(renamed).toBe('f"{stamp:%Y} {stamp!r}"')
  })
})

// ---------------------------------------------------------------------------
// Name sites that hold no readable text, and the rewrite of writes
// ---------------------------------------------------------------------------

describe('saved block name sites - sites without text and the rewrite of writes', () => {
  type Values = Record<string, unknown>
  const renameTo = (from: string, to: string) => (name: string) => (name === from ? to : name)
  const SEALED = 'wave:enc:v1:c2VhbGVk'

  it('reads nothing from a site holding a number, a sealed secret or a path through plain text', () => {
    const noText = block({
      elementType: 'http-request',
      expressionFields: ['timeout', 'token', 'headers.Authorization'],
      config: { values: { timeout: 30, token: SEALED, headers: 'flat-text' } },
    })

    expect(walker.blockReads(noText)).toEqual(new Set())
    expect(walker.rewriteBlockNames(noText, renameTo('token', 'other'))).toBe(noText)
  })

  it('reads a setting whose own key holds a dot', () => {
    const dotted = block({ elementType: 'log', expressionFields: ['a.b'], config: { values: { 'a.b': 'dotted_ref' } } })

    expect(walker.blockReads(dotted)).toEqual(new Set(['dotted_ref']))
  })

  it('reads a block with no element type or an unknown one by its listed fields only', () => {
    const untyped = block({ expressionFields: ['x'], config: { values: { x: 'first_ref', collection: 'not_ref' } } })
    const unknown = block({ elementType: 'no-such-block', config: { values: { collection: 'not_ref' } } })

    expect(walker.blockReads(untyped)).toEqual(new Set(['first_ref']))
    expect(walker.blockReads(unknown)).toEqual(new Set())
  })

  it('reads nothing from a config or values that are not objects', () => {
    expect(walker.blockReads(block({ elementType: 'log', config: 'broken' }))).toEqual(new Set())
    expect(walker.blockReads(block({ elementType: 'log', config: { values: ['broken'] } }))).toEqual(new Set())
    expect(walker.blockWrites(block({ elementType: 'log' }))).toEqual(new Set())
  })

  it('skips a branch or a condition item that is not an object', () => {
    const odd = check('if-else', {
      assertions: [null, literalRow('kept_flag')],
      branches: ['bad', { id: 'b', type: 'if', conditions: [literalRow('branch_flag')] }],
    })

    expect(walker.blockReads(odd)).toEqual(new Set(['kept_flag', 'branch_flag']))
  })

  it('writes only the output binding targets that name a variable', () => {
    const bindings = block({
      elementType: 'http-request',
      config: { outputBindings: { status: 'code_var', body: '', headers: null } },
    })

    expect(walker.blockWrites(bindings)).toEqual(new Set(['code_var']))
  })

  it('renames a Variable Setter target across its secret keys and element types', () => {
    const secretSetter = block({
      nodeType: 'control',
      elementType: 'variable-setter',
      variableExpressionKeys: [],
      variableTemplateKeys: [],
      variableTypes: { items: 'array' },
      variableElementTypes: { items: { element: 'integer' } },
      config: { values: { variables: { items: [1, 2] } }, variableSecretKeys: ['items'] },
    })

    const renamed = walker.rewriteBlockNames(secretSetter, renameTo('items', 'values_list'))

    expect((renamed.data.config as Values).variableSecretKeys).toEqual(['values_list'])
    expect(renamed.data.variableElementTypes).toEqual({ values_list: { element: 'integer' } })
    expect(((renamed.data.config as Values).values as Values).variables).toEqual({ values_list: [1, 2] })
  })

  it('writes nothing for a Variable Setter with no config or no value map', () => {
    const noConfig = block({ nodeType: 'control', elementType: 'variable-setter' })
    const noMap = block({ nodeType: 'control', elementType: 'variable-setter', config: { values: { variables: 'x' } } })
    const noValues = block({ nodeType: 'control', elementType: 'variable-setter', config: { values: 'x' } })

    expect(walker.blockWrites(noConfig)).toEqual(new Set())
    expect(walker.blockWrites(noMap)).toEqual(new Set())
    expect(walker.blockWrites(noValues)).toEqual(new Set())
  })

  it('renames a Variable Setter target that declares no types', () => {
    const untyped = block({
      nodeType: 'control',
      elementType: 'variable-setter',
      config: { values: { variables: { tries: 1 } } },
    })

    const renamed = walker.rewriteBlockNames(untyped, renameTo('tries', 'attempts'))

    expect(renamed.data).toEqual(
      expect.objectContaining({ variableExpressionKeys: [], variableTemplateKeys: [], variableTypes: {} }),
    )
    expect(((renamed.data.config as Values).values as Values).variables).toEqual({ attempts: 1 })
  })

  it('returns the same block when no name it holds is renamed', () => {
    expect(walker.rewriteBlockNames(SETTER, renameTo('unrelated', 'other'))).toBe(SETTER)
    expect(walker.rewriteBlockNames(OUTPUT_BINDING, renameTo('unrelated', 'other'))).toBe(OUTPUT_BINDING)
  })

  it('renames a parser query alias bound to itself across its query, output type and binding', () => {
    const parser = block({
      elementType: 'json-parser',
      config: {
        values: { queries: { user_id: '$.id' }, query_output_types: { user_id: 'string' } },
        outputBindings: { user_id: 'user_id', success: 'ok_flag', error: null },
      },
    })

    const renamed = walker.rewriteBlockNames(parser, renameTo('user_id', 'account_id'))

    const config = renamed.data.config as Values
    expect(config.values).toEqual({ queries: { account_id: '$.id' }, query_output_types: { account_id: 'string' } })
    expect(config.outputBindings).toEqual({ account_id: 'account_id', success: 'ok_flag', error: null })
  })

  it('renames a query alias of a parser that declares no output types', () => {
    const parser = block({
      elementType: 'xml-parser',
      config: { values: { queries: { title: '//title' } }, outputBindings: { success: 'ok_flag' } },
    })

    const renamed = walker.rewriteBlockNames(parser, renameTo('title', 'heading'))

    expect((renamed.data.config as Values).values).toEqual({ queries: { heading: '//title' }, query_output_types: {} })
  })

  it('renames an output binding target of a block whose config holds no values', () => {
    const bare = block({ elementType: 'http-request', config: { outputBindings: { status: 'code_var' } } })

    const renamed = walker.rewriteBlockNames(bare, renameTo('code_var', 'status_code'))

    expect((renamed.data.config as Values).outputBindings).toEqual({ status: 'status_code' })
  })
})

// ---------------------------------------------------------------------------
// One field rewrite for every Block: rename, drop and the new choice inputs (REQ-3.1.2.1, FNCFG-9)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

interface FieldInput {
  name: string
  type?: string
  enumValues?: readonly unknown[]
  default?: unknown
  required?: boolean
}

interface FieldContract {
  inputs: FieldInput[]
  outputs: Array<{ name: string }>
}

/** The field rewrites the store, the publish and the window share. */
interface BlockFieldRewrites {
  renameBlockField: (data: Rec, oldName: string, newName: string) => Rec
  dropBlockFields: (data: Rec, contract: FieldContract) => Rec
  writeNewChoiceInputs: (data: Rec, previousInputs: FieldInput[], nextInputs: FieldInput[]) => Rec
}

const rewrites = savedBlockFieldsModule as unknown as BlockFieldRewrites

/** A Function Block holding a literal, a whole expression, a template, map and list entries in {x}, and outputs. */
function fieldBlock(extra: Rec = {}): Rec {
  return {
    label: 'Lookup',
    nodeType: 'function',
    elementType: 'function',
    functionLifecycle: 'local',
    expressionFields: ['region', 'headers.X-Id', 'tags.1'],
    templateFields: ['greeting'],
    elementTypes: { headers: { 'X-Id': 'string', retries: 'integer' }, tags: ['string', 'string'] },
    config: {
      values: {
        region: 'zone_var',
        region_code: 'eu',
        headers: { 'X-Id': 'request_id', retries: 3 },
        tags: ['first', 'picked_tag'],
        greeting: 'Hi {{ who }}',
        count: 3,
      },
      outputBindings: { total: 'sum_var', token: 'token_var' },
      outputSecretFields: ['token'],
    },
    ...extra,
  }
}

/** The contract `fieldBlock` fits as it is. */
const FIELD_CONTRACT: FieldContract = {
  inputs: [
    { name: 'region', type: 'string' },
    { name: 'region_code', type: 'string' },
    { name: 'headers', type: 'map' },
    { name: 'tags', type: 'array' },
    { name: 'greeting', type: 'string' },
    { name: 'count', type: 'integer' },
  ],
  outputs: [{ name: 'total' }, { name: 'token' }],
}

function valuesIn(data: Rec): Rec {
  return (data.config as Rec).values as Rec
}

function configIn(data: Rec): Rec {
  return data.config as Rec
}

function withoutInput(name: string): FieldContract {
  return { ...FIELD_CONTRACT, inputs: FIELD_CONTRACT.inputs.filter((input) => input.name !== name) }
}

function withInput(input: FieldInput): FieldContract {
  return { ...FIELD_CONTRACT, inputs: FIELD_CONTRACT.inputs.map((each) => (each.name === input.name ? input : each)) }
}

describe('renameBlockField - a renamed input or output carries the Block field with all its flags (REQ-3.1.2.1)', () => {
  it('moves a literal value to the new name', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'count', 'amount')

    expect(valuesIn(next)).toEqual({
      region: 'zone_var',
      region_code: 'eu',
      headers: { 'X-Id': 'request_id', retries: 3 },
      tags: ['first', 'picked_tag'],
      greeting: 'Hi {{ who }}',
      amount: 3,
    })
  })

  it('moves an expression value with its whole expression flag', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'region', 'area')

    expect(valuesIn(next).area).toBe('zone_var')
    expect(valuesIn(next)).not.toHaveProperty('region')
    expect(next.expressionFields).toEqual(['area', 'headers.X-Id', 'tags.1'])
  })

  it('leaves a field whose name only starts with the renamed one', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'region', 'area')

    expect(valuesIn(next).region_code).toBe('eu')
    expect(valuesIn(next)).not.toHaveProperty('area_code')
  })

  it('moves a map input with its dotted entry flags and its element types', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'headers', 'request_headers')

    expect(valuesIn(next).request_headers).toEqual({ 'X-Id': 'request_id', retries: 3 })
    expect(next.expressionFields).toEqual(['region', 'request_headers.X-Id', 'tags.1'])
    expect(next.elementTypes).toEqual({
      request_headers: { 'X-Id': 'string', retries: 'integer' },
      tags: ['string', 'string'],
    })
  })

  it('moves a list input with its dotted item flags and its element types', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'tags', 'labels')

    expect(valuesIn(next).labels).toEqual(['first', 'picked_tag'])
    expect(next.expressionFields).toEqual(['region', 'headers.X-Id', 'labels.1'])
    expect(next.elementTypes).toEqual({
      headers: { 'X-Id': 'string', retries: 'integer' },
      labels: ['string', 'string'],
    })
  })

  it('moves a template value with its template flag', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'greeting', 'welcome')

    expect(valuesIn(next).welcome).toBe('Hi {{ who }}')
    expect(next.templateFields).toEqual(['welcome'])
  })

  it('moves an output binding with its secret mark', () => {
    const next = rewrites.renameBlockField(fieldBlock(), 'token', 'api_token')

    expect(configIn(next).outputBindings).toEqual({ total: 'sum_var', api_token: 'token_var' })
    expect(configIn(next).outputSecretFields).toEqual(['api_token'])
  })

  it('moves an output binding of a Block that never saved its Secret boxes, writing no secret list', () => {
    const data = fieldBlock({ config: { values: {}, outputBindings: { token: 'token_var' } } })

    const next = rewrites.renameBlockField(data, 'token', 'api_token')

    expect(configIn(next)).toEqual({ values: {}, outputBindings: { api_token: 'token_var' } })
    expect(configIn(next)).not.toHaveProperty('outputSecretFields')
  })

  it('returns the same Block data when the Block holds nothing under the old name', () => {
    const data = fieldBlock()

    expect(rewrites.renameBlockField(data, 'missing', 'other')).toBe(data)
  })

  it('leaves the Block data it was given unchanged', () => {
    const data = fieldBlock()
    const before = structuredClone(data)

    rewrites.renameBlockField(data, 'headers', 'request_headers')

    expect(data).toEqual(before)
  })
})

describe('dropBlockFields - a field the contract no longer declares goes with all its flags (REQ-3.1.2.1)', () => {
  it('returns the same Block data when every field is declared and still fits', () => {
    const data = fieldBlock()

    expect(rewrites.dropBlockFields(data, FIELD_CONTRACT)).toBe(data)
  })

  it('drops an expression value with its whole expression flag', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withoutInput('region'))

    expect(valuesIn(next)).not.toHaveProperty('region')
    expect(valuesIn(next).region_code).toBe('eu')
    expect(next.expressionFields).toEqual(['headers.X-Id', 'tags.1'])
  })

  it('drops a map input with its dotted entry flags and its element types', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withoutInput('headers'))

    expect(valuesIn(next)).not.toHaveProperty('headers')
    expect(next.expressionFields).toEqual(['region', 'tags.1'])
    expect(next.elementTypes).toEqual({ tags: ['string', 'string'] })
  })

  it('drops a list input with its dotted item flags and its element types', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withoutInput('tags'))

    expect(valuesIn(next)).not.toHaveProperty('tags')
    expect(next.expressionFields).toEqual(['region', 'headers.X-Id'])
    expect(next.elementTypes).toEqual({ headers: { 'X-Id': 'string', retries: 'integer' } })
  })

  it('drops a template value with its template flag', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withoutInput('greeting'))

    expect(valuesIn(next)).not.toHaveProperty('greeting')
    expect(next.templateFields ?? []).toEqual([])
  })

  it('drops the flags of an undeclared input that holds no value', () => {
    const data = fieldBlock({ expressionFields: ['region', 'gone', 'gone.key'] })

    const next = rewrites.dropBlockFields(data, FIELD_CONTRACT)

    expect(next.expressionFields).toEqual(['region'])
  })

  it('drops an output binding with its secret mark, keeping the other config fields', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), { ...FIELD_CONTRACT, outputs: [{ name: 'total' }] })

    expect(configIn(next).outputBindings).toEqual({ total: 'sum_var' })
    expect(configIn(next).outputSecretFields).toEqual([])
    expect(valuesIn(next)).toEqual(valuesIn(fieldBlock()))
  })

  it('leaves a never-saved secret list unset when an output goes', () => {
    const data = fieldBlock({ config: { values: {}, outputBindings: { total: 'sum_var', gone: 'g' } } })

    const next = rewrites.dropBlockFields(data, { inputs: [], outputs: [{ name: 'total' }] })

    expect(configIn(next)).toEqual({ values: {}, outputBindings: { total: 'sum_var' } })
    expect(configIn(next)).not.toHaveProperty('outputSecretFields')
  })

  it('leaves the Block data it was given unchanged', () => {
    const data = fieldBlock()
    const before = structuredClone(data)

    rewrites.dropBlockFields(data, withoutInput('headers'))

    expect(data).toEqual(before)
  })
})

/** A Block holding one literal `arg` beside a fitting neighbor, checked against a contract that types `arg`. */
function dropOne(input: FieldInput, value: unknown, flags: Rec = {}): Rec {
  const data = { label: 'Lookup', nodeType: 'function', ...flags, config: { values: { arg: value, other: 'kept' } } }
  return rewrites.dropBlockFields(data, { inputs: [input, { name: 'other', type: 'string' }], outputs: [] })
}

/** A literal that no longer fits its input: the case, the input type and the stored value. */
const BROKEN_VALUES: Array<[string, string, unknown]> = [
  ['a string on an integer input', 'integer', 'abc'],
  ['decimal text on an integer input', 'integer', '3.5'],
  ['exponent text on a float input', 'float', '1e5'],
  ['an integer past 19 digits on an integer input', 'integer', '12345678901234567890'],
  ['a number that is not finite on a float input', 'float', Number.NaN],
  ['an integer on a string input', 'string', 3],
  ['a float on an integer input', 'integer', 2.5],
  ['true on an integer input', 'integer', true],
  ['an integer on a boolean input', 'boolean', 1],
  ['a map on a list input', 'array', { a: 1 }],
  ['a list on a map input', 'map', [1, 2]],
  ['a string on a table input', 'table', 'rows'],
  ['a map that is not a table on a table input', 'table', { a: 1 }],
  ['an empty string on an integer input', 'integer', ''],
]

/** A literal that still fits its input after the change. */
const FITTING_VALUES: Array<[string, string, unknown]> = [
  ['an integer on a float input', 'float', 3],
  ['a negative integer on a float input', 'float', -7],
  ['a float on a float input', 'float', 2.5],
  ['a string on a string input', 'string', 'eu'],
  ['false on a boolean input', 'boolean', false],
  ['a list on a list input', 'array', [1, 2]],
  ['a map on a map input', 'map', { a: 1 }],
  ['a list of row maps on a table input', 'table', [{ id: 1 }]],
  ['a table stored with its column types on a table input', 'table', { columns: [{ name: 'id', type: 'integer' }], rows: [[1]] }],
  ['an empty string on a string input', 'string', ''],
  ['digit text on an integer input (REQ-3.1.3.14)', 'integer', '3'],
  ['an integer past JS precision on an integer input', 'integer', '9007199254740993'],
  ['decimal text on a float input', 'float', '2.50'],
]

describe('dropBlockFields - a value that no longer fits its input is dropped, never switched (FNCFG-9)', () => {
  it.each(BROKEN_VALUES)('drops %s and leaves the field empty', (_case, type, value) => {
    expect(valuesIn(dropOne({ name: 'arg', type }, value))).toEqual({ other: 'kept' })
  })

  it.each(FITTING_VALUES)('keeps %s', (_case, type, value) => {
    expect(valuesIn(dropOne({ name: 'arg', type }, value))).toEqual({ arg: value, other: 'kept' })
  })

  it.each<[string, string, string]>([
    ['a variable', 'integer', 'region_name'],
    ['an expression', 'integer', 'count + 1'],
    ['an indexed read', 'string', 'levels[0]'],
    ['an f-string', 'integer', "f'{region}'"],
  ])('keeps %s as written, whatever the input type', (_case, type, value) => {
    const next = dropOne({ name: 'arg', type }, value, { expressionFields: ['arg'] })

    expect(valuesIn(next)).toEqual({ arg: value, other: 'kept' })
    expect(next.expressionFields).toEqual(['arg'])
  })

  it('keeps a value of any type on an input that declares no type', () => {
    expect(valuesIn(dropOne({ name: 'arg' }, 'abc'))).toEqual({ arg: 'abc', other: 'kept' })
  })

  it('keeps a null value, which the save check lets through on any input', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'integer' }, null))).toEqual({ arg: null, other: 'kept' })
  })

  it('drops a map that no longer fits together with its dotted entry flags and element types', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withInput({ name: 'headers', type: 'string' }))

    expect(valuesIn(next)).not.toHaveProperty('headers')
    expect(next.expressionFields).toEqual(['region', 'tags.1'])
    expect(next.elementTypes).toEqual({ tags: ['string', 'string'] })
  })

  it('drops only the broken value: the other values, flags and outputs stay as they were', () => {
    const next = rewrites.dropBlockFields(fieldBlock(), withInput({ name: 'count', type: 'string' }))

    const { count: _dropped, ...kept } = valuesIn(fieldBlock())
    expect(valuesIn(next)).toEqual(kept)
    expect(next.expressionFields).toEqual(['region', 'headers.X-Id', 'tags.1'])
    expect(next.templateFields).toEqual(['greeting'])
    expect(configIn(next).outputBindings).toEqual({ total: 'sum_var', token: 'token_var' })
    expect(next.label).toBe('Lookup')
  })
})

/** An enum input of one type, its allowed values, a value it no longer allows and one it still does. */
const ENUM_PICKS: Array<[string, string, Array<string | number>, unknown, unknown]> = [
  ['String', 'string', ['low', 'high'], 'medium', 'high'],
  ['Integer', 'integer', [1, 3], 2, 3],
  ['Float', 'float', [0.5, 1.5], 2.5, 1.5],
]

describe('dropBlockFields - a pick the allowed values no longer hold is dropped (FNCFG-9, REQ-3.1.2.11)', () => {
  it.each(ENUM_PICKS)('%s enum: drops a pick the allowed values no longer hold', (_label, type, enumValues, gone) => {
    expect(valuesIn(dropOne({ name: 'arg', type, enumValues }, gone))).toEqual({ other: 'kept' })
  })

  it.each(ENUM_PICKS)('%s enum: keeps a pick the allowed values still hold', (_label, type, enumValues, _gone, kept) => {
    expect(valuesIn(dropOne({ name: 'arg', type, enumValues }, kept))).toEqual({ arg: kept, other: 'kept' })
  })

  it('never puts the default in place of a dropped pick', () => {
    const next = dropOne({ name: 'arg', type: 'string', enumValues: ['low', 'mid'], default: 'low', required: true }, 'high')

    expect(valuesIn(next)).toEqual({ other: 'kept' })
  })

  it('keeps a pick that is the same exact number as an allowed value written another way', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'float', enumValues: ['1.50', 2] }, 1.5))).toEqual({ arg: 1.5, other: 'kept' })
    expect(valuesIn(dropOne({ name: 'arg', type: 'integer', enumValues: [3] }, '3'))).toEqual({ arg: '3', other: 'kept' })
  })

  it('tells picks apart that one JS double cannot', () => {
    const enumValues = ['9007199254740992']
    expect(valuesIn(dropOne({ name: 'arg', type: 'integer', enumValues }, '9007199254740993'))).toEqual({ other: 'kept' })
  })

  it('never picks an allowed value that is no number of the type', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'integer', enumValues: ['three'] }, 3))).toEqual({ other: 'kept' })
  })

  it('keeps an integer on a Float enum that allows that number', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'float', enumValues: [1, 2.5] }, 1))).toEqual({ arg: 1, other: 'kept' })
  })

  it('drops a number on a String enum even when an allowed value reads the same', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'string', enumValues: ['1', '2'] }, 1))).toEqual({ other: 'kept' })
  })

  it('drops every pick once the allowed values list is empty', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'string', enumValues: [] }, 'low'))).toEqual({ other: 'kept' })
  })

  it('keeps a null value on an enum input, as the save check does', () => {
    const next = dropOne({ name: 'arg', type: 'string', enumValues: ['low'] }, null)

    expect(valuesIn(next)).toEqual({ arg: null, other: 'kept' })
  })

  it('keeps an expression on an enum input as written', () => {
    const next = dropOne({ name: 'arg', type: 'string', enumValues: ['low'] }, 'chosen_level', { expressionFields: ['arg'] })

    expect(valuesIn(next)).toEqual({ arg: 'chosen_level', other: 'kept' })
  })

  it('keeps a former pick that still fits once the input is no longer an enum', () => {
    expect(valuesIn(dropOne({ name: 'arg', type: 'string' }, 'medium'))).toEqual({ arg: 'medium', other: 'kept' })
  })
})

const LEVEL: FieldInput = { name: 'level', type: 'string', required: true, enumValues: ['low', 'high'], default: 'low' }
const RETRIES: FieldInput = { name: 'retries', type: 'integer', required: true, enumValues: [1, 3, 5], default: 3 }
const RATIO: FieldInput = { name: 'ratio', type: 'float', required: true, enumValues: [0.5, 1.5], default: 1.5 }
const VERBOSE: FieldInput = { name: 'verbose', type: 'boolean', required: false, default: false }
const STRICT: FieldInput = { name: 'strict', type: 'boolean', required: true, default: true }
const NOTE: FieldInput = { name: 'note', type: 'string', required: false, default: 'hello' }
const LIMIT: FieldInput = { name: 'limit', type: 'integer', required: false, default: 5 }
const HOSTS: FieldInput = { name: 'hosts', type: 'array', required: false, default: ['a'] }
const REGION: FieldInput = { name: 'region', type: 'string', required: false }

function plainBlock(values: Rec, extra: Rec = {}): Rec {
  return { label: 'Lookup', nodeType: 'function', expressionFields: [], config: { values, outputBindings: {} }, ...extra }
}

describe('writeNewChoiceInputs - a new choice-list or true / false input starts on its default (FNCFG-9, REQ-3.1.2.10)', () => {
  it('writes the default of each new choice-list and true / false input, Required included, and nothing for a free-entry one', () => {
    const data = plainBlock({ region: 'eu' })

    const next = rewrites.writeNewChoiceInputs(data, [REGION], [REGION, LEVEL, VERBOSE, STRICT, NOTE, LIMIT, HOSTS])

    expect(valuesIn(next)).toEqual({ region: 'eu', level: 'low', verbose: false, strict: true })
  })

  it('keeps a typed choice value as the number it is', () => {
    const next = rewrites.writeNewChoiceInputs(plainBlock({}), [], [RETRIES, RATIO])

    expect(valuesIn(next)).toEqual({ retries: 3, ratio: 1.5 })
  })

  it('writes a plain value, with no expression or template flag', () => {
    const next = rewrites.writeNewChoiceInputs(plainBlock({}, { templateFields: [] }), [], [LEVEL])

    expect(next.expressionFields).toEqual([])
    expect(next.templateFields).toEqual([])
  })

  it('writes nothing for a choice input the Function already had, even one the Block holds no value for', () => {
    const data = plainBlock({ region: 'eu' })

    expect(rewrites.writeNewChoiceInputs(data, [REGION, LEVEL], [REGION, LEVEL, NOTE])).toBe(data)
  })

  it('never writes over a value the Block already holds under a new input name', () => {
    const data = plainBlock({ level: 'high' })

    const next = rewrites.writeNewChoiceInputs(data, [{ ...LEVEL, name: 'tier' }], [LEVEL, VERBOSE])

    expect(valuesIn(next)).toEqual({ level: 'high', verbose: false })
  })

  it('writes into a Block that has no config yet', () => {
    const data: Rec = { label: 'Lookup', nodeType: 'function' }

    const next = rewrites.writeNewChoiceInputs(data, [], [LEVEL])

    expect(next.config).toEqual({ values: { level: 'low' } })
  })

  it('leaves the Block data it was given unchanged', () => {
    const data = plainBlock({ region: 'eu' })
    const before = structuredClone(data)

    rewrites.writeNewChoiceInputs(data, [], [LEVEL])

    expect(data).toEqual(before)
  })
})

describe('renameBlockField and dropBlockFields - values that stay as they are (FNCFG-9)', () => {
  it('returns the same Block when the name does not change', () => {
    const data = fieldBlock()
    expect(rewrites.renameBlockField(data, 'region', 'region')).toBe(data)
  })

  it('keeps a sealed secret and a masked value whatever the input type', () => {
    const data = fieldBlock({
      config: { values: { count: 'wave:enc:v1:abc', region_code: '********' }, outputBindings: {} },
    })
    const contract = {
      ...FIELD_CONTRACT,
      inputs: [
        { name: 'count', type: 'integer' },
        { name: 'region_code', type: 'boolean' },
      ],
    }
    expect(valuesIn(rewrites.dropBlockFields(data, contract))).toEqual({
      count: 'wave:enc:v1:abc',
      region_code: '********',
    })
  })
})
