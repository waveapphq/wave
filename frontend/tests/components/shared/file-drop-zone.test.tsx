/**
 * Shared file drop zone used by the import dialog (default layout) and the
 * Add Certificate dialog (compact one-row layout, NET-8).
 *
 * Module: frontend/src/components/shared/file-drop-zone.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileDropZone } from '@/components/shared/file-drop-zone'

const ACCEPT = '.pem,.crt,.cer'
const ACCEPT_LABEL = '.pem, .crt, or .cer'
const PROMPT = 'Click or drop file here'

type ZoneProps = Partial<Parameters<typeof FileDropZone>[0]>

function renderZone(props: ZoneProps = {}) {
  const onFile = props.onFile ?? vi.fn()
  const testId = props['data-testid'] ?? 'cert-drop-zone'
  render(
    <FileDropZone
      accept={ACCEPT}
      acceptLabel={ACCEPT_LABEL}
      {...props}
      data-testid={testId}
      onFile={onFile}
    />,
  )
  return {
    onFile,
    zone: screen.getByTestId(testId),
    input: screen.getByTestId('file-input') as HTMLInputElement,
  }
}

function trackPickerOpens(input: HTMLInputElement) {
  const opened = vi.fn()
  input.addEventListener('click', opened)
  return opened
}

function fireDragOver(target: Element) {
  act(() => {
    const evt = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'dataTransfer', { value: { dropEffect: '' } })
    target.dispatchEvent(evt)
  })
}

function fireDrop(target: Element, files: File[]) {
  act(() => {
    const evt = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'dataTransfer', { value: { files } })
    target.dispatchEvent(evt)
  })
}

function pemFile(name = 'root-ca.pem') {
  return new File(['-----BEGIN CERTIFICATE-----'], name, { type: 'application/x-pem-file' })
}

describe('FileDropZone - structure', () => {
  it('renders the zone as a button named by its prompt and accepted types', () => {
    const { zone } = renderZone()

    expect(screen.getByRole('button', { name: /Click or drop file here/ })).toBe(zone)
    expect(zone.tagName).toBe('BUTTON')
    expect(zone).toHaveAttribute('type', 'button')
    expect(within(zone).getByText(PROMPT)).toBeInTheDocument()
    expect(within(zone).getByText(ACCEPT_LABEL)).toBeInTheDocument()
  })

  it('puts the data-testid on the zone button', () => {
    const { zone } = renderZone({ 'data-testid': 'drop-zone' })

    expect(zone).toBe(screen.getByRole('button', { name: /Click or drop file here/ }))
  })

  it('renders a file input outside the zone that carries the accept list', () => {
    const { zone, input } = renderZone()

    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', ACCEPT)
    expect(zone).not.toContainElement(input)
  })

  it('uses the default layout when layout is omitted', () => {
    const { zone } = renderZone()

    expect(zone).toHaveAttribute('data-layout', 'default')
  })

  it('uses the default layout when asked for it', () => {
    const { zone } = renderZone({ layout: 'default' })

    expect(zone).toHaveAttribute('data-layout', 'default')
  })

  it('renders the compact layout with the same prompt and accepted types in one zone', () => {
    const { zone } = renderZone({ layout: 'compact' })

    expect(zone).toHaveAttribute('data-layout', 'compact')
    expect(within(zone).getByText(PROMPT)).toBeInTheDocument()
    expect(within(zone).getByText(ACCEPT_LABEL)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Click or drop file here/ })).toBe(zone)
  })

  it.each(['default', 'compact'] as const)(
    'shows the selected file name in place of the prompt (%s layout)',
    (layout) => {
      const { zone } = renderZone({ layout, selectedName: 'corp-root.crt' })

      expect(within(zone).getByText('corp-root.crt')).toBeInTheDocument()
      expect(within(zone).queryByText(PROMPT)).not.toBeInTheDocument()
      expect(within(zone).getByText(ACCEPT_LABEL)).toBeInTheDocument()
    },
  )
})

describe('FileDropZone - opening the file picker', () => {
  it('opens the picker on click', async () => {
    const user = userEvent.setup()
    const { zone, input } = renderZone()
    const opened = trackPickerOpens(input)

    await user.click(zone)

    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('is reachable by Tab', async () => {
    const user = userEvent.setup()
    const { zone } = renderZone()

    await user.tab()

    expect(zone).toHaveFocus()
  })

  it('opens the picker on Enter', async () => {
    const user = userEvent.setup()
    const { zone, input } = renderZone()
    const opened = trackPickerOpens(input)

    zone.focus()
    await user.keyboard('{Enter}')

    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('opens the picker on Space', async () => {
    const user = userEvent.setup()
    const { zone, input } = renderZone({ layout: 'compact' })
    const opened = trackPickerOpens(input)

    zone.focus()
    await user.keyboard(' ')

    expect(opened).toHaveBeenCalledTimes(1)
  })
})

describe('FileDropZone - receiving a file', () => {
  it('hands a chosen file to onFile', async () => {
    const user = userEvent.setup()
    const { input, onFile } = renderZone()
    const file = pemFile()

    await user.upload(input, file)

    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('does not call onFile when the picker closes without a file', () => {
    const { input, onFile } = renderZone()

    fireEvent.change(input, { target: { files: [] } })

    expect(onFile).not.toHaveBeenCalled()
  })

  it.each(['default', 'compact'] as const)(
    'hands the first dropped file to onFile (%s layout)',
    (layout) => {
      const { zone, onFile } = renderZone({ layout })
      const first = pemFile('first.pem')
      const second = pemFile('second.pem')

      fireDrop(within(zone).getByText(PROMPT), [first, second])

      expect(onFile).toHaveBeenCalledTimes(1)
      expect(onFile).toHaveBeenCalledWith(first)
    },
  )

  it('ignores a file dropped outside the zone', () => {
    const { onFile } = renderZone()

    fireDrop(document.body, [pemFile()])

    expect(onFile).not.toHaveBeenCalled()
  })

  it.each(['default', 'compact'] as const)(
    'highlights the zone while a file is dragged over it (%s layout)',
    (layout) => {
      const { zone } = renderZone({ layout })

      fireDragOver(within(zone).getByText(PROMPT))
      expect(zone).toHaveClass('border-primary', 'bg-primary/5')

      fireDragOver(document.body)
      expect(zone).not.toHaveClass('bg-primary/5')
    },
  )
})

describe('FileDropZone - disabled', () => {
  it('is enabled by default', () => {
    const { zone, input } = renderZone()

    expect(zone).toBeEnabled()
    expect(input).toBeEnabled()
  })

  it('disables the zone button and the file input when enabled is false', () => {
    const { zone, input } = renderZone({ enabled: false })

    expect(zone).toBeDisabled()
    expect(input).toBeDisabled()
  })

  it('does not open the picker when disabled', async () => {
    const user = userEvent.setup()
    const { zone, input } = renderZone({ enabled: false })
    const opened = trackPickerOpens(input)

    await user.click(zone)

    expect(opened).not.toHaveBeenCalled()
  })

  it('ignores a dropped file and shows no highlight when disabled', () => {
    const { zone, onFile } = renderZone({ enabled: false, layout: 'compact' })
    const target = within(zone).getByText(PROMPT)

    fireDragOver(target)
    expect(zone).not.toHaveClass('bg-primary/5')

    fireDrop(target, [pemFile()])
    expect(onFile).not.toHaveBeenCalled()
  })
})
