# V-BACKUP-01: Backup & Restore - Create and Periodic Sections

Verify the Create Backup and Periodic Backup sections render correctly in the Settings page.

## Prerequisites

No data seeding required. The backup tab is client-side UI that fetches schedule config on mount (defaults to disabled).

## Steps

1. Open http://localhost:3000/settings/backup

## Validation

- **Navigation:** Backup nav item visible with Archive icon, 7 sections plus the Network group toggle
- **Tab structure:** Three sections separated by dividers: Create Backup, Restore from Backup, Periodic Backup
- **Create Backup section:**
  - Part list with nine parts, every one enabled, in three columns: Tests, Environments, Profiles / Suites, Regressions, Functions / System Variables, SSH Hosts, Additional Certificates
  - Select all / Deselect all links
  - With the Periodic Backup list showing too: a click on the name of a part (Tests, Functions) ticks or unticks that part in the list the name sits in and changes nothing in the other list; no id on the page is held by more than one element
  - Format dropdown (YAML/JSON)
  - Compression method dropdown (None/Deflate/Bzip2/LZMA)
  - Compression level slider (1-9, disabled for Stored and LZMA)
  - Secret values picker after the compression level; Decrypt shows the warning
  - Create & Download button disabled when no entities selected
- **Periodic Backup section:**
  - Enable toggle (disabled by default)
  - When enabled: cron input, entity selector, format/compression controls, max backups, save directory
  - Max Backups to Keep is a text box with a number keyboard and no spinner arrows
  - Cron input shows description for valid expressions, error for invalid
  - Cancel and Save on the heading line, disabled until a change; the switch is staged; a fresh install shows `~/wave-backups`; no Save Schedule button; the frame holds in both themes
