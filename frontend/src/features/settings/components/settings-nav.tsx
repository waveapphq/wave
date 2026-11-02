/**
 * SettingsNav Component
 *
 * REQ-5.2.1.42: Settings and preferences screen - Section navigation
 *
 * Vertical navigation for settings sections:
 * - SETTINGS-2: Sections: General, Environments, Variables, Network (SSH Hosts, Certificates, Proxy Setup, Proxy Blocks), MCP Server, WAVE Server, Backup, About
 * - SETTINGS-3: Selected: $blue10 bg, white text
 * - NET-1: Network is a collapsible parent; clicking it only expands or collapses its pages, and it stays as the user left it for the browser session (SHELL-9)
 * - NET-10: Proxy is a parent inside Network with the Setup and Blocks pages, drawn and remembered by the same rule
 */

import { useEffect } from 'react'
import {
  Settings,
  Globe,
  Braces,
  Bot,
  Server,
  Info,
  Archive,
  Network,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useSettingsNavStore } from '@/features/settings/stores/settings-nav-store'

// ============================================================================
// Types
// ============================================================================

export type ProxySection = 'network-proxy-setup' | 'network-proxy-blocks'

export type NetworkSection = 'network-ssh-hosts' | 'network-certificates' | ProxySection

export type SettingsSection =
  | 'general'
  | 'environments'
  | 'variables'
  | NetworkSection
  | 'mcp'
  | 'server'
  | 'backup'
  | 'about'

export interface SettingsNavProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  className?: string
}

// ============================================================================
// Section Configuration
// ============================================================================

interface SectionConfig {
  id: Exclude<SettingsSection, NetworkSection>
  label: string
  icon: React.FC<{ className?: string; 'data-testid'?: string }>
  iconTestId: string
}

const sectionsBeforeNetwork: SectionConfig[] = [
  { id: 'general', label: 'General', icon: Settings, iconTestId: 'icon-settings' },
  { id: 'environments', label: 'Environments', icon: Globe, iconTestId: 'icon-globe' },
  { id: 'variables', label: 'Variables', icon: Braces, iconTestId: 'icon-braces' },
]

const sectionsAfterNetwork: SectionConfig[] = [
  { id: 'mcp', label: 'MCP Server', icon: Bot, iconTestId: 'icon-bot' },
  { id: 'server', label: 'WAVE Server', icon: Server, iconTestId: 'icon-server' },
  { id: 'backup', label: 'Backup', icon: Archive, iconTestId: 'icon-archive' },
  { id: 'about', label: 'About', icon: Info, iconTestId: 'icon-info' },
]

interface PageConfig {
  id: NetworkSection
  label: string
}

const networkPages: PageConfig[] = [
  { id: 'network-ssh-hosts', label: 'SSH Hosts' },
  { id: 'network-certificates', label: 'Certificates' },
]

// Proxy has no page of its own: it follows the Network pages as a nested group.
const proxyPages: PageConfig[] = [
  { id: 'network-proxy-setup', label: 'Setup' },
  { id: 'network-proxy-blocks', label: 'Blocks' },
]

const ITEM_CLASS =
  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors'
const IDLE_CLASS = 'text-muted-foreground hover:bg-muted hover:text-foreground'
const ACTIVE_STYLE = { backgroundColor: 'rgb(37, 99, 235)', color: 'white' }

export function isProxySection(section: SettingsSection): section is ProxySection {
  return section.startsWith('network-proxy-')
}

export function isNetworkSection(section: SettingsSection): section is NetworkSection {
  return section.startsWith('network-')
}

// ============================================================================
// Components
// ============================================================================

interface NavItemProps {
  id: SettingsSection
  label: string
  active: boolean
  onSelect: (section: SettingsSection) => void
  children?: React.ReactNode
}

function NavItem({ id, label, active, onSelect, children }: Readonly<NavItemProps>) {
  return (
    <button
      type="button"
      data-testid={`settings-nav-${id}`}
      onClick={() => onSelect(id)}
      className={cn(ITEM_CLASS, !active && IDLE_CLASS)}
      style={active ? ACTIVE_STYLE : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {children}
      {label}
    </button>
  )
}

interface NavGroupProps {
  label: string
  icon?: React.ReactNode
  /** One of the group's pages is showing. */
  active: boolean
  /** The group's open state once it was shown open or toggled; null until then. */
  choice: boolean | null
  onToggle: (expanded: boolean) => void
  children: React.ReactNode
}

function NavGroup({ label, icon, active, choice, onToggle, children }: Readonly<NavGroupProps>) {
  const expanded = choice ?? active
  // A page of the group shows it open; from then on only the user closes it.
  useEffect(() => {
    if (choice === null && active) onToggle(true)
  }, [choice, active, onToggle])
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className={cn(ITEM_CLASS, IDLE_CLASS)}>
        {icon}
        {label}
        <Chevron className="ml-auto h-4 w-4" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent
        role="group"
        aria-label={label}
        className="mt-1 ml-[19px] flex flex-col gap-1 border-l pl-2"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function renderPages(
  pages: PageConfig[],
  activeSection: SettingsSection,
  onSectionChange: (section: SettingsSection) => void,
) {
  return pages.map(({ id, label }) => (
    <NavItem
      key={id}
      id={id}
      label={label}
      active={activeSection === id}
      onSelect={onSectionChange}
    />
  ))
}

interface PageGroupProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

function ProxyGroup({ activeSection, onSectionChange }: Readonly<PageGroupProps>) {
  const choice = useSettingsNavStore((state) => state.proxyExpanded)
  const setExpanded = useSettingsNavStore((state) => state.setProxyExpanded)

  return (
    <NavGroup
      label="Proxy"
      active={isProxySection(activeSection)}
      choice={choice}
      onToggle={setExpanded}
    >
      {renderPages(proxyPages, activeSection, onSectionChange)}
    </NavGroup>
  )
}

function NetworkGroup({ activeSection, onSectionChange }: Readonly<PageGroupProps>) {
  const choice = useSettingsNavStore((state) => state.networkExpanded)
  const setExpanded = useSettingsNavStore((state) => state.setNetworkExpanded)

  return (
    <NavGroup
      label="Network"
      icon={<Network className="h-4 w-4" aria-hidden="true" />}
      active={isNetworkSection(activeSection)}
      choice={choice}
      onToggle={setExpanded}
    >
      {renderPages(networkPages, activeSection, onSectionChange)}
      <ProxyGroup activeSection={activeSection} onSectionChange={onSectionChange} />
    </NavGroup>
  )
}

function renderSections(
  sections: SectionConfig[],
  activeSection: SettingsSection,
  onSectionChange: (section: SettingsSection) => void,
) {
  return sections.map(({ id, label, icon: Icon, iconTestId }) => (
    <NavItem
      key={id}
      id={id}
      label={label}
      active={activeSection === id}
      onSelect={onSectionChange}
    >
      <Icon className="h-4 w-4" data-testid={iconTestId} />
    </NavItem>
  ))
}

export function SettingsNav({ activeSection, onSectionChange, className }: Readonly<SettingsNavProps>) {
  return (
    <div
      data-testid="settings-sections"
      className={cn('flex flex-col gap-1', className)}
    >
      {renderSections(sectionsBeforeNetwork, activeSection, onSectionChange)}
      <NetworkGroup activeSection={activeSection} onSectionChange={onSectionChange} />
      {renderSections(sectionsAfterNetwork, activeSection, onSectionChange)}
    </div>
  )
}
