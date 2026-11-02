# V-CANVAS-01g: Palette Expanded State

Verify the expanded block palette displays search, sections, controls, plugins with subcategories, and action buttons.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-canvas-01g/01-seed.sh
```

Seeds palette usage data for Recent/Most Used sections.

## Steps

1. Navigate to http://localhost:3000/tests/new
2. Click on collapsed palette to expand
3. Interact with search, sections, and action buttons

## Validation

- **Expanded width**: Palette has `data-state="expanded"` and 260px width
- **Search input**: Present with placeholder "Search…"
- **Search filtering**: Filters all sections, shows "No results" when no matches
- **Search clear**: X button clears search input
- **Recently Used section**: Collapsible, clock icon, shows items from usage store
- **Most Used section**: Collapsible, star icon, shows items ranked by frequency
- **CONTROLS section**: Collapsible, contains 14 items:
  - If / Else, Switch / Case, Assert, For, ForEach, While, Break, Continue, Parallel, Try / Catch, Halt, Var Setter, Delay, Wait Until
- **PLUGINS section**: 6 rendered subcategories with counts:
  - Network (3): HTTP, Ping, Netcat
  - Remote (8): SSH Session Open, SSH Session Exec, SSH Session Script, SSH Session Close, SSH Tunnel Open, SSH Tunnel Close, SFTP, Remote Execution
  - Database (2): SQL, OpenSearch
  - System (5): Shell Script, Shell Exec, Python, File I/O, Log
  - Kubernetes (5): K8s Connect, K8s Get, K8s Events, K8s Logs, K8s Top
  - Data (4): CSV, Excel, XML, JSON
- **Empty groups absent** (PLUGIN-11): no CUSTOM header and no "No custom plugins" text anywhere in the panel
- **New Function handle**: drag handle with "New Function" text beside a plus icon
- **Function Lib button**: Indigo button with "Function Lib" text
- **Collapse button**: Visible, returns palette to 64px collapsed state
- **Draggable items**: All control/plugin items have `draggable="true"`
