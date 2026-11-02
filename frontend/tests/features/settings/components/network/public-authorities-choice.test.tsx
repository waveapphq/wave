// REQ-4.5.16 public authorities choice (NET-5, NET-6)
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { PublicAuthoritiesChoice } from '@/features/settings/components/network/public-authorities-choice'

type ChoiceProps = ComponentProps<typeof PublicAuthoritiesChoice>
type User = ReturnType<typeof userEvent.setup>

const BUILTIN = { label: 'June 2026', count: 146 }
const NOT_FOUND = 'No certificate store found on this WAVE host'

function renderChoice(props: Partial<ChoiceProps> = {}) {
  const onChange = props.onChange ?? vi.fn()
  render(
    <PublicAuthoritiesChoice
      value="builtin"
      builtin={BUILTIN}
      hostStoreFound
      {...props}
      onChange={onChange}
    />,
  )
  return { onChange }
}

const builtinRadio = () => screen.getByRole('radio', { name: /WAVE's built-in list/ })
const hostRadio = () => screen.getByRole('radio', { name: /This WAVE host's store/ })

async function pressArrow(user: User, key: string) {
  await user.keyboard(`{${key}>}`)
  // Radix moves roving focus in a timeout; flush it inside act.
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  await user.keyboard(`{/${key}}`)
}

describe('PublicAuthoritiesChoice', () => {
  describe('Copy', () => {
    it('groups both cards in a radio group labeled Public Certificate Authorities', () => {
      renderChoice()
      const group = screen.getByRole('radiogroup', { name: 'Public Certificate Authorities' })
      expect(group).toContainElement(builtinRadio())
      expect(group).toContainElement(hostRadio())
      expect(screen.getAllByRole('radio')).toHaveLength(2)
    })

    it('shows the built-in card title and its two lines', () => {
      renderChoice()
      expect(screen.getByText("WAVE's built-in list")).toBeInTheDocument()
      expect(screen.getByText("Mozilla's public list, June 2026, 146 authorities.")).toBeInTheDocument()
      expect(screen.getByText('Same on every WAVE host.')).toBeInTheDocument()
    })

    it('builds the built-in line from the label and count props', () => {
      renderChoice({ builtin: { label: 'March 2027', count: 150 } })
      expect(screen.getByText("Mozilla's public list, March 2027, 150 authorities.")).toBeInTheDocument()
      expect(screen.queryByText(/June 2026/)).not.toBeInTheDocument()
    })

    it('shows the host store card title and help line', () => {
      renderChoice()
      expect(screen.getByText("This WAVE host's store")).toBeInTheDocument()
      expect(screen.getByText("Follows this machine's system updates.")).toBeInTheDocument()
    })

    it('shows no not-found line while the host store exists', () => {
      renderChoice()
      expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('checks the built-in card when the value is builtin', () => {
      renderChoice({ value: 'builtin' })
      expect(builtinRadio()).toBeChecked()
      expect(hostRadio()).not.toBeChecked()
    })

    it('checks the host store card when the value is host', () => {
      renderChoice({ value: 'host' })
      expect(hostRadio()).toBeChecked()
      expect(builtinRadio()).not.toBeChecked()
    })

    it('calls onChange with host when the host store radio is chosen', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ value: 'builtin' })
      await user.click(hostRadio())
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('host')
    })

    it('calls onChange with builtin when the built-in radio is chosen', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ value: 'host' })
      await user.click(builtinRadio())
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('builtin')
    })

    it('selects a card when its text is clicked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ value: 'builtin' })
      await user.click(screen.getByText("Follows this machine's system updates."))
      expect(onChange).toHaveBeenCalledWith('host')
    })

    it('moves the selection with the arrow keys', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ value: 'builtin' })
      await user.click(builtinRadio())
      await pressArrow(user, 'ArrowDown')
      expect(hostRadio()).toHaveFocus()
      expect(onChange).toHaveBeenCalledWith('host')
    })
  })

  describe('Host store not found', () => {
    it('disables the host store card and marks it aria-disabled', () => {
      renderChoice({ hostStoreFound: false })
      expect(hostRadio()).toBeDisabled()
      expect(hostRadio().closest('[aria-disabled="true"]')).not.toBeNull()
    })

    it('keeps the built-in card enabled', () => {
      renderChoice({ hostStoreFound: false })
      expect(builtinRadio()).toBeEnabled()
      expect(builtinRadio().closest('[aria-disabled="true"]')).toBeNull()
    })

    it('shows the not-found line', () => {
      renderChoice({ hostStoreFound: false })
      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
    })

    it('ignores a click on the disabled host store card', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ hostStoreFound: false })
      await user.click(hostRadio())
      await user.click(screen.getByText("This WAVE host's store"))
      expect(onChange).not.toHaveBeenCalled()
    })

    it('arrow keys skip the disabled host store card', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ hostStoreFound: false })
      await user.click(builtinRadio())
      await pressArrow(user, 'ArrowDown')
      expect(builtinRadio()).toHaveFocus()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Disabled', () => {
    it('disables both cards', () => {
      renderChoice({ disabled: true })
      expect(builtinRadio()).toBeDisabled()
      expect(hostRadio()).toBeDisabled()
    })

    it('ignores clicks on either card', async () => {
      const user = userEvent.setup()
      const { onChange } = renderChoice({ disabled: true, value: 'builtin' })
      await user.click(hostRadio())
      await user.click(screen.getByText("Follows this machine's system updates."))
      await user.click(screen.getByText("WAVE's built-in list"))
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
