/**
 * downloadBlob Tests
 *
 * Shared anchor-click blob download helper promoted from the inline
 * createObjectURL copies duplicated across export flows. New report
 * download code consumes this.
 *
 * Module: frontend/src/lib/download-blob.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob } from '@/lib/download-blob'

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test-url'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates an object URL for the blob, clicks an anchor with the filename, and revokes the URL', () => {
    const clickSpy = vi.fn()
    const anchor = document.createElement('a')
    anchor.click = clickSpy
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor)

    const blob = new Blob(['{"a":1}'], { type: 'application/json' })
    downloadBlob(blob, 'report-exec-1.json')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(anchor.href).toContain('blob:test-url')
    expect(anchor.download).toBe('report-exec-1.json')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
  })

  it('revokes the object URL even when used for a second download', () => {
    const anchors = [document.createElement('a'), document.createElement('a')]
    anchors.forEach((a) => {
      a.click = vi.fn()
    })
    const createElement = vi.spyOn(document, 'createElement')
    createElement.mockReturnValueOnce(anchors[0]).mockReturnValueOnce(anchors[1])

    downloadBlob(new Blob(['x']), 'one.json')
    downloadBlob(new Blob(['y']), 'two.html')

    expect(anchors[0].download).toBe('one.json')
    expect(anchors[1].download).toBe('two.html')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
