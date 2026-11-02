# V-PLUGIN-DEF-01: Plugin Palette - 40 Plugins in 7 Rendered Categories

Verify the plugin palette displays all 40 built-in plugins with correct categories and colors.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-plugin-def-01/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Click Plugins icon in collapsed palette to open flyout
3. Verify all plugins are displayed in 7 categories
4. Expand palette and verify subcategories

## Validation

- **Plugin count:** 40 plugins total
- **Categories (7 rendered):**
  - Network (3): HTTP, Ping, Netcat - blue
  - Remote (8): SSH Session Open, SSH Session Exec, SSH Session Script, SSH Session Close, SSH Tunnel Open, SSH Tunnel Close, SFTP, Remote Execution - cyan
  - Database (2): SQL, OpenSearch - purple
  - System (5): Shell Script, Shell Exec, Python, File I/O, Log - red
  - Kubernetes (12): K8s Connect, K8s Get, K8s Events, K8s Logs, K8s Top, K8s Apply, K8s Delete, K8s Scale, K8s Rollout, K8s Exec, K8s Script, K8s Copy - sky
  - Helm (6): Helm Install, Helm Upgrade, Helm Rollback, Helm Uninstall, Helm Test, Helm Status - indigo
  - Data (4): CSV, Excel, XML, JSON - emerald
- **Kubernetes order:** the subcategory lists its twelve blocks in the order above
- **Empty groups (PLUGIN-11):** no Custom group and no "No custom plugins" text anywhere in the palette
- **Flyout layout:** Grid with 3 columns
- **Expanded layout:** 7 collapsible subcategories
- **Accessibility:** role="option", aria-label on each plugin
- **Draggable:** draggable="true" attribute on all plugins

## Cases

| Case | Covers |
|---|---|
| V-PLUGIN-DEF-01-S1 | Collapsed flyout lists all 40 plugins in a grid |
| V-PLUGIN-DEF-01-S2 | Six category headers with their color classes |
| V-PLUGIN-DEF-01-S3 | Network icons are blue |
| V-PLUGIN-DEF-01-S3b | Remote icons are cyan |
| V-PLUGIN-DEF-01-S4 | Database icons are purple |
| V-PLUGIN-DEF-01-S5 | System icons are red |
| V-PLUGIN-DEF-01-S6 | Kubernetes icons are sky, all twelve blocks |
| V-PLUGIN-DEF-01-S7 | Data icons are emerald |
| V-PLUGIN-DEF-01-S8 | The flyout drops an empty group entirely |
| V-PLUGIN-DEF-01-S9 | Plugins are draggable and carry an aria-label |
| V-PLUGIN-DEF-01-S10 | Expanded palette shows 6 plugin subcategories |
| V-PLUGIN-DEF-01-S11 | Subcategory counts: 3, 8, 2, 5, 12, 4 |
| V-PLUGIN-DEF-01-S12 | A subcategory reveals its items when clicked; SFTP sits under Remote, not Network |
| V-PLUGIN-DEF-01-S13 | An empty group is absent from the expanded panel; seven groups render |
| V-PLUGIN-DEF-01-S14 | Kubernetes subcategory order: connect, get, events, logs, top, apply, delete, scale, rollout, exec, script, copy |
