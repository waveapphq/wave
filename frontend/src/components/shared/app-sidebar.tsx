/**
 * App Sidebar Component - REQ-5.2.1.29 Sidebar navigation with collapsible sections
 *
 * Main application sidebar using shadcn sidebar components.
 * Uses collapsible="icon" for icon-only collapsed mode.
 *
 * Design Decisions: SHELL-1, SHELL-2, SHELL-3, SHELL-4, SHELL-6
 */

import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Home,
  TestTube2,
  FolderKanban,
  GitBranch,
  Play,
  Settings,
  Sun,
  Moon,
  Workflow,
  User,
  FunctionSquare,
  UserCog,
  FileBarChart,
  Archive,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { useThemeSafe } from '@/design-system/theme-provider'

/**
 * Navigation item configuration
 */
interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  iconColor?: string
}

/**
 * Navigation section configuration
 */
interface NavSection {
  label: string
  items: NavItem[]
}

// Top-level navigation items (no section header)
const topLevelItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: Home, iconColor: '#F472B6' },
  { title: 'Executions', href: '/executions', icon: Play, iconColor: '#60A5FA' },
]

// Grouped navigation sections
const navSections: NavSection[] = [
  {
    label: 'BUILD',
    items: [
      { title: 'Regressions', href: '/regressions', icon: GitBranch, iconColor: '#A78BFA' },
      { title: 'Suites', href: '/suites', icon: FolderKanban, iconColor: '#F59E0B' },
      { title: 'Tests', href: '/tests', icon: TestTube2, iconColor: '#4ADE80' },
      { title: 'Workbench', href: '/workbench', icon: Workflow, iconColor: '#FBBF24' },
    ],
  },
  {
    label: 'LIBRARY',
    items: [
      { title: 'Functions', href: '/functions', icon: FunctionSquare, iconColor: '#818CF8' },
      { title: 'Profiles', href: '/profiles', icon: UserCog, iconColor: '#22D3EE' },
    ],
  },
  {
    label: 'RESULTS',
    items: [
      { title: 'Reports', href: '/reports', icon: FileBarChart, iconColor: '#34D399' },
      { title: 'Artifacts', href: '/artifacts', icon: Archive, iconColor: '#FB923C' },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { title: 'Settings', href: '/settings', icon: Settings, iconColor: '#71717A' },
      { title: 'User', href: '/user', icon: User, iconColor: '#38BDF8' },
    ],
  },
]

// Brand mark geometry, shared with frontend/public/favicon.svg
const BRAND_TILE_WAVE =
  'M16.5,35.09 C17.55,36.42 18.6,38.35 19.65,40.63 C20.7,42.91 21.75,45.53 22.8,48.14 C23.85,50.76 24.9,53.36 25.95,55.62 C27,57.87 28.05,59.76 29.1,61.05 C30.15,62.34 31.2,63.02 32.25,63 C33.3,62.98 34.35,62.26 35.4,60.94 C36.45,59.61 37.5,57.69 38.55,55.41 C39.6,53.14 40.65,50.52 41.7,47.91 C42.75,45.29 43.8,42.68 44.85,40.43 C45.9,38.17 46.95,36.27 48,34.97 C49.05,33.67 50.1,32.99 51.15,33 C52.2,33.01 53.25,33.72 54.3,35.04 C55.35,36.36 56.4,38.28 57.45,40.55 C58.5,42.82 59.55,45.43 60.6,48.05 C61.65,50.66 62.7,53.27 63.75,55.53 C64.8,57.8 65.85,59.7 66.9,61.01 C67.95,62.31 69,63 70.05,63 C71.1,63 72.15,62.29 73.2,60.98 C74.25,59.67 75.3,57.76 76.35,55.49 C77.4,53.23 78.45,50.62 79.5,48'
const BRAND_RIPPLE =
  'M0,10 C11,2 22,2 33,10 C44,18 55,18 66,10 C77,2 88,2 99,10 C110,18 121,18 132,10'

/**
 * Sidebar brand row: ripple lockup when expanded, plated tile in the collapsed rail.
 */
function SidebarLogo() {
  return (
    <div className="flex h-10 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <span className="hidden group-data-[collapsible=icon]:block">
        <svg viewBox="0 0 96 96" className="h-7 w-7 shrink-0" aria-hidden="true">
          <rect width="96" height="96" rx="21" fill="#0C1322" />
          <rect x="3" y="3" width="90" height="90" rx="18" fill="none" stroke="#45689A" strokeWidth="6" />
          <path
            d={BRAND_TILE_WAVE}
            fill="none"
            stroke="#56D6F5"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sr-only">WAVE</span>
      </span>
      <span className="flex items-center gap-3 group-data-[collapsible=icon]:hidden">
        <svg
          viewBox="0 0 132 20"
          className="h-2 w-[52px] shrink-0"
          style={{ color: 'var(--color-info-text)' }}
          aria-hidden="true"
        >
          <path
            d={BRAND_RIPPLE}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-xl font-bold text-foreground">WAVE</span>
      </span>
    </div>
  )
}

/**
 * Navigation menu item with tooltip support
 */
function NavMenuItem({ item }: Readonly<{ item: NavItem }>) {
  const location = useLocation()
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  const isActive =
    item.href === '/dashboard'
      ? location.pathname === '/dashboard'
      : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`)

  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.title}
        className={[
          isActive ? 'data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground' : '',
        ].filter(Boolean).join(' ')}
      >
        <Link to={item.href}>
          <span
            className={[
              'flex h-5 w-5 shrink-0 items-center justify-center',
              isActive ? 'text-sidebar-primary-foreground' : '',
            ].filter(Boolean).join(' ')}
            style={!isActive && item.iconColor ? { color: item.iconColor } : undefined}
            data-icon-wrapper
          >
            <Icon className="h-5 w-5" />
          </span>
          <span data-label className={isCollapsed ? 'sr-only' : ''}>
            {item.title}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Theme toggle button for sidebar footer
 * Shows icon-only when collapsed, icon + "Light Theme"/"Dark Theme" inline when expanded
 * Per wireframe: text should be inline (side-by-side with icon)
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useThemeSafe()
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  // Per wireframe: "Light Theme" or "Dark Theme" (full text)
  const label = resolvedTheme === 'dark' ? 'Light Theme' : 'Dark Theme'
  const fullLabel = resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  if (isCollapsed) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={fullLabel}
        className="h-8 w-8"
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    )
  }

  // Expanded: use button with explicit inline flex layout
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={fullLabel}
      className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

/**
 * Sidebar collapse toggle button
 */
function CollapseToggle() {
  const { state, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="h-8 w-8"
    >
      {isCollapsed ? (
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      ) : (
        <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  )
}

/**
 * Main app sidebar component
 */
export function AppSidebar({ ...props }: Readonly<React.ComponentProps<typeof Sidebar>>) {
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarLogo />
      </SidebarHeader>

      <SidebarContent>
        {/* Top-level items (Dashboard, Executions) */}
        <SidebarGroup>
          <SidebarMenu>
            {topLevelItems.map((item) => (
              <NavMenuItem key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Grouped sections */}
        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <NavMenuItem key={item.href} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className={isCollapsed ? 'p-0 gap-0' : 'h-[49px] p-0 gap-0'}>
        <div data-sidebar="separator" className="h-px bg-border shrink-0" />
        <div className={isCollapsed ? 'flex flex-col items-center gap-2 p-2' : 'flex flex-1 items-center justify-between px-2'}>
          <ThemeToggle />
          <CollapseToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
