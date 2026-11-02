# V-SET-01: Settings Page

Verify Settings page layout with section navigation and Environments tab.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/settings/v-set-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/settings

## Validation

### Layout (SETTINGS-1, SETTINGS-4, SETTINGS-5)
- **Two-column layout:** Nav (240px) + content area
- **Settings title:** "Settings" heading above section nav
- **Vertical divider:** One 1px line between nav and content, in the theme border color
- **Heading wrapping:** Every heading on the page (h1 to h4) has the computed style `text-wrap-style: balance`, so a heading that wraps balances its lines

### Section Navigation (SETTINGS-2, SETTINGS-3)
- **Seven sections plus the Network group:** General, Environments, Variables, Network (SSH Hosts, Certificates), MCP Server, WAVE Server, Backup, About (in vertical order; SETTINGS-2, NET-1)
- **Default selection:** General tab active by default
- **Active state:** Blue background ($blue10), white text
- **Tab switching:** Clicking section changes active state and content

### Environments Tab (SETTINGS-6 through SETTINGS-13)
- **Header:** "Environments" title with subtitle
- **Subtitle:** "Manage environment names used across profiles"
- **New button:** "+ New Environment" button (blue)
- **Table columns:** Name, Description, Usage, Actions
- **Usage format:** "N profiles"
- **Actions:** Edit (pencil) + kebab menu (Duplicate, Delete)
- **Delete protection:** Delete of an in-use environment asks to type its name
- **Pagination:** Full pagination ("Showing X-Y of Z environments", "N per page", navigation)

### Environments Data (from fixture)
| Name | Description | Usage |
|------|-------------|-------|
| Production | Live customer environment | 5 profiles |
| Staging | Pre-release testing | 3 profiles |
| Development | Local development | 8 profiles |
| QA | Quality assurance testing | 2 profiles |

### Other Tabs (SETTINGS-14, SETTINGS-16)
- **General tab:** Logging with the Log Level row
- **About tab:** Version, build, build date, support links; no Environment field, and no Environment line in the copied version report

### Empty State
- **Icon:** Environment-related icon
- **Message:** "No environments yet" or similar
- **CTA:** "New Environment" button

### Loading State
- **Skeleton rows:** Displayed while fetching data
