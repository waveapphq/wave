import { describe, it, expect, vi, afterEach } from 'vitest'

import { copyText } from '@/lib/clipboard'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

function setExecCommand(impl: (command: string) => boolean) {
  document.execCommand = vi.fn(impl)
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  }
  delete (document as { execCommand?: unknown }).execCommand
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('copies via navigator.clipboard when available and resolves true', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    setClipboard({ writeText })
    setExecCommand(() => true)

    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when the native write rejects', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied'))
    setClipboard({ writeText })
    let textareaValue: string | undefined
    setExecCommand(() => {
      textareaValue = document.querySelector('textarea')?.value
      return true
    })

    await expect(copyText('fallback text')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('fallback text')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(textareaValue).toBe('fallback text')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back to execCommand when the clipboard API is absent', async () => {
    // Insecure contexts (plain-HTTP LAN origins) do not expose navigator.clipboard.
    setClipboard(undefined)
    setExecCommand(() => true)

    await expect(copyText('lan copy')).resolves.toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('resolves false when execCommand reports failure', async () => {
    setClipboard(undefined)
    setExecCommand(() => false)

    await expect(copyText('nope')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('resolves false when execCommand is unavailable', async () => {
    setClipboard(undefined)

    await expect(copyText('no exec')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
