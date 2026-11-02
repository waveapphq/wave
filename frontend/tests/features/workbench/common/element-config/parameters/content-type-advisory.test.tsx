/**
 * JSON-body-without-Content-Type advisory (the text
 * mode JSON advisory stays). Non-blocking: a body value that parses as JSON
 * while the sibling headers map carries no Content-Type row gets an amber
 * in-field icon on the Body value slot.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  needsContentTypeAdvisory,
} from '@/features/workbench/common/element-config/parameters/content-type-advisory'
import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

describe('needsContentTypeAdvisory - JSON detection', () => {
  it('fires for a JSON object body with no headers at all', () => {
    expect(needsContentTypeAdvisory('{"a": 1}', undefined)).toBe(true)
  })

  it('fires for a JSON array body', () => {
    expect(needsContentTypeAdvisory('[1, 2]', {})).toBe(true)
  })

  it('forgives surrounding whitespace around the JSON', () => {
    expect(needsContentTypeAdvisory('  {"a": 1}  ', {})).toBe(true)
  })

  it('stays silent for a plain-text body', () => {
    expect(needsContentTypeAdvisory('hello world', {})).toBe(false)
  })

  it('stays silent for an empty body', () => {
    expect(needsContentTypeAdvisory('', {})).toBe(false)
  })

  it('stays silent for a JSON-looking body that does not parse', () => {
    expect(needsContentTypeAdvisory('{broken', {})).toBe(false)
    expect(needsContentTypeAdvisory('[broken', {})).toBe(false)
  })

  it('stays silent for a non-string body value', () => {
    expect(needsContentTypeAdvisory(42, {})).toBe(false)
    expect(needsContentTypeAdvisory(undefined, {})).toBe(false)
  })
})

describe('needsContentTypeAdvisory - headers inspection', () => {
  const JSON_BODY = '{"a": 1}'

  it('fires when the headers map is empty', () => {
    expect(needsContentTypeAdvisory(JSON_BODY, { headers: {} })).toBe(true)
  })

  it('fires when headers carry no Content-Type row', () => {
    expect(needsContentTypeAdvisory(JSON_BODY, { headers: { 'X-Trace': '1' } })).toBe(true)
  })

  it('stays silent when a Content-Type row exists (case-insensitive, trimmed)', () => {
    expect(
      needsContentTypeAdvisory(JSON_BODY, { headers: { 'content-type': 'application/json' } }),
    ).toBe(false)
    expect(
      needsContentTypeAdvisory(JSON_BODY, { headers: { ' Content-Type ': 'application/json' } }),
    ).toBe(false)
  })

  it('fires when the headers value is not a plain map (null / array / string)', () => {
    expect(needsContentTypeAdvisory(JSON_BODY, { headers: null })).toBe(true)
    expect(needsContentTypeAdvisory(JSON_BODY, { headers: ['Content-Type'] })).toBe(true)
    expect(needsContentTypeAdvisory(JSON_BODY, { headers: 'Content-Type: x' })).toBe(true)
  })
})

describe('ContentTypeAdvisoryIcon - in-field advisory on the Body value slot', () => {
  const params: Parameter[] = [
    { name: 'body', label: 'Body', type: 'string', required: false, contentTypeAdvisory: true },
    { name: 'headers', label: 'Headers', type: 'map', required: false },
  ]

  function renderTable(values: Record<string, unknown>) {
    render(
      <ParameterTable
        mode="input"
        parameters={params}
        values={values}
        onChange={vi.fn()}
        availableVariables={[]}
      />,
    )
  }

  it('shows the amber icon for a JSON body while no Content-Type header exists', () => {
    renderTable({ body: '{"a": 1}' })
    expect(screen.getByLabelText('Missing Content-Type')).toBeInTheDocument()
  })

  it('hides the icon once a Content-Type header row exists', () => {
    renderTable({ body: '{"a": 1}', headers: { 'Content-Type': 'application/json' } })
    expect(screen.queryByLabelText('Missing Content-Type')).not.toBeInTheDocument()
  })

  it('renders no icon for a plain-text body', () => {
    renderTable({ body: 'plain text' })
    expect(screen.queryByLabelText('Missing Content-Type')).not.toBeInTheDocument()
  })
})
