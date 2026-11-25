# Exclusions

WAVE lists every check it skips here, in public, with the reason. A check is skipped when a coverage tool leaves code out, when a maintainer marks a SonarQube Cloud issue as a false positive, or when a maintainer dismisses a CodeQL alert.

## Kinds

Each entry in the SonarQube Cloud, CodeQL and backend coverage lists names one of three kinds.

| Kind | Meaning |
|---|---|
| False positive | The tool reports a problem that the code does not have. |
| Test code only | The report is about test code, which WAVE does not ship. |
| Intended behavior | The code does on purpose what the tool reports. The entry says why it is needed and what limits it. |

## Lists

| List | IDs | What it holds |
|---|---|---|
| [SonarQube Cloud](sonarqube-cloud.md) | `SQ-*` | Issues that a maintainer marked as false positives in SonarQube Cloud. |
| [CodeQL](codeql.md) | `CQL-*` | Alerts that a maintainer dismissed in CodeQL code scanning on GitHub. |
| [Frontend coverage](frontend-coverage.md) | `COV-*` | Code that the frontend's coverage leaves out. |
| [Backend coverage](backend-coverage.md) | `BCOV-*` | Code that the backend's coverage leaves out. |

## Rules

- **Fix the code first** - An exclusion is only for code that is right. A real risk is fixed, never listed.
- **Only a maintainer marks or dismisses** - Only a maintainer marks an issue as a false positive in SonarQube Cloud or dismisses an alert in CodeQL.
- **A new entry goes into the pull request that needs it** - Its reason is reviewed there.
- **The code carries the ID** - A one-line comment at the spot holds the entry's ID. The comment is not a suppression: it changes nothing in what the tool reports.
- **IDs never change** - An ID stays the same when its code moves to another file.
- **Orphans are violations** - An ID in the code without an entry, or an entry with no ID in the code, is a violation.
- **Entries describe the code by its role** - An entry never names a file, never gives a line number and never links to code, because files change content and names. It says what the code does.

| Where | Comment at the spot |
|---|---|
| Frontend coverage | `/* v8 ignore next - COV-XXX-NNN */` |
| Backend coverage | `# pragma: no cover - BCOV-XXX-NNN` |
| SonarQube Cloud and CodeQL, Python | `# SonarQube exclusion: SQ-XXX-NNN` or `# CodeQL exclusion: CQL-XXX-NNN` |
| SonarQube Cloud and CodeQL, TypeScript | `// SonarQube exclusion: SQ-XXX-NNN` or `// CodeQL exclusion: CQL-XXX-NNN` |

## Find a place

Search the code for the ID, for example `git grep -n "BCOV-ABSTRACT-001"`. Each hit is one place that the entry covers.

## Checks

Two required checks on each pull request compare these lists with SonarQube Cloud and GitHub code scanning. `scripts/check-exclusions.py --sonarqube` fails when an SQ entry has no ID comment, an ID comment has no entry, a commented line is not marked false positive, or a false positive mark has no ID comment. `scripts/check-exclusions.py --codeql` fails when a dismissed CodeQL alert has no CQL entry, a listed alert is open, or a listed alert has no ID comment. Each failure says what to mark, dismiss or document. After a maintainer marks or dismisses, re-run the failed job.
