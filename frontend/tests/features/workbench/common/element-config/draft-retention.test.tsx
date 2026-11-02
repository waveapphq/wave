/**
 * Body-mode draft retention + save-time stripping (REQ-3.4.1.4, HTTP-14).
 *
 * Params marked retainOnHide survive the hidden-param auto-clear when a mode
 * switch hides them (minutes of multipart config must not vanish in the
 * draft); buildSaveData then persists only the active mode's params, stripping
 * hidden retained values AND their dotted expression fields at save.
 */
import { describe, it, expect, vi } from 'vitest'
import { act, render } from '@testing-library/react'

import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import { buildSaveData } from '@/features/workbench/common/element-config/save-logic'
import type { Parameter } from '@/features/workbench/common/element-config/types'

const BODY_MODE: Parameter = {
  name: 'body_mode',
  label: 'Body Mode',
  type: 'string',
  required: false,
  enumValues: ['text', 'form', 'multipart', 'file'],
  defaultValue: 'text',
}

const BODY: Parameter = {
  name: 'body',
  label: 'Body',
  type: 'string',
  required: false,
  showWhen: { field: 'body_mode', values: ['text'] },
  retainOnHide: true,
}

const FORM_FIELDS: Parameter = {
  name: 'form_fields',
  label: 'Form Fields',
  type: 'map',
  required: false,
  showWhen: { field: 'body_mode', values: ['form'] },
  retainOnHide: true,
}

const PARTS: Parameter = {
  name: 'parts',
  label: 'Parts',
  type: 'array',
  required: false,
  showWhen: { field: 'body_mode', values: ['multipart'] },
  retainOnHide: true,
}

const FILE_SOURCE: Parameter = {
  name: 'file_source',
  label: 'File Source',
  type: 'string',
  required: false,
  showWhen: { field: 'body_mode', values: ['file'] },
  retainOnHide: true,
}

// Control param WITHOUT retainOnHide - the existing auto-clear must still run.
const LEGACY_GATED: Parameter = {
  name: 'legacy_gated',
  label: 'Legacy Gated',
  type: 'string',
  required: false,
  showWhen: { field: 'body_mode', values: ['form'] },
}

const ALL_PARAMS = [BODY_MODE, BODY, FORM_FIELDS, PARTS, FILE_SOURCE, LEGACY_GATED] as Parameter[]

async function renderTable(values: Record<string, unknown>, onChange = vi.fn()) {
  const view = render(
    <ParameterTable
      mode="input"
      parameters={ALL_PARAMS}
      values={values}
      onChange={onChange}
      availableVariables={[]}
      expressionFields={[]}
      onExpressionFieldsChange={vi.fn()}
      templateFields={[]}
      onTemplateFieldsChange={vi.fn()}
    />,
  )
  // The mode Select schedules post-mount updates; flush them inside act
  await act(async () => {})
  const rerenderWith = (nextValues: Record<string, unknown>) =>
    act(async () => {
      view.rerender(
        <ParameterTable
          mode="input"
          parameters={ALL_PARAMS}
          values={nextValues}
          onChange={onChange}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
        />,
      )
    })
  return { onChange, rerenderWith }
}

describe('ParameterTable - retainOnHide exemption from hidden-param auto-clear', () => {
  it('keeps a retained payload when its mode hides it', async () => {
    const values = { body_mode: 'form', form_fields: { user: 'u' }, legacy_gated: 'x' }
    const { onChange, rerenderWith } = await renderTable(values)
    await rerenderWith({ ...values, body_mode: 'multipart' })

    expect(onChange).not.toHaveBeenCalledWith('form_fields', undefined)
  })

  it('still clears a non-retained param when it hides (existing behavior)', async () => {
    const values = { body_mode: 'form', form_fields: { user: 'u' }, legacy_gated: 'x' }
    const { onChange, rerenderWith } = await renderTable(values)
    await rerenderWith({ ...values, body_mode: 'multipart' })

    expect(onChange).toHaveBeenCalledWith('legacy_gated', undefined)
  })

  it('retains every body-mode payload across a full mode cycle', async () => {
    const values = {
      body_mode: 'text',
      body: '{"q": 1}',
      form_fields: { user: 'u' },
      parts: [{ kind: 'text', name: 'a', value: 'v' }],
      file_source: 'artifact://x.bin',
    }
    const { onChange, rerenderWith } = await renderTable(values)
    await rerenderWith({ ...values, body_mode: 'form' })
    await rerenderWith({ ...values, body_mode: 'file' })

    for (const name of ['body', 'form_fields', 'parts', 'file_source']) {
      expect(onChange).not.toHaveBeenCalledWith(name, undefined)
    }
  })
})

