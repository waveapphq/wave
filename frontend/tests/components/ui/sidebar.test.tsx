/**
 * Sidebar Component Tests
 *
 * Tests for the shadcn Sidebar: the provider's open state, cookie and keyboard
 * shortcut, the desktop, mobile and fixed layouts, and the menu parts.
 *
 * Component: frontend/src/components/ui/sidebar.tsx
 */

import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

const { mobile } = vi.hoisted(() => ({ mobile: { value: false } }))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobile.value,
}))

function SidebarState() {
  const { state, open, openMobile, isMobile } = useSidebar()
  return (
    <output data-testid="sidebar-state">
      {`${state}|${open}|${openMobile}|${isMobile}`}
    </output>
  )
}

function OpenSetter({ value }: Readonly<{ value: boolean }>) {
  const { setOpen } = useSidebar()
  return (
    <button type="button" onClick={() => setOpen(value)}>
      Set open {String(value)}
    </button>
  )
}

function stateText() {
  return screen.getByTestId('sidebar-state').textContent
}

function clearSidebarCookie() {
  document.cookie = 'sidebar_state=; path=/; max-age=0'
}

describe('Sidebar', () => {
  beforeEach(() => {
    mobile.value = false
    clearSidebarCookie()
  })

  afterEach(() => {
    clearSidebarCookie()
  })

  describe('useSidebar', () => {
    it('throws outside a SidebarProvider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      expect(() => render(<SidebarState />)).toThrow(
        'useSidebar must be used within a SidebarProvider.'
      )

      consoleError.mockRestore()
    })
  })

  describe('SidebarProvider', () => {
    it('starts expanded and merges the caller style, class and ref', () => {
      const ref = createRef<HTMLDivElement>()
      render(
        <SidebarProvider
          ref={ref}
          className="custom-wrapper"
          style={{ color: 'red' }}
          data-testid="sidebar-wrapper"
        >
          <SidebarState />
        </SidebarProvider>
      )

      const wrapper = screen.getByTestId('sidebar-wrapper')
      expect(ref.current).toBe(wrapper)
      expect(wrapper).toHaveClass('group/sidebar-wrapper', 'flex', 'custom-wrapper')
      expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe('200px')
      expect(wrapper.style.getPropertyValue('--sidebar-width-icon')).toBe('56px')
      expect(wrapper.style.color).toBe('red')
      expect(stateText()).toBe('expanded|true|false|false')
    })

    it('starts collapsed when defaultOpen is false', () => {
      render(
        <SidebarProvider defaultOpen={false}>
          <SidebarState />
        </SidebarProvider>
      )

      expect(stateText()).toBe('collapsed|false|false|false')
    })

    it('toggles from the trigger, calls the caller onClick and stores the state in a cookie', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(
        <SidebarProvider>
          <SidebarTrigger onClick={onClick} className="custom-trigger" />
          <SidebarState />
        </SidebarProvider>
      )

      const trigger = screen.getByRole('button', { name: 'Toggle Sidebar' })
      expect(trigger).toHaveClass('h-7', 'w-7', 'custom-trigger')
      expect(trigger).toHaveAttribute('data-sidebar', 'trigger')

      await user.click(trigger)

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(stateText()).toBe('collapsed|false|false|false')
      expect(document.cookie).toContain('sidebar_state=false')

      await user.click(trigger)

      expect(stateText()).toBe('expanded|true|false|false')
      expect(document.cookie).toContain('sidebar_state=true')
    })

    it('toggles from a trigger without a caller onClick', async () => {
      const user = userEvent.setup()
      render(
        <SidebarProvider>
          <SidebarTrigger />
          <SidebarState />
        </SidebarProvider>
      )

      await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

      expect(stateText()).toBe('collapsed|false|false|false')
    })

    it('sets a plain value through setOpen', async () => {
      const user = userEvent.setup()
      render(
        <SidebarProvider>
          <OpenSetter value={false} />
          <SidebarState />
        </SidebarProvider>
      )

      await user.click(screen.getByRole('button', { name: 'Set open false' }))

      expect(stateText()).toBe('collapsed|false|false|false')
      expect(document.cookie).toContain('sidebar_state=false')
    })

    it('hands the new state to onOpenChange when controlled', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(
        <SidebarProvider open onOpenChange={onOpenChange}>
          <SidebarTrigger />
          <SidebarState />
        </SidebarProvider>
      )

      await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(stateText()).toBe('expanded|true|false|false')
      expect(document.cookie).toContain('sidebar_state=false')
    })

    it.each([
      ['Ctrl', { ctrlKey: true }],
      ['Meta', { metaKey: true }],
    ] as const)('toggles on %s+B', (_label, modifier) => {
      render(
        <SidebarProvider>
          <SidebarState />
        </SidebarProvider>
      )

      fireEvent.keyDown(document, { key: 'b', ...modifier })

      expect(stateText()).toBe('collapsed|false|false|false')
    })

    it('ignores B without a modifier and other keys with one', () => {
      render(
        <SidebarProvider>
          <SidebarState />
        </SidebarProvider>
      )

      fireEvent.keyDown(document, { key: 'b' })
      fireEvent.keyDown(document, { key: 'x', ctrlKey: true })

      expect(stateText()).toBe('expanded|true|false|false')
    })

    it('removes the keyboard shortcut on unmount', () => {
      const removeListener = vi.spyOn(globalThis, 'removeEventListener')
      const { unmount } = render(
        <SidebarProvider>
          <SidebarState />
        </SidebarProvider>
      )

      unmount()

      expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function))
      removeListener.mockRestore()
    })
  })

  describe('Sidebar layouts', () => {
    it('renders a fixed panel when collapsible is none', () => {
      const ref = createRef<HTMLDivElement>()
      render(
        <SidebarProvider>
          <Sidebar collapsible="none" ref={ref} className="custom-panel" data-testid="fixed-panel">
            <span>Fixed content</span>
          </Sidebar>
        </SidebarProvider>
      )

      const panel = screen.getByTestId('fixed-panel')
      expect(ref.current).toBe(panel)
      expect(panel).toHaveClass('flex', 'h-full', 'w-[--sidebar-width]', 'custom-panel')
      expect(panel).toHaveTextContent('Fixed content')
      expect(screen.queryByTestId('sidebar')).toBeNull()
    })

    it('renders the expanded desktop sidebar on the left with the default variant', () => {
      const ref = createRef<HTMLDivElement>()
      render(
        <SidebarProvider>
          <Sidebar ref={ref} className="custom-inner" data-testid="sidebar-inner">
            <span>Desktop content</span>
          </Sidebar>
        </SidebarProvider>
      )

      const sidebar = screen.getByTestId('sidebar')
      expect(ref.current).toBe(sidebar)
      expect(sidebar).toHaveAttribute('data-state', 'expanded')
      expect(sidebar).toHaveAttribute('data-collapsible', '')
      expect(sidebar).toHaveAttribute('data-variant', 'sidebar')
      expect(sidebar).toHaveAttribute('data-side', 'left')

      const gap = sidebar.firstElementChild
      expect(gap).toHaveClass('group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]')

      const inner = screen.getByTestId('sidebar-inner')
      expect(inner).toHaveClass('left-0', 'group-data-[side=left]:border-r', 'custom-inner')
      expect(inner.querySelector('[data-sidebar="sidebar"]')).toHaveTextContent('Desktop content')
    })

    it('marks a collapsed desktop sidebar with its collapsible mode', () => {
      render(
        <SidebarProvider defaultOpen={false}>
          <Sidebar collapsible="icon" />
        </SidebarProvider>
      )

      const sidebar = screen.getByTestId('sidebar')
      expect(sidebar).toHaveAttribute('data-state', 'collapsed')
      expect(sidebar).toHaveAttribute('data-collapsible', 'icon')
    })

    it.each(['floating', 'inset'] as const)(
      'pads the %s variant on the right side',
      (variant) => {
        render(
          <SidebarProvider>
            <Sidebar variant={variant} side="right" data-testid="sidebar-inner" />
          </SidebarProvider>
        )

        const sidebar = screen.getByTestId('sidebar')
        expect(sidebar).toHaveAttribute('data-variant', variant)
        expect(sidebar).toHaveAttribute('data-side', 'right')
        expect(sidebar.firstElementChild).toHaveClass(
          'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]'
        )
        expect(screen.getByTestId('sidebar-inner')).toHaveClass('right-0', 'p-2')
      }
    )

    it('renders a sheet on mobile that the trigger opens', async () => {
      mobile.value = true
      const user = userEvent.setup()
      render(
        <SidebarProvider>
          <Sidebar side="left">
            <span>Mobile content</span>
          </Sidebar>
          <SidebarTrigger />
          <SidebarState />
        </SidebarProvider>
      )

      expect(screen.queryByTestId('sidebar')).toBeNull()
      expect(screen.queryByText('Mobile content')).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))

      expect(stateText()).toBe('expanded|true|true|true')
      const sheet = await screen.findByRole('dialog')
      expect(sheet).toHaveAttribute('data-mobile', 'true')
      expect(sheet).toHaveAttribute('data-sidebar', 'sidebar')
      expect(sheet.style.getPropertyValue('--sidebar-width')).toBe('280px')
      expect(sheet).toHaveTextContent('Mobile content')
      expect(screen.getByText('Displays the mobile sidebar.')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })
      expect(stateText()).toBe('expanded|true|false|true')
    })
  })

  describe('SidebarRail', () => {
    it('toggles the sidebar on click', async () => {
      const user = userEvent.setup()
      const ref = createRef<HTMLButtonElement>()
      render(
        <SidebarProvider>
          <SidebarRail ref={ref} className="custom-rail" />
          <SidebarState />
        </SidebarProvider>
      )

      const rail = screen.getByRole('button', { name: 'Toggle Sidebar' })
      expect(ref.current).toBe(rail)
      expect(rail).toHaveAttribute('data-sidebar', 'rail')
      expect(rail).toHaveAttribute('tabindex', '-1')
      expect(rail).toHaveClass('absolute', 'custom-rail')

      await user.click(rail)

      expect(stateText()).toBe('collapsed|false|false|false')
    })
  })

  describe('layout parts', () => {
    it('renders each part with its data-sidebar slot and the caller class', () => {
      render(
        <SidebarProvider>
          <SidebarHeader className="custom-header" data-testid="header" />
          <SidebarInput className="custom-input" aria-label="Search" />
          <SidebarSeparator className="custom-separator" data-testid="separator" />
          <SidebarContent className="custom-content" data-testid="content">
            <SidebarGroup className="custom-group" data-testid="group">
              <SidebarGroupLabel className="custom-label">Group label</SidebarGroupLabel>
              <SidebarGroupAction className="custom-group-action" aria-label="Add" />
              <SidebarGroupContent className="custom-group-content" data-testid="group-content" />
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="custom-footer" data-testid="footer" />
          <SidebarInset className="custom-inset" data-testid="inset" />
        </SidebarProvider>
      )

      expect(screen.getByTestId('header')).toHaveAttribute('data-sidebar', 'header')
      expect(screen.getByTestId('header')).toHaveClass('custom-header')
      const input = screen.getByRole('textbox', { name: 'Search' })
      expect(input).toHaveAttribute('data-sidebar', 'input')
      expect(input).toHaveClass('h-8', 'custom-input')
      expect(screen.getByTestId('separator')).toHaveAttribute('data-sidebar', 'separator')
      expect(screen.getByTestId('separator')).toHaveClass('mx-2', 'custom-separator')
      expect(screen.getByTestId('content')).toHaveAttribute('data-sidebar', 'content')
      expect(screen.getByTestId('content')).toHaveClass('custom-content')
      expect(screen.getByTestId('group')).toHaveAttribute('data-sidebar', 'group')
      expect(screen.getByTestId('group')).toHaveClass('custom-group')
      const label = screen.getByText('Group label')
      expect(label.tagName).toBe('DIV')
      expect(label).toHaveAttribute('data-sidebar', 'group-label')
      expect(label).toHaveClass('custom-label')
      const action = screen.getByRole('button', { name: 'Add' })
      expect(action).toHaveAttribute('data-sidebar', 'group-action')
      expect(action).toHaveClass('custom-group-action')
      expect(screen.getByTestId('group-content')).toHaveAttribute('data-sidebar', 'group-content')
      expect(screen.getByTestId('group-content')).toHaveClass('custom-group-content')
      expect(screen.getByTestId('footer')).toHaveAttribute('data-sidebar', 'footer')
      expect(screen.getByTestId('footer')).toHaveClass('custom-footer')
      const inset = screen.getByTestId('inset')
      expect(inset.tagName).toBe('MAIN')
      expect(inset).toHaveClass('relative', 'flex', 'custom-inset')
    })

    it('renders the group label and group action onto a caller element with asChild', () => {
      render(
        <SidebarProvider>
          <SidebarGroupLabel asChild>
            <h2>Child label</h2>
          </SidebarGroupLabel>
          <SidebarGroupAction asChild>
            <a href="#add">Child action</a>
          </SidebarGroupAction>
        </SidebarProvider>
      )

      const label = screen.getByRole('heading', { name: 'Child label' })
      expect(label).toHaveAttribute('data-sidebar', 'group-label')
      const action = screen.getByRole('link', { name: 'Child action' })
      expect(action).toHaveAttribute('data-sidebar', 'group-action')
    })
  })

  describe('menu parts', () => {
    it('renders the menu, items, badge and sub menu with their slots', () => {
      render(
        <SidebarProvider>
          <SidebarMenu className="custom-menu" data-testid="menu">
            <SidebarMenuItem className="custom-item" data-testid="item">
              <SidebarMenuButton isActive variant="outline" size="lg" className="custom-button">
                Dashboard
              </SidebarMenuButton>
              <SidebarMenuAction className="custom-action" aria-label="More" />
              <SidebarMenuBadge className="custom-badge" data-testid="badge">
                3
              </SidebarMenuBadge>
              <SidebarMenuSub className="custom-sub" data-testid="sub">
                <SidebarMenuSubItem data-testid="sub-item">
                  <SidebarMenuSubButton href="#sub" className="custom-sub-button">
                    Sub link
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      )

      expect(screen.getByTestId('menu')).toHaveAttribute('data-sidebar', 'menu')
      expect(screen.getByTestId('menu')).toHaveClass('custom-menu')
      expect(screen.getByTestId('item')).toHaveAttribute('data-sidebar', 'menu-item')
      expect(screen.getByTestId('item')).toHaveClass('group/menu-item', 'custom-item')

      const button = screen.getByRole('button', { name: 'Dashboard' })
      expect(button).toHaveAttribute('data-sidebar', 'menu-button')
      expect(button).toHaveAttribute('data-size', 'lg')
      expect(button).toHaveAttribute('data-active', 'true')
      expect(button).toHaveClass('h-12', 'bg-background', 'custom-button')
      expect(button).not.toHaveAttribute('data-state')

      const action = screen.getByRole('button', { name: 'More' })
      expect(action).toHaveAttribute('data-sidebar', 'menu-action')
      expect(action).toHaveClass('custom-action')
      expect(action).not.toHaveClass('md:opacity-0')

      expect(screen.getByTestId('badge')).toHaveAttribute('data-sidebar', 'menu-badge')
      expect(screen.getByTestId('badge')).toHaveClass('custom-badge')
      expect(screen.getByTestId('sub')).toHaveAttribute('data-sidebar', 'menu-sub')
      expect(screen.getByTestId('sub')).toHaveClass('custom-sub')
      expect(screen.getByTestId('sub-item').tagName).toBe('LI')

      const subButton = screen.getByRole('link', { name: 'Sub link' })
      expect(subButton).toHaveAttribute('data-sidebar', 'menu-sub-button')
      expect(subButton).toHaveAttribute('data-size', 'md')
      expect(subButton).toHaveClass('text-sm', 'custom-sub-button')
      expect(subButton).not.toHaveClass('text-xs')
    })

    it('uses the default menu button look when no variant or size is given', () => {
      render(
        <SidebarProvider>
          <SidebarMenuButton>Plain</SidebarMenuButton>
        </SidebarProvider>
      )

      const button = screen.getByRole('button', { name: 'Plain' })
      expect(button).toHaveAttribute('data-size', 'default')
      expect(button).toHaveAttribute('data-active', 'false')
      expect(button).toHaveClass('h-8')
    })

    it('renders menu parts onto caller elements with asChild', () => {
      render(
        <SidebarProvider>
          <SidebarMenuButton asChild>
            <a href="#home">Home link</a>
          </SidebarMenuButton>
          <SidebarMenuAction asChild showOnHover>
            <span>Hover action</span>
          </SidebarMenuAction>
          <SidebarMenuSubButton asChild size="sm" isActive>
            <button type="button">Small sub</button>
          </SidebarMenuSubButton>
        </SidebarProvider>
      )

      const home = screen.getByRole('link', { name: 'Home link' })
      expect(home).toHaveAttribute('data-sidebar', 'menu-button')

      const action = screen.getByText('Hover action')
      expect(action.tagName).toBe('SPAN')
      expect(action).toHaveAttribute('data-sidebar', 'menu-action')
      expect(action).toHaveClass('md:opacity-0')

      const subButton = screen.getByRole('button', { name: 'Small sub' })
      expect(subButton).toHaveAttribute('data-sidebar', 'menu-sub-button')
      expect(subButton).toHaveAttribute('data-size', 'sm')
      expect(subButton).toHaveAttribute('data-active', 'true')
      expect(subButton).toHaveClass('text-xs')
      expect(subButton).not.toHaveClass('text-sm')
    })

    it('wraps the menu button in a tooltip only when collapsed on desktop', () => {
      render(
        <SidebarProvider defaultOpen={false}>
          <SidebarMenuButton tooltip="Dashboard tip">Collapsed</SidebarMenuButton>
        </SidebarProvider>
      )

      expect(screen.getByRole('button', { name: 'Collapsed' })).toHaveAttribute(
        'data-state',
        'closed'
      )
    })

    it('leaves out the tooltip while expanded', () => {
      render(
        <SidebarProvider>
          <SidebarMenuButton tooltip="Dashboard tip">Expanded</SidebarMenuButton>
        </SidebarProvider>
      )

      expect(screen.getByRole('button', { name: 'Expanded' })).not.toHaveAttribute('data-state')
    })

    it('leaves out the tooltip on mobile even when collapsed', () => {
      mobile.value = true
      render(
        <SidebarProvider defaultOpen={false}>
          <SidebarMenuButton tooltip="Dashboard tip">Mobile</SidebarMenuButton>
        </SidebarProvider>
      )

      expect(screen.getByRole('button', { name: 'Mobile' })).not.toHaveAttribute('data-state')
    })
  })
})
