# V-PLUGIN-DEF-02: Plugin Icons from Centralized Registry

Verify plugin icons render correctly from the centralized icon registry with proper colors.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-plugin-def-02/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Click Plugins icon in collapsed palette to open flyout
3. Verify icon rendering for all plugins
4. Expand palette and verify icon consistency

## Validation

- **Icon rendering:** All 40 plugins display SVG icons
- **Icon source:** Icons from icon-registry.ts (Lucide components)
- **Category colors:**
  - Network icons: text-blue-500
  - Remote icons: text-cyan-500
  - Database icons: text-purple-500
  - System icons: text-red-500
  - Kubernetes icons: text-sky-500
  - Helm icons: text-indigo-500
  - Data icons: text-emerald-500
- **Kubernetes glyphs:** Cable, PackageSearch, History, Logs, Gauge, CloudUpload, Trash2, Scaling, RefreshCw, Terminal, FileTerminal, ArrowRightLeft
- **Shared glyphs:** Cable serves Netcat, SSH Tunnel Open and K8s Connect; RefreshCw serves the While Loop control and K8s Rollout; Terminal serves K8s Exec, SSH Session Exec and Shell Exec; FileTerminal serves K8s Script, SSH Session Script and Shell Script, so each glyph check is scoped to one palette item
- **Flyout icon size:** h-10 w-10 classes
- **Expanded list icon size:** h-5 w-5 classes
- **No fallback icons:** All plugins show their assigned icon, not the unknown-icon glyph

## Cases

| Case | Covers |
|---|---|
| V-PLUGIN-DEF-02-S1 | All 40 plugin icons render as SVG |
| V-PLUGIN-DEF-02-S2 | Network icons are blue |
| V-PLUGIN-DEF-02-S2b | Remote icons are cyan |
| V-PLUGIN-DEF-02-S3 | Database icons are purple |
| V-PLUGIN-DEF-02-S4 | System icons are red |
| V-PLUGIN-DEF-02-S5 | Kubernetes icons are sky, all twelve blocks |
| V-PLUGIN-DEF-02-S6 | Data icons are emerald |
| V-PLUGIN-DEF-02-S7 | Flyout icon size is h-10 w-10 |
| V-PLUGIN-DEF-02-S8 | Expanded palette icon size is h-5 w-5 |
| V-PLUGIN-DEF-02-S9 | Colors hold in the expanded palette |
| V-PLUGIN-DEF-02-S10 | Every plugin renders its registered glyph, no fallback |
