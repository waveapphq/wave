/** The Test the V-EXEC-HISTORY-SECRET-COPY specs run: unflagged copies of a secret table, map and list (REQ-3.1.3.5). */

import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { createTest, setterBlock } from '../../helpers/fn-block'
import { validateTest } from '../../helpers/fn-seed'

/** Both cells sit under the scan floor, so only the whole-container forms can catch a copy. */
const CELL_LOGIN = 'zwadm'
const CELL_CODE = 'kq4z'
const TABLE_COLUMNS = ['zt_login', 'zt_code']
const MAP_KEYS = ['zm_login', 'zm_code']
/** Every text held inside the secrets; a copy shown or stored masked whole carries none of them. */
export const SECRET_TEXTS = [CELL_LOGIN, CELL_CODE, ...TABLE_COLUMNS, ...MAP_KEYS]

/** Each secret source and the unflagged variable the Setter copies it into. */
export const COPIES = [
  { source: 'vault_rows', copy: 'copied_rows' },
  { source: 'vault_map', copy: 'copied_map' },
  { source: 'vault_list', copy: 'copied_list' },
] as const

const SETTER_ID = 'secret-copy-setter'
const PLAIN_SOURCE = 'plain_rows'
export const PLAIN_COPY = 'plain_copy'

/** Save the secret copy Test through POST /tests, track its id in `testIds` and validate it for a run. */
export async function createSecretCopyTest(request: APIRequestContext, testIds: string[]): Promise<string> {
  const rows: Record<string, string> = { [PLAIN_COPY]: PLAIN_SOURCE }
  for (const { source, copy } of COPIES) rows[copy] = source
  const testId = await createTest(request, {
    name: `zz-secret-copy-${randomUUID().slice(0, 8)}`,
    nodes: [
      setterBlock(SETTER_ID, 'Copy secrets', rows, {
        expressionFields: Object.keys(rows).map((name) => `variables.${name}`),
        position: { x: 200, y: 160 },
      }),
    ],
    variables: {
      vault_rows: {
        type: 'table',
        scope: 'test',
        secret: true,
        value: [{ [TABLE_COLUMNS[0]]: CELL_LOGIN, [TABLE_COLUMNS[1]]: CELL_CODE }],
      },
      vault_map: {
        type: 'map',
        scope: 'test',
        secret: true,
        value: { [MAP_KEYS[0]]: CELL_LOGIN, [MAP_KEYS[1]]: CELL_CODE },
      },
      vault_list: { type: 'array', scope: 'test', secret: true, value: [CELL_LOGIN, CELL_CODE] },
      copied_rows: { type: 'table', scope: 'test', value: [] },
      copied_map: { type: 'map', scope: 'test', value: {} },
      copied_list: { type: 'array', scope: 'test', value: [] },
      [PLAIN_SOURCE]: { type: 'table', scope: 'test', value: [{ region: 'eu-west', tier: 'gold' }] },
      [PLAIN_COPY]: { type: 'table', scope: 'test', value: [] },
    },
  })
  testIds.push(testId)

  const validation = await validateTest(request, testId, 'run')
  expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)
  return testId
}