describe('buildSaveData - strips inactive body-mode params at save', () => {
  const baseCtx = {
    elementId: 'node-1',
    selectedVersion: '1.0.0',
    outputBindings: {},
    outputParameters: [],
    versionParameters: ALL_PARAMS,
    name: 'HTTP_1',
    description: '',
    profileBindings: [],
    templateFields: [],
    outputSecretFields: [],
    variables: [],
    isVariableSetter: false,
    isXmlParser: false,
    isJsonParser: false,
    isAssert: false,
    isIfElse: false,
    isSwitch: false,
    isWhile: false,
    assertAssertions: [],
    assertMode: 'split' as const,
    assertFailCurrentScope: false,
    ifElseBranches: [],
    switchBranches: [],
    whileConditions: [],
    variableExpressionKeys: [],
    variableTemplateKeys: [],
    variableSecretKeys: [],
    variableTypes: {},
  }

  it('persists only the active mode payload, dropping hidden retained drafts', () => {
    const { data } = buildSaveData({
      ...baseCtx,
      values: {
        body_mode: 'multipart',
        body: '{"stale": true}',
        form_fields: { user: 'u' },
        parts: [{ kind: 'text', name: 'a', value: 'v' }],
        file_source: 'artifact://stale.bin',
      },
      expressionFields: [],
    })
    expect(data).not.toBeNull()
    expect(data!.values.body_mode).toBe('multipart')
    expect(data!.values.parts).toEqual([{ kind: 'text', name: 'a', value: 'v' }])
    expect(data!.values).not.toHaveProperty('body')
    expect(data!.values).not.toHaveProperty('form_fields')
    expect(data!.values).not.toHaveProperty('file_source')
  })

  it('resolves visibility through the mode default when body_mode is unset', () => {
    const { data } = buildSaveData({
      ...baseCtx,
      values: { body: 'hello', form_fields: { user: 'u' } },
      expressionFields: [],
    })
    expect(data!.values.body).toBe('hello')
    expect(data!.values).not.toHaveProperty('form_fields')
  })

  it('strips the dotted expression fields of a stripped param', () => {
    const { data } = buildSaveData({
      ...baseCtx,
      values: {
        body_mode: 'text',
        body: 'hi',
        form_fields: { user: 'basic_auth(u, p)' },
        url: 'base_url',
      },
      expressionFields: ['form_fields.user', 'url'],
    })
    expect(data!.values).not.toHaveProperty('form_fields')
    expect(data!.expressionFields).toEqual(['url'])
  })

  it('keeps the dotted expression fields of the active mode payload', () => {
    const { data } = buildSaveData({
      ...baseCtx,
      values: { body_mode: 'form', form_fields: { user: 'basic_auth(u, p)' }, url: 'base_url' },
      expressionFields: ['form_fields.user', 'url'],
    })
    expect(data!.values.form_fields).toEqual({ user: 'basic_auth(u, p)' })
    expect(data!.expressionFields).toEqual(['form_fields.user', 'url'])
  })

  it('does not mutate the caller-owned draft values', () => {
    const values = {
      body_mode: 'text',
      body: 'hi',
      form_fields: { user: 'u' },
    }
    buildSaveData({ ...baseCtx, values, expressionFields: [] })
    expect(values.form_fields).toEqual({ user: 'u' })
  })
})
