/**
 * Shared K8s builder tests.
 *
 * The Helm family reuses the K8s row builders and needs three of them to take
 * one more argument each: an Output Format that can start on Table, a timeout
 * row that can say what helm does with it, and a tail that can place extra rows
 * inside Advanced and Failure Handling. The twelve K8s descriptors pass none of
 * those arguments, and every builder keeps its plain answer for them.
 */

import { describe, it, expect } from 'vitest'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sKindInputs,
  k8sKindPickerInput,
  k8sOutputFormatInput,
  k8sTimeoutInput,
} from '@/features/workbench/lib/node-parameters/plugins/_k8s-shared'
import { group, param } from '@/features/workbench/lib/node-parameters/types'

const TAIL_ROWS = ['namespace', 'impersonate_user', 'impersonate_groups', 'on_error']

const NAMESPACE_DESCRIPTION = 'Leave empty to use the namespace the session carries.'

/** The tail a block gets when it passes no extra rows, written out in full. */
const PLAIN_TAIL = [
  {
    name: 'namespace',
    label: 'Namespace',
    type: 'string',
    required: false,
    description: NAMESPACE_DESCRIPTION,
    group: 'Advanced',
  },
  {
    name: 'impersonate_user',
    label: 'Impersonate user',
    type: 'string',
    required: false,
    description: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
    group: 'Advanced',
  },
  {
    name: 'impersonate_groups',
    label: 'Impersonate groups',
    type: 'string',
    required: false,
    description: 'Send these group memberships with the impersonated user, comma separated.',
    group: 'Advanced',
  },
  {
    name: 'on_error',
    label: 'On error',
    type: 'string',
    required: false,
    description: 'Fail the block, or record the outcome and let the test continue.',
    enumValues: ['fail', 'record'],
    enumLabels: { fail: 'Fail the block', record: 'Record and continue' },
    defaultValue: 'fail',
    noExpression: true,
    group: 'Failure Handling',
  },
]

function tail(extra: Record<string, unknown> = {}) {
  return k8sBlockTailInputs({
    namespace: { description: NAMESPACE_DESCRIPTION },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
    ...extra,
  })
}

describe('k8sOutputFormatInput', () => {
  it('still starts on Map when called with no options', () => {
    expect(k8sOutputFormatInput().defaultValue).toBe('map')
  })

  it('still offers the four formats in the family order', () => {
    expect(k8sOutputFormatInput().enumValues).toEqual(['map', 'table', 'json', 'yaml'])
  })

  it('starts on Table when a Helm block asks for it', () => {
    expect(k8sOutputFormatInput({ defaultValue: 'table' }).defaultValue).toBe('table')
  })

  it('keeps the family description when only the default is overridden', () => {
    expect(k8sOutputFormatInput({ defaultValue: 'table' }).description).toBe(
      k8sOutputFormatInput().description,
    )
  })

  it('takes a description of its own', () => {
    const row = k8sOutputFormatInput({ defaultValue: 'table', description: 'Shape of Result.' })
    expect(row.description).toBe('Shape of Result.')
  })

  it('keeps the row name, label and expression rule whatever the options', () => {
    const row = k8sOutputFormatInput({ defaultValue: 'table' })
    expect(row.name).toBe('output_format')
    expect(row.label).toBe('Output Format')
    expect(row.noExpression).toBe(true)
  })
})

describe('k8sTimeoutInput', () => {
  it('keeps the family wording when no description is given', () => {
    expect(k8sTimeoutInput(30).description).toBe('Request timeout in seconds')
  })

  it('carries the default it is given', () => {
    expect(k8sTimeoutInput(300).defaultValue).toBe(300)
  })

  it('takes a description of its own', () => {
    expect(k8sTimeoutInput(300, "helm's own operation timeout").description).toBe(
      "helm's own operation timeout",
    )
  })
})

