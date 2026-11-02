/**
 * useTransientFormat tests
 *
 * The shared transient string-Format engine behind every string value editor
 * (inspect panel, create modal, Edit-value sheet): an Auto/Plain/JSON/XML/YAML
 * pick whose Auto resolves to the format detected LIVE from the current text.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTransientFormat } from '@/features/workbench/common/variables/variable-inspect-modal/use-transient-format'

describe('useTransientFormat', () => {
  it('defaults to Auto and detects the format live from the text', () => {
    const { result } = renderHook(() => useTransientFormat('plain text', true))
    expect(result.current.format).toBe('auto')
    expect(result.current.detectedFormat).toBe('plain')
    expect(result.current.resolvedFormat).toBe('plain')
    expect(result.current.isDataFormat).toBe(false)
  })

  it('re-detects live when the text changes (Auto tracks what you type)', () => {
    const { result, rerender } = renderHook(({ text }) => useTransientFormat(text, true), {
      initialProps: { text: 'plain' },
    })
    expect(result.current.detectedFormat).toBe('plain')

    rerender({ text: '{"a":1}' })
    expect(result.current.detectedFormat).toBe('json')
    expect(result.current.resolvedFormat).toBe('json')
    expect(result.current.isDataFormat).toBe(true)
  })

  it('honors an explicit pick over Auto detection', () => {
    const { result } = renderHook(() => useTransientFormat('{"a":1}', true))
    expect(result.current.resolvedFormat).toBe('json')

    act(() => result.current.setFormat('plain'))
    expect(result.current.resolvedFormat).toBe('plain')
    expect(result.current.isDataFormat).toBe(false)
  })

  it('forces plain with no detection when disabled (complex / template value)', () => {
    const { result } = renderHook(() => useTransientFormat('{"a":1}', false))
    expect(result.current.detectedFormat).toBe('plain')
    expect(result.current.resolvedFormat).toBe('plain')
    expect(result.current.isDataFormat).toBe(false)
  })
})

// A locked-format param (single allowedFormats) pins the format and
// suppresses live detection - the picker is shown disabled, never Auto.
describe('useTransientFormat - lockedFormat', () => {
  it('pins format and resolvedFormat to the locked format for plain-looking text', () => {
    const { result } = renderHook(() => useTransientFormat('plain text', true, 'json'))
    expect(result.current.format).toBe('json')
    expect(result.current.resolvedFormat).toBe('json')
    expect(result.current.isDataFormat).toBe(true)
  })

  it('pins over live detection (xml-looking text stays the locked json)', () => {
    const { result } = renderHook(() => useTransientFormat('<root/>', true, 'json'))
    expect(result.current.resolvedFormat).toBe('json')
    expect(result.current.detectedFormat).toBe('json')
  })

  it('locks to plain (isDataFormat false - no pretty-print button)', () => {
    const { result } = renderHook(() => useTransientFormat('{"a":1}', true, 'plain'))
    expect(result.current.format).toBe('plain')
    expect(result.current.resolvedFormat).toBe('plain')
    expect(result.current.isDataFormat).toBe(false)
  })

  it('does not re-detect when locked text changes (stays pinned)', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTransientFormat(text, true, 'xml'),
      { initialProps: { text: '<root/>' } },
    )
    expect(result.current.resolvedFormat).toBe('xml')
    rerender({ text: '{"a":1}' })
    expect(result.current.resolvedFormat).toBe('xml')
  })
})

// PYRUN-13: the Python script body locks the format to python. Python is a code
// format, not a data format - there is no pretty-print button - and Auto never
// picks it, so it only ever arrives as a lock.
describe('useTransientFormat - locked python (PYRUN-13)', () => {
  it('pins format, detectedFormat and resolvedFormat to python', () => {
    const { result } = renderHook(() => useTransientFormat('x = 1\n', true, 'python'))
    expect(result.current.format).toBe('python')
    expect(result.current.detectedFormat).toBe('python')
    expect(result.current.resolvedFormat).toBe('python')
  })

  it('reports isDataFormat false (no pretty-print button)', () => {
    const { result } = renderHook(() => useTransientFormat('x = 1\n', true, 'python'))
    expect(result.current.isDataFormat).toBe(false)
  })

  it('stays pinned to python when the text changes', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTransientFormat(text, true, 'python'),
      { initialProps: { text: 'x = 1\n' } },
    )
    expect(result.current.resolvedFormat).toBe('python')

    rerender({ text: '{"a":1}' })
    expect(result.current.resolvedFormat).toBe('python')
    expect(result.current.isDataFormat).toBe(false)
  })

  it('never resolves to python through Auto detection', () => {
    const { result } = renderHook(() =>
      useTransientFormat('def main():\n    print("hi")\n', true),
    )
    expect(result.current.format).toBe('auto')
    expect(result.current.detectedFormat).not.toBe('python')
    expect(result.current.resolvedFormat).not.toBe('python')
    expect(result.current.isDataFormat).toBe(false)
  })
})
