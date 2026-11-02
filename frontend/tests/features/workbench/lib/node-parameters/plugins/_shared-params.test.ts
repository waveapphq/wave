/**
 * The family-neutral failure-handling builders every block shares (SHRUN-8, SHRUN-9,
 * REQ-3.4.2.2). The K8s family keeps its cluster wording by passing it in.
 * The collapsed Failure Handling group and its On error row are shared the same way (NETCAT-12).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FAILURE_HANDLING_DESCRIPTION,
  FAILURE_HANDLING_GROUP,
  ON_ERROR_DESCRIPTION,
  RECORD_GATE,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  onErrorInput,
  outputCore,
  streamOutputInput,
  timeoutInput,
} from '@/features/workbench/lib/node-parameters/plugins/_shared-params'
import * as k8sShared from '@/features/workbench/lib/node-parameters/plugins/_k8s-shared'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
} from '@/features/workbench/lib/node-parameters/plugins/_k8s-shared'
import {
  localProcessFailureInputs,
  localProcessGroups,
} from '@/features/workbench/lib/node-parameters/plugins/_local-process-params'
import { group, type OutputParam } from '@/features/workbench/lib/node-parameters/types'

const PLUGINS_SOURCE_DIR = '../../../../../../src/features/workbench/lib/node-parameters/plugins'

const FAILURE_HANDLING_DESCRIPTION_REF = /\bFAILURE_HANDLING_DESCRIPTION\b/

const ON_ERROR_INPUT_REF = /\bonErrorInput\b/

function pluginSource(fileName: string): string {
  return readFileSync(resolve(__dirname, PLUGINS_SOURCE_DIR, fileName), 'utf8')
}

const SUCCESS_DESCRIPTION =
  'True when the script passed. False when it failed and On error is Record and continue.'

const REASON_DESCRIPTION =
  'Why it failed: NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable; empty when it passed.'

const ERROR_DESCRIPTION =
  'The error message when the operation failed under Record and continue; empty otherwise'

const CLUSTER_SUCCESS_DESCRIPTION =
  'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it'

const CLUSTER_REASON_DESCRIPTION =
  'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded'

function core() {
  return outputCore({
    successDescription: SUCCESS_DESCRIPTION,
    reasonDescription: REASON_DESCRIPTION,
  })
}

describe('shared failure-handling constants', () => {
  it('gates on Record and continue through the on_error field', () => {
    expect(RECORD_GATE).toEqual({ field: 'on_error', values: ['record'] })
  })

  it('words On error the same way for every family', () => {
    expect(ON_ERROR_DESCRIPTION).toBe(
      'Fail the block, or record the outcome and let the test continue.',
    )
  })

  it('words the Failure Handling group footer the same way for every family', () => {
    expect(FAILURE_HANDLING_DESCRIPTION).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('outputCore', () => {
  it('gives success, error and reason in that order', () => {
    expect(core().map((o: OutputParam) => o.name)).toEqual(['success', 'error', 'reason'])
  })

  it('labels the three rows', () => {
    expect(core().map((o: OutputParam) => o.label)).toEqual(['Success', 'Error', 'Reason'])
  })

  it('types success as a boolean and the other two as strings', () => {
    expect(core().map((o: OutputParam) => o.type)).toEqual(['boolean', 'string', 'string'])
  })

  it('offers Success whatever On error is set to', () => {
    expect(core()[0].showWhen).toBeUndefined()
  })

  it('gates Error on Record and continue', () => {
    expect(core()[1].showWhen).toEqual(RECORD_GATE)
  })

  it('gates Reason on Record and continue', () => {
    expect(core()[2].showWhen).toEqual(RECORD_GATE)
  })

  it('takes the Success wording from the caller', () => {
    expect(core()[0].description).toBe(SUCCESS_DESCRIPTION)
  })

  it('words Error itself, since the sentence suits every family', () => {
    expect(core()[1].description).toBe(ERROR_DESCRIPTION)
  })

  it('takes the Reason wording from the caller', () => {
    expect(core()[2].description).toBe(REASON_DESCRIPTION)
  })

  it('carries the cluster wording when the K8s family passes it in', () => {
    const rows = outputCore({
      successDescription: CLUSTER_SUCCESS_DESCRIPTION,
      reasonDescription: CLUSTER_REASON_DESCRIPTION,
    })

    expect(rows.map((o: OutputParam) => o.description)).toEqual([
      CLUSTER_SUCCESS_DESCRIPTION,
      ERROR_DESCRIPTION,
      CLUSTER_REASON_DESCRIPTION,
    ])
  })
})

describe('onErrorInput', () => {
  it('names and labels the row', () => {
    const row = onErrorInput(ON_ERROR_DESCRIPTION)

    expect(row.name).toBe('on_error')
    expect(row.label).toBe('On error')
  })

  it('is an optional string row', () => {
    const row = onErrorInput(ON_ERROR_DESCRIPTION)

    expect(row.type).toBe('string')
    expect(row.required).toBe(false)
  })

  it('offers fail and record', () => {
    expect(onErrorInput(ON_ERROR_DESCRIPTION).enumValues).toEqual(['fail', 'record'])
  })

  it('labels the two choices', () => {
    expect(onErrorInput(ON_ERROR_DESCRIPTION).enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
  })

  it('starts on Fail the block', () => {
    expect(onErrorInput(ON_ERROR_DESCRIPTION).defaultValue).toBe('fail')
  })

  it('carries no expression toggle', () => {
    expect(onErrorInput(ON_ERROR_DESCRIPTION).noExpression).toBe(true)
  })

  it('takes the wording from the caller', () => {
    expect(onErrorInput('Cluster wording of its own.').description).toBe(
      'Cluster wording of its own.',
    )
  })
})

describe('timeoutInput', () => {
  it('names and labels the row', () => {
    const row = timeoutInput(300, 'Seconds the script may run before WAVE stops it.')

    expect(row.name).toBe('timeout')
    expect(row.label).toBe('Timeout')
  })

  it('is an optional integer row', () => {
    const row = timeoutInput(300, 'Seconds the script may run before WAVE stops it.')

    expect(row.type).toBe('integer')
    expect(row.required).toBe(false)
  })

  it('carries the default it is given', () => {
    expect(timeoutInput(300, 'Seconds the script may run before WAVE stops it.').defaultValue).toBe(
      300,
    )
  })

  it('carries a different default for a family that asks for one', () => {
    expect(timeoutInput(30, 'Request timeout in seconds').defaultValue).toBe(30)
  })

  it('takes the wording from the caller', () => {
    expect(timeoutInput(30, 'Request timeout in seconds').description).toBe(
      'Request timeout in seconds',
    )
  })
})

describe('the Timeout row declares its lowest value (PING-17)', () => {
  it('carries the lowest value the shared backend Timeout row declares', () => {
    expect(timeoutInput(30, 'Request timeout in seconds').minimum).toBe(1)
  })

  it('carries that same lowest value whatever default the caller asks for', () => {
    expect(timeoutInput(10, 'Seconds allowed for each connection attempt.').minimum).toBe(1)
    expect(timeoutInput(300, 'Seconds the script may run before WAVE stops it.').minimum).toBe(1)
  })

  it('declares no highest value', () => {
    expect(timeoutInput(30, 'Request timeout in seconds').maximum).toBeUndefined()
  })
})

describe('streamOutputInput', () => {
  const LOCAL_PROCESS_DESCRIPTION =
    'Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN.'

  const PING_DESCRIPTION = 'Write a line to the run console for each reply as it arrives.'

  it('names and labels the row', () => {
    const row = streamOutputInput(LOCAL_PROCESS_DESCRIPTION)

    expect(row.name).toBe('stream_output')
    expect(row.label).toBe('Log Output')
  })

  it('is an optional boolean row', () => {
    const row = streamOutputInput(LOCAL_PROCESS_DESCRIPTION)

    expect(row.type).toBe('boolean')
    expect(row.required).toBe(false)
  })

  it('starts off', () => {
    expect(streamOutputInput(LOCAL_PROCESS_DESCRIPTION).defaultValue).toBe(false)
  })

  it('sets no group, so each caller places the row itself', () => {
    const row = streamOutputInput(LOCAL_PROCESS_DESCRIPTION)

    expect(row.group).toBeUndefined()
    expect(Object.keys(row)).not.toContain('group')
  })

  it('takes the wording from the caller', () => {
    expect(streamOutputInput(PING_DESCRIPTION).description).toBe(PING_DESCRIPTION)
  })

  it('gives two callers the same row in their own wording', () => {
    expect(streamOutputInput(LOCAL_PROCESS_DESCRIPTION)).toEqual({
      name: 'stream_output',
      label: 'Log Output',
      type: 'boolean',
      required: false,
      description: LOCAL_PROCESS_DESCRIPTION,
      defaultValue: false,
    })
    expect(streamOutputInput(PING_DESCRIPTION)).toEqual({
      name: 'stream_output',
      label: 'Log Output',
      type: 'boolean',
      required: false,
      description: PING_DESCRIPTION,
      defaultValue: false,
    })
  })
})

describe('FAILURE_HANDLING_GROUP', () => {
  it('names the group Failure Handling', () => {
    expect(FAILURE_HANDLING_GROUP).toBe('Failure Handling')
  })
})

describe('failureHandlingGroup', () => {
  it('carries the name and the shared footer, and nothing else', () => {
    expect(failureHandlingGroup()).toStrictEqual({
      name: 'Failure Handling',
      description: FAILURE_HANDLING_DESCRIPTION,
    })
  })

  it('is named by the group-name constant', () => {
    expect(failureHandlingGroup().name).toBe(FAILURE_HANDLING_GROUP)
  })

  it('starts collapsed', () => {
    expect(failureHandlingGroup().defaultExpanded).toBeUndefined()
  })
})

describe('failureHandlingOnErrorInput', () => {
  it('is the shared On error row placed in Failure Handling', () => {
    expect(failureHandlingOnErrorInput()).toEqual({
      ...onErrorInput(ON_ERROR_DESCRIPTION),
      group: 'Failure Handling',
    })
  })

  it("takes a family's own wording", () => {
    expect(failureHandlingOnErrorInput('Cluster wording of its own.')).toEqual({
      ...onErrorInput('Cluster wording of its own.'),
      group: 'Failure Handling',
    })
  })

  it('keeps the On error name, label, choices, default and select control', () => {
    const row = failureHandlingOnErrorInput()

    expect(row.name).toBe('on_error')
    expect(row.label).toBe('On error')
    expect(row.enumValues).toEqual(['fail', 'record'])
    expect(row.defaultValue).toBe('fail')
    expect(row.noExpression).toBe(true)
  })
})

describe('the families build Failure Handling from the shared pair', () => {
  it('gives the local-process blocks the shared group', () => {
    expect(localProcessGroups(group('Script'), 'script')['Failure Handling']).toEqual(
      failureHandlingGroup(),
    )
  })

  it('gives the local-process blocks the shared On error row', () => {
    expect(localProcessFailureInputs()).toEqual([failureHandlingOnErrorInput()])
  })

  it('gives the K8s blocks the shared group', () => {
    expect(k8sBlockGroups(group('Get'), K8S_ADVANCED_DESCRIPTION)['Failure Handling']).toEqual(
      failureHandlingGroup(),
    )
  })

  it('closes the K8s tail with the shared On error row', () => {
    const rows = k8sBlockTailInputs({
      namespace: { description: 'N' },
      impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
    })

    expect(rows[rows.length - 1]).toEqual(failureHandlingOnErrorInput())
  })

  it('closes the K8s tail with the shared row in the cluster wording', () => {
    const rows = k8sBlockTailInputs({
      namespace: { description: 'N' },
      impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
      onErrorDescription: 'Cluster wording.',
    })

    expect(rows[rows.length - 1]).toEqual(failureHandlingOnErrorInput('Cluster wording.'))
  })

  it('leaves the local-process module building neither the group nor the row itself', () => {
    const source = pluginSource('_local-process-params.ts')

    expect(source).not.toMatch(FAILURE_HANDLING_DESCRIPTION_REF)
    expect(source).not.toMatch(ON_ERROR_INPUT_REF)
  })

  it('leaves the K8s module building neither the group nor the row itself', () => {
    const source = pluginSource('_k8s-shared.ts')

    expect(source).not.toMatch(FAILURE_HANDLING_DESCRIPTION_REF)
    expect(source).not.toMatch(ON_ERROR_INPUT_REF)
  })
})

describe('the K8s module after the move', () => {
  it('no longer exports the On error builder', () => {
    expect(Object.keys(k8sShared)).not.toContain('k8sOnErrorInput')
  })

  it('no longer exports the record gate', () => {
    expect(Object.keys(k8sShared)).not.toContain('K8S_RECORD_GATE')
  })

  it('no longer exports the On error wording', () => {
    expect(Object.keys(k8sShared)).not.toContain('K8S_ON_ERROR_DESCRIPTION')
  })

  it('keeps the builders its own family still calls', () => {
    const names = Object.keys(k8sShared)

    expect(names).toContain('k8sOutputCore')
    expect(names).toContain('k8sTimeoutInput')
    expect(names).toContain('k8sBlockGroups')
  })
})

describe('module boundaries', () => {
  it('does not import the K8s family module', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../../../../../src/features/workbench/lib/node-parameters/plugins/_shared-params.ts',
      ),
      'utf8',
    )

    expect(source).not.toMatch(/_k8s-shared/)
  })
})