describe('k8sConnectionInputs', () => {
  it('still returns the session and the timeout, in Connection', () => {
    const rows = k8sConnectionInputs()
    expect(rows.map((r) => r.name)).toEqual(['session', 'timeout'])
    expect(rows.every((r) => r.group === 'Connection')).toBe(true)
  })

  it('still defaults the timeout to thirty seconds', () => {
    expect(k8sConnectionInputs()[1].defaultValue).toBe(30)
  })

  it('passes a Helm timeout default through', () => {
    expect(k8sConnectionInputs(300)[1].defaultValue).toBe(300)
  })

  it('passes a Helm timeout description through', () => {
    const rows = k8sConnectionInputs(300, "helm's own operation timeout")
    expect(rows[1].description).toBe("helm's own operation timeout")
  })
})

describe('k8sBlockTailInputs', () => {
  it('still returns exactly the four rows the K8s descriptors get today', () => {
    expect(tail().map((r) => r.name)).toEqual(TAIL_ROWS)
  })

  it('still files three rows in Advanced and one in Failure Handling', () => {
    expect(tail().map((r) => r.group)).toEqual([
      'Advanced',
      'Advanced',
      'Advanced',
      'Failure Handling',
    ])
  })

  it('places extra Advanced rows directly after Namespace', () => {
    const extra = param('create_namespace', 'Create Namespace', 'boolean', false, 'Create it.')
    const rows = tail({ advancedAfterNamespace: [extra] })

    expect(rows.map((r) => r.name)).toEqual([
      'namespace',
      'create_namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('files the extra Advanced rows in Advanced', () => {
    const extra = param('helm_path', 'Helm Path', 'string', false, 'The executable.')
    const rows = tail({ advancedAfterNamespace: [extra] })

    expect(rows[1].group).toBe('Advanced')
  })

  it('places extra Failure Handling rows directly before On error', () => {
    const atomic = param('atomic', 'Atomic', 'boolean', false, 'Roll back on failure.')
    const rows = tail({ failureHandlingBeforeOnError: [atomic] })

    expect(rows.map((r) => r.name)).toEqual([
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'atomic',
      'on_error',
    ])
  })

  it('files the extra Failure Handling rows in Failure Handling', () => {
    const atomic = param('atomic', 'Atomic', 'boolean', false, 'Roll back on failure.')
    const rows = tail({ failureHandlingBeforeOnError: [atomic] })

    expect(rows[3].group).toBe('Failure Handling')
  })

  it('keeps both insertion points in order when a block uses both', () => {
    const rows = tail({
      advancedAfterNamespace: [
        param('helm_path', 'Helm Path', 'string', false, 'The executable.'),
      ],
      failureHandlingBeforeOnError: [
        param('atomic', 'Atomic', 'boolean', false, 'Roll back on failure.'),
        param('cleanup_on_fail', 'Cleanup on Fail', 'boolean', false, 'Remove what failed.'),
      ],
    })

    expect(rows.map((r) => r.name)).toEqual([
      'namespace',
      'helm_path',
      'impersonate_user',
      'impersonate_groups',
      'atomic',
      'cleanup_on_fail',
      'on_error',
    ])
  })

  it('still returns the plain tail, field for field, when no block passes identity rows', () => {
    expect(tail()).toEqual(PLAIN_TAIL)
    expect(tail({ advancedAfterIdentity: [] })).toEqual(PLAIN_TAIL)
  })

  it('places extra Advanced rows directly after Impersonate groups (K8SEXEC-10)', () => {
    const size = param('max_size_mib', 'Max size (MiB)', 'integer', false, 'Size.')
    const files = param('max_files', 'Max files', 'integer', false, 'Files.')
    const rows = tail({ advancedAfterIdentity: [size, files] })

    expect(rows.map((r) => r.name)).toEqual([
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'max_size_mib',
      'max_files',
      'on_error',
    ])
  })

  it('files the rows placed after identity in Advanced, every other field kept', () => {
    const size = param('max_size_mib', 'Max size (MiB)', 'integer', false, 'Size.', {
      defaultValue: 256,
      minimum: 0,
      showWhen: { field: 'direction', values: ['from_pod'] },
      group: 'Copy',
    })
    const rows = tail({ advancedAfterIdentity: [size] })

    expect(rows[3]).toEqual({ ...size, group: 'Advanced' })
  })

  it('keeps all three insertion points in order when a block uses them together', () => {
    const rows = tail({
      advancedAfterNamespace: [
        param('helm_path', 'Helm Path', 'string', false, 'The executable.'),
      ],
      advancedAfterIdentity: [
        param('max_files', 'Max files', 'integer', false, 'Files.'),
      ],
      failureHandlingBeforeOnError: [
        param('atomic', 'Atomic', 'boolean', false, 'Roll back on failure.'),
      ],
    })

    expect(rows.map((r) => [r.name, r.group])).toEqual([
      ['namespace', 'Advanced'],
      ['helm_path', 'Advanced'],
      ['impersonate_user', 'Advanced'],
      ['impersonate_groups', 'Advanced'],
      ['max_files', 'Advanced'],
      ['atomic', 'Failure Handling'],
      ['on_error', 'Failure Handling'],
    ])
  })

  it('still honors the Namespace gating a block passes', () => {
    const rows = tail({ namespace: { description: NAMESPACE_DESCRIPTION, retainOnHide: true } })

    expect(rows[0].retainOnHide).toBe(true)
    expect(rows[0].description).toBe(NAMESPACE_DESCRIPTION)
  })
})

describe('k8sBlockGroups', () => {
  const verb = group('Install', { description: 'Chart, release and values', defaultExpanded: true })

  it('still names the four groups in the family order', () => {
    const groups = k8sBlockGroups(verb, K8S_ADVANCED_DESCRIPTION)

    expect(Object.keys(groups)).toEqual([
      'Connection',
      'Install',
      'Advanced',
      'Failure Handling',
    ])
  })

  it('still describes Connection as the session and the request timeout', () => {
    const groups = k8sBlockGroups(verb, K8S_ADVANCED_DESCRIPTION)

    expect(groups['Connection'].description).toBe('K8s Session and request timeout')
  })

  it('takes a Connection description of its own', () => {
    const groups = k8sBlockGroups(
      verb,
      K8S_ADVANCED_DESCRIPTION,
      "K8s Session and helm's operation timeout",
    )

    expect(groups['Connection'].description).toBe("K8s Session and helm's operation timeout")
  })

  it('still opens Connection', () => {
    expect(k8sBlockGroups(verb, K8S_ADVANCED_DESCRIPTION)['Connection'].defaultExpanded).toBe(true)
  })

  it('keeps the family Advanced footer for the blocks that pass no limits', () => {
    expect(K8S_ADVANCED_DESCRIPTION).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('still carries the Advanced description it is given', () => {
    const groups = k8sBlockGroups(verb, 'Session overrides and the helm executable')

    expect(groups['Advanced'].description).toBe('Session overrides and the helm executable')
  })
})

// Every kind picker is a choice list, so it holds a value from Block creation (REQ-3.1.1.5).
describe('k8sKindPickerInput', () => {
  it('starts on Pod', () => {
    expect(k8sKindPickerInput('object_kind', 'Object Kind', 'The kind.').defaultValue).toBe('Pod')
  })

  it('starts on a kind it offers', () => {
    const picker = k8sKindPickerInput('kind', 'Kind', 'The kind.')

    expect(picker.enumValues).toContain(picker.defaultValue)
  })

  it('starts the Resource Type Kind row on Pod from the same one kind list, the free-text Kind row on nothing', () => {
    const rows = k8sKindInputs('Resource')
    const kind = rows.find((row) => row.name === 'kind')
    const picker = k8sKindPickerInput('object_kind', 'Object Kind', 'The kind.')

    expect(kind?.defaultValue).toBe('Pod')
    expect(kind?.enumValues).toEqual(picker.enumValues)
    expect(rows.find((row) => row.name === 'kind_custom')?.defaultValue).toBeUndefined()
  })
})
