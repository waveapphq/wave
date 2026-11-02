# CLAUDE.md

This file holds WAVE's code rules. They hold for every change, made by hand or with an AI assistant such as Claude Code (claude.ai/code). How to propose a change is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Code Rules

### SonarQube Policy
- **Fix the code, not the report** - When SonarQube reports an issue, fix it in the source code. Never suppress it in SonarQube.
- **No NOSONAR comments** - Never add `// NOSONAR`, `# NOSONAR`, or any other SonarQube suppression comment to source code.
- **False positives** - A maintainer reviews false positives in SonarQube.

### Typography Policy
- **Never use em dashes or en dashes** (Unicode U+2014 and U+2013) - Always use regular hyphens/dashes (-) in all code, comments, documentation, and UI text. This applies to every file in the repository without exception.
- **Spelling** - Every identifier, wire name, UI string, comment, test title, doc, report and AI prompt follows the spelling that `typos.toml` sets.

### Code Comments Policy
- **No large comments in code** - Source files are not the place to record decisions. Comments are minimal: one short line max when the why is non-obvious. Multi-paragraph rationale, problem analyses, "before/after" narratives, root-cause traces, and design discussions belong in PR descriptions, issues, and commit messages - not in source files. If a future reader needs more than one line of context, link to the doc.
- **Forbidden in source**: function-purpose paragraphs, "a user reported X bug" explanations, root-cause narratives, before/after comparisons, multi-line option discussions, and **any historical chronicle** - a reference to a moment in the project's history rather than to a durable contract.
- **Allowed**: one-line comments naming a non-obvious invariant, a hidden constraint, or a workaround anchor. JSDoc-style `/** ... */` at most one short sentence.

**The test for any reference: where does the thing it points at live?**

| Referent lives in | Verdict | Examples |
|---|---|---|
| The design and the requirements in the WAVE docs repo | **VALID - keep** | `REQ-3.1.3.14`, `CANVAS-72`, `LIST-7`, `SHELL-2`, "per the Lifecycle badge location decision" |
| `frontend/coverage-exclusions.md` | **MANDATORY** | `COV-BRANCH-146` - a `v8 ignore` without its registry ID is a policy violation |
| A roadmap, a session handoff, a ticket tracker, a PR, or a past conversation | **FORBIDDEN** | "Roadmap 10.6 #8", "phase 12.6", "D7", "issue #123", "ABC-42", "added for the Y flow", "fix for the Z regression", "session 4 decided" |

Requirements and design are the contracts the code must satisfy; pointing at them is traceability and is wanted. Roadmaps, handoffs and tickets are scheduling and history; they get reordered and deleted, so a pointer to one outlives its referent and becomes dead weight. Never run a sweep that strips `REQ-*`, design-decision IDs, or `COV-*` from source.

### Engineering Excellence Mindset
- **Verify everything** - Validate assumptions, inputs, outputs. Test thoroughly, assume nothing.
- **Push back on bad ideas** - If a request harms performance, security, or maintainability, explain why and propose alternatives.
- **User-first thinking** - Every decision should improve the user experience.

### Root Cause Analysis Policy (no fabricated diagnoses)
- **Evidence before diagnosis** - Form hypotheses from measurements, diffs, and logs - not intuition. Then actively try to disprove your conclusion before presenting it.
- **Never fabricate a root cause** - If you don't know, say "I don't know yet". A wrong confident diagnosis is worse than admitting uncertainty.
- **Never revert working code based on speculation** - Only recommend reverts with proof the reverted code causes the issue.
- **Consider environmental factors** - DevTools, extensions, system load, network, container limits. Reproduce before diagnosing.
- **Two-step analysis** - After the normal root cause analysis, perform a second iteration but this time "think differently" and see if initial analysis still makes sense.

### Frontend Unit Test Isolation Policy (required)
- **No real API calls in unit tests** - Frontend unit tests must never make actual HTTP requests to the backend; never rely on the backend being available during unit tests
- **All fetch/API calls must be mocked** - Every test file that renders components making API calls must mock those API modules before any test runs
- **Tests must fail if unmocked** - If a test accidentally makes a real API call, it must fail immediately with a clear error
- **Global fetch mock is mandatory** - `frontend/tests/setup.ts` must include a global fetch mock that throws an error for any unmocked calls
- **Isolation is non-negotiable** - Unit tests run in parallel with other workflows (Playwright, backend tests). Real API calls break these workflows
- **Warning logs are violations** - Any `[UNMOCKED FETCH]` message indicates a test isolation failure that must be fixed
- **Mock at the module level** - Use `vi.mock()` (or `vi.spyOn()`) to mock API modules, not just individual functions
- **Verify mocks are active** - Before running tests, verify that fetch/API mocks are properly installed

### File Operation Rules
- **Always read before editing** - Never guess file contents: you must read any file (at least the region you edit) before attempting to edit or write it
- **Verify file existence** - Check if files exist before operations to provide better error messages
- **Preserve exact formatting** - When editing, maintain the original file's indentation and style

### Documentation Maintenance During Implementation

The requirements, the solution description and the high-level design live in the WAVE docs repo. The rules below hold there.

**Rules:**
- **Do not create random new doc files** - Update or add to the existing design, requirements or solution description in the docs repo only.
- **Requirements are the source of truth** - Design reflects requirements, code must match design
- **Never document wrong implementation** - If code doesn't match requirements, the code is wrong

### The wave-mcp Skill
The wave-mcp skill, which teaches AI assistants to use WAVE, lives in [waveapphq/wave-skills](https://github.com/waveapphq/wave-skills). A change that makes something in it wrong also updates it there: an MCP tool, a value, a Block setting or a behavior that it names. A new Block needs no skill change, because the skill reads Block settings from the server.

**Design Document Standards (HLD not LLD):**
- No code snippets, class names, method signatures, or implementation details
- Focus on architecture, patterns, component interactions, and conceptual design
- Keep technology-agnostic where possible
- **HLD states what is, not what will be** - Design docs describe the complete intended state of the system. Do not add "v1 policy", "deferred to item N", "future work", "not yet implemented", "planned for later", or roadmap/phase references. Implementation status belongs in issues, not in the design. Even if a capability is not yet built, the design for it is part of the HLD.

### Implementation Flow (Docs-First TDD Approach)
Every change must follow this process:
1. **Find the requirements** - Read the relevant requirements and the solution description in the docs repo
2. **Document design** - Update the design in the docs repo with high-level architecture (HLD, not LLD - no code snippets)
3. **Review existing code** - Check `wavecore/` for production code. If missing, create it - don't elaborate test mocks.
4. **Flag divergences** - If existing code conflicts with requirements, flag it before proceeding
5. **Write all tests first** (TDD) - Use exact error messages (`^exact message$`), not flexible regex. Run immediately to verify.
6. **Implement production code** in `wavecore/`, not in test mocks. Run tests after each change.
7. **Verify coverage** - 100%, no exceptions
8. **Run all CI checks** - See CI Validation Policy
9. **Validate alignment** - Confirm implementation matches requirements and design
10. **Iterate** until all tests pass, coverage is 100%, CI is green

### Test-Driven Development Policy
- **Fix the code, never the test** - Tests define the contract. If tests fail, the implementation is wrong.
- **Explicit approval required to modify tests** - Stop, explain why, identify the root cause, and get approval from a maintainer (or, for an AI assistant, from the developer it works for).
- **Exception: tests of old or broken behavior** - A test that clearly pins behavior a maintainer (or the developer an AI assistant works for) ruled to change, behavior that was removed, a bug being fixed, or a fixture that does not model what it claims is updated without asking; the pull request description lists each one. Never weaken a test of correct behavior to get green.
- **Test skipping is forbidden** - No `@pytest.mark.skip` without explicit approval from the same people. If a test can't pass, stop and explain.

### Production Code vs Test Mocks Policy
- **Never implement production logic in test mocks** - Production code goes in `wavecore/`/`backend/`, not `tests/`
- **Never put test/mock code in production files** - No mock implementations, test stubs, simulation logic, or test data in prod files
- **Exception**: `data-testid` attributes and registered coverage exclusions (`/* v8 ignore next - COV-XXX-NNN */` with ID in `frontend/coverage-exclusions.md`) are allowed
- **If tests fail, check for production code first** - Does `wavecore/` contain the real implementation? If not, create it. Never "fix" by elaborating mocks.
- **Mock complexity is a red flag** - If a mock has >50 lines, you're implementing in the wrong place
- **Correct**: `wavecore/plugins/sql_client.py` (real impl) + `tests/plugins/sql_client/conftest.py` (test fixtures over a scripted fake connection)
- **Wrong**: 600-line MockSQLClient in conftest.py, or `if self.mock_mode:` in production code

### Code Coverage Policy
- **100% coverage is mandatory** - Never lower the 100% gate in `scripts/run-coverage-backend.sh` or the thresholds in `frontend/vite.config.ts`. Write more tests, don't lower the bar.
- **Frontend functions read lower** - The frontend's function coverage shows less than 100%, and its gate is 96%, because `v8 ignore` blocks hide their lines, branches and statements from the report but not the functions defined inside them. Aim for 100% there too.
- **If 100% seems hard, the code design may be wrong** - Question the architecture, not the requirement.

### Coverage Exclusions Registry (do not modify)
- **Registry**: `frontend/coverage-exclusions.md` - no modifications without a maintainer's approval
- **Format**: `/* v8 ignore next - COV-XXX-NNN */` - verify the ID exists in the registry before accepting
- **Unregistered `/* v8 ignore */` comments are policy violations**
- **Before proposing exclusions**: Write tests for the edge case, fallback, and negative case first. Exclusions are only for genuinely untestable code (SSR checks, React concurrent internals, missing jsdom APIs) - not for "we didn't test this branch"
- **Adding new exclusions**: Stop, explain why the code is untestable, and get a maintainer's approval; a maintainer adds the registry entry

### Test File Organization Policy
- **Organize by architecture, not by test type** - Structure tests in domain directories (e.g., `tests/plugins/ssh/`, `tests/connectivity/`) and split files by meaningful components (e.g., `test_ssh_session_open.py`, `test_ssh_session_close.py`, `test_ssh_tunnel_open.py`)
- **Never use nonsense suffixes** - File names like `test_*_coverage.py`, `test_*_edge_cases.py`, `test_*_integration.py`, or `test_*_unit.py` are forbidden; all test types (coverage, edge cases, error handling) belong in the architecturally appropriate file organized by test classes

### CI Validation Policy
- **All CI checks must pass** - Never declare a change or any work complete until CI is green; fix any failing check immediately, never disable CI checks, and never use `# type: ignore` without explicit justification
- **Change CI files only when that is the pull request's purpose** - A pull request that changes the CI scripts (`scripts/ci-*.sh` and the scripts they run, such as `scripts/run-coverage-backend.sh`, `scripts/run-e2e-shard.sh`, `scripts/check-orphaned-files.sh` and `scripts/check-text.sh`), the text check settings (`typos.toml`), the SonarQube scripts and settings (`scripts/sonar-*.sh`, `backend/sonar-project.properties`, `frontend/sonar-project.properties`) or the GitHub workflows and code owners (`.github/workflows/`, `.github/CODEOWNERS`) is rejected unless fixing those files is the purpose of its issue. Fix the code instead; change a test only as the Test-Driven Development Policy allows.
- **Local validation is mandatory** - Run the full CI suite locally before declaring work complete. There are exactly three CI surfaces; do not invoke `pytest --cov`, `npm test -- --coverage`, or `sonar-scan-*.sh` separately - the BE and FE CI scripts run coverage and SonarQube (with `qualitygate.wait=true`) internally.
  ```bash
  # Backend CI (container-based) - includes text checks, tests, 100% coverage gate,
  # mypy, black, ruff, and SonarQube scan with quality-gate wait
  ./scripts/ci-backend-local.sh

  # Frontend CI (container-based) - includes text checks, tests, 100% coverage gate,
  # type-check, build, and SonarQube scan with quality-gate wait
  ./scripts/ci-frontend-local.sh

  # Playwright (sharded across Podman containers) - E2E visual + functional tests
  ./scripts/ci-playwright-local.sh
  ```
- **Required host** - The three suites are tuned for Ubuntu 22.04 with its Podman 3.4, on an x86_64 machine with 16 cores, 24 GB of memory and 100 GB of free disk. For now, this is a hard requirement.
- **Text checks** - `./scripts/check-text.sh` fails on spelling that `typos.toml` does not allow (`typos`, pinned in `backend/poetry.lock`), on em and en dashes in every text file that `.gitignore` does not exclude, and on process markers in source comments. The backend and frontend CI scripts and GitHub CI run it. Fix the text; a test string that needs a dash or a misspelling uses an escape or another misspelling.
- **Optional results helpers** - `./scripts/sonar-results-backend.sh` and `./scripts/sonar-results-frontend.sh` are read-only reporting tools that summarize SonarQube findings after a scan has already run. Use them only to inspect details when the quality-gate fails inside a CI script; never as a substitute for the CI script itself.
- **CI scripts write logs to files** - Output is tee'd to `/tmp/ci-frontend.log` and `/tmp/ci-backend.log`
- **Never re-run CI to see truncated output** - After a CI run, read or search the log file to find specific details (coverage gaps, error messages, etc.)
- **Group changes before running CI** - Make all reasonable code and test changes first, then run CI once. Do not run CI after every small edit. Group related fixes (implementation + tests + coverage) together, then verify. CI runs take minutes - minimize the number of runs by doing more work between them.
- **No "pre-existing" or "unrelated" excuses** - If CI fails on your branch, find the cause before you call it unrelated. A failure your change caused is fixed in that pull request. A failure that is already on `master` or on the release branch gets an issue, as Pull Request Scope says; never ignore it.
- **Modern Python typing** - Always use modern type hints (Python 3.10+ style):
  - Use `dict[K, V]` not `Dict[K, V]`
  - Use `list[T]` not `List[T]`
  - Use `X | None` not `Optional[X]`
  - Use `X | Y` not `Union[X, Y]`
  - Use `TypeVar` for generic functions that need type preservation
- **Type stubs for third-party libraries** - Install type stubs when mypy reports missing types:
  ```bash
  poetry add --group dev types-{library-name}
  ```
- **A change is not complete until**:
  - All tests pass with 100% coverage
  - `mypy` reports zero errors
  - `black --check` reports zero formatting issues
  - `ruff check` reports zero linting violations
  - All frontend checks pass (if applicable)
  - Playwright visual tests pass (if UI changes)

### No Backward Compatibility Code (no exceptions)
- **WAVE is v1 - there are no legacy consumers** - Never create backward-compat shims, normalization layers, barrel re-exports, `sys.modules` tricks, `__getattr__` proxies, or any code whose purpose is "so old paths/names still work"
- **When renaming, update all callers** - If you rename a function, endpoint, entity type, or import path, update every caller and test to use the new name directly. Delete old names entirely.
- **No "old format" handling** - Do not add code to accept old formats, old entity types, old API paths, or old data shapes. If the format changed, it changed everywhere.
- **The cost of updating callers is always less than compat machinery** - Compat code adds complexity, confuses developers, needs its own tests, and creates infrastructure debt.

### Code Hygiene Policy (no orphaned code)
- **Every new file must be imported by production code** - No "infrastructure for later". If a file is created, it must be used by production code in the same changeset. Speculative infrastructure that isn't wired in immediately becomes orphaned debt.
- **Grep before creating** - Before creating a new utility, hook, or store, search for existing implementations. Integrate and extend existing code rather than duplicating functionality. Run `grep -r "functionName\|similar-pattern" src/` before writing new abstractions.
- **No silent deferrals** - A requirement deferred from a change must be tracked in a GitHub issue. Every deferral must include: (a) what is deferred, (b) where it is tracked (the issue), (c) why it was deferred. Untracked deferrals are forbidden.

### Pull Request Scope
These hold for maintainers and contributors alike.
- **One issue per pull request** - Its size does not matter; the issue says what the pull request covers.
- **Small fixes must be listed** - Small fixes in the code the pull request already touches are allowed if its description lists them.
- **Anything else is a new issue** - Any other change becomes a new GitHub issue, not part of the pull request.
- **`master` and each release branch are always green** - The maintainer keeps them so. A break the pull request caused is fixed in that pull request. If `master` or the release branch is red, open an issue instead; the maintainer fixes it first.

### Code Organization Policy (architecture first)
- **Think structurally before fixing locally** - When fixing duplication, don't just extract helpers that callers still manually assemble. Make the parent component accept data props and render internally. If three callers pass the same JSX pattern, the pattern belongs inside the shared component, not in a new component the callers import.
- **One entity per file** - Registries, schemas, and definitions should have one file per domain entity (e.g., one file per control, one file per plugin), not all entities dumped into a single flat file.
- **Domain boundaries are directories** - Controls and plugins are separate domains - they get separate directories, not separate files in the same directory. Never put plugin code in a controls directory or vice versa.
- **`lib/` vs `components/`** - `lib/` contains pure data and logic (no React, no JSX). `components/` contains React components. `lib/` is importable by anything; `components/` imports from `lib/` but never the reverse.
- **Co-locate related data** - Input and output parameters for the same node belong in the same file. Don't split by data shape (all inputs in one file, all outputs in another) when the domain grouping is by entity.

### Frontend Code Standards
Three Vercel engineering skills are optional helpers for frontend work, for an AI assistant that has them installed. The rules below hold either way.
- `react-best-practices` - Bundle size, re-render prevention, React 19 patterns
- `composition-patterns` - Component composition, compound components, state lifting
- `web-design-guidelines` - UI audit against Rauchg's web-interface-guidelines (fetches fresh rules)

**Imports & Bundle:**
- **Direct imports only** - Import from source files, never from barrel/index.ts re-exports. Barrels force-load all re-exported modules. Barrel files may exist as public API boundaries but all internal code imports directly from the source file.
  - Wrong: `import { Button } from '@/components'`
  - Right: `import { Button } from '@/components/ui/button'`
- **Lazy-load heavy components** - Editors, charts, maps use `React.lazy()`. Preload on hover/focus: `void import('./heavy-module')`

**React 19 (required):**
- **ref as prop** - No `forwardRef`. `function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> })`
- **use() replaces useContext()** - `const value = use(MyContext)` - callable conditionally
- **Passive listeners** - `{ passive: true }` for scroll/touch events

**Re-render Prevention:**
- **Zustand selectors** - Narrowest slice: `useStore(s => s.count)` not `useStore(s => s)`
- **No inner components** - Define components at module scope. Inner definitions destroy state on parent re-render.
- **Derived state inline** - Calculate during render, never useEffect+setState (double render).
- **Handlers over effects** - Interaction logic in event handlers, not useEffect.
- **Hoist non-primitive defaults** - Extract `[]`, `{}` to module-level constants.

**Composition:**
- **3+ boolean props = refactor** - Create explicit variant components instead of boolean prop explosion.
- **Compound components** - Complex shared state uses Provider + namespaced subcomponents.
- **Decouple state from UI** - Provider owns state; UI consumes a generic context interface.

**Async:**
- **Promise.all() for independent fetches** - Never sequential awaits for independent operations.
- **Defer await** - Move `await` into branches where data is used, not before early returns.

## Project Overview

WAVE (Workflow Automation and Validation Engine) is a comprehensive automation and testing framework for distributed systems, with strong support for Kubernetes environments and event processing pipelines. It provides visual workflow design, interactive debugging, and comprehensive validation capabilities across multiple system layers.

## Architecture

### System Components
- **Backend**: Python 3.12+/FastAPI server providing REST API and WebSocket support
- **Frontend**: React 19 with XYFlow (@xyflow/react) for visual workflow building (Web GUI is primary test engineering interface)
- **Storage**: File-based YAML/JSON storage
- **Plugin System**: Extensible plugin architecture for core functionality

### Key Design Patterns
- **Plugin Architecture**: All executors inherit from abstract base class with metadata declaration
- **Hierarchical Structure**: Regression → Suite → Test → Block → Plugin
- **Variable Scoping**: Each level holds its own variables, and a test reads a higher level through its namespace, such as `suite.x`.
- **Parallel Execution**: Fork/join model with independent branch contexts
- **Error Handling**: Try-catch-finally semantics with configurable retry logic

## Development Setup

### Prerequisites
```bash
# Required versions
python >= 3.12  # Latest stable Python
poetry >= 2.0   # Backend packages and commands
node 22.13+ or >= 24  # a later 22 release also works
git >= 2.0      # For user attribution
```

### Install
Follow the [Quick Start](README.md#quick-start) in README.md. Its step [2. Create the config file](README.md#2-create-the-config-file) makes your own secret key; WAVE does not start without it.

### Project Structure
```
wave/
├── backend/
│   ├── wavecore/                # Main Python package
│   │   ├── api/                 # FastAPI routes, middleware, WebSocket, services
│   │   ├── connectivity/        # SQL, Kubernetes, Helm and OpenSearch clients, shared TLS and proxy code
│   │   ├── controls/            # Control flow logic
│   │   ├── core/                # Business logic (blocks, execution, expressions, variables, parallel, secrets)
│   │   ├── logging/             # Logging infrastructure
│   │   ├── mcp/                 # MCP server and its tools
│   │   ├── models/              # Data models (controls, profiles)
│   │   ├── plugins/             # Plugin implementations
│   │   └── storage/             # File-based storage layer
│   ├── config/                  # config.example.yaml (copy to config.yaml)
│   ├── tests/                   # Backend tests (pytest, 100% coverage)
│   └── pyproject.toml           # Poetry config
├── frontend/
│   ├── src/
│   │   ├── app/                 # Entry point, router, layouts, route boundaries
│   │   ├── features/            # Feature modules (domain-driven)
│   │   │   ├── artifacts/       # Execution artifacts list, download, delete
│   │   │   ├── auth/            # Login, auth store
│   │   │   ├── dashboard/       # Dashboard API, components, container
│   │   │   ├── executions/      # Execution list, filters, table
│   │   │   ├── functions/       # Function library and Function canvas
│   │   │   ├── profiles/        # Profile CRUD, form modal, import/export
│   │   │   ├── regressions/     # Regression list, filters
│   │   │   ├── reports/         # Execution reports list and detail
│   │   │   ├── settings/        # Admin, backup, environments, global vars
│   │   │   ├── suites/          # Suite list, filters
│   │   │   ├── tests/           # Test list, canvas pages, CRUD
│   │   │   └── workbench/       # Visual workflow builder (canvas, editors, palette, console)
│   │   ├── components/          # Shared UI components (sidebar, pagination, tables)
│   │   ├── design-system/       # Design tokens and base components
│   │   ├── hooks/               # Shared React hooks
│   │   ├── lib/                 # Utilities and helpers
│   │   ├── services/            # API client services
│   │   ├── stores/              # Global Zustand stores
│   │   └── types/               # Shared TypeScript types
│   ├── tests/                   # Frontend unit tests (Vitest)
│   └── package.json             # NPM config
├── tests/
│   └── e2e/                     # Playwright E2E and visual tests
├── scripts/                     # CI, coverage, SonarQube, container and E2E scripts
├── .github/workflows/           # CI and pull request checks
└── CLAUDE.md
```

## Common Commands

### Backend Development
```bash
# Install dependencies
poetry install

# Run development server
poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8000

# Run the tests for one area while you work (the 100% coverage gate runs in ./scripts/ci-backend-local.sh)
poetry run pytest tests/<area>

# Type checking
poetry run mypy wavecore/

# Code formatting
poetry run black wavecore/
poetry run ruff check wavecore/ --fix
```

**Note**: Poetry 2.0+ removed the `shell` command. Use `poetry run` to execute commands in the virtual environment, or activate it with `source $(poetry env info --path)/bin/activate`.

**Configuration**: Backend uses hierarchical config: defaults, then the config file (`backend/config/config.yaml`, a copy of `config.example.yaml`, or `WAVE_CONFIG_FILE`), then env vars (see the Environment Variables section); Settings pages write instance settings back into it. See `backend/README.md` for details. Key file: `backend/config/config.example.yaml` - CORS origins for localhost (ports 3000, 3001).

**E2E Testing**: Run E2E specs in a container, with their own backend and data, by naming each spec path relative to `tests/e2e/` (see `CONTRIBUTING.md`):
```bash
./scripts/e2e-targeted-local.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts
```
Never run the Playwright configs in `tests/e2e/` straight on the host: their setup resets the data of the dev backend on port 8000.

### Frontend Development
```bash
# Install dependencies (the exact versions in package-lock.json)
npm ci

# Development server
npm run dev

# Build production bundle
npm run build

# Run the tests of one file while you work
npx vitest run tests/<file>

# Type checking
npm run type-check
```

## Testing Requirements

- **Unit Tests**: 100% code coverage (see Code Coverage Policy)
- **Coverage Reports**: Generated in both HTML and JSON formats
- **API and Service Tests**: API, storage, WebSocket and plugin tests run in the backend suite; tests against real services run as functional E2E tests
- **E2E Tests**: Required for critical user workflows
- **Playwright Visual Tests**: Follow conventions in `tests/e2e/README.md`. Reference design decisions by ID (e.g., LIST-6, CANVAS-9).

## Key Files

- `backend/wavecore/api/app.py` - FastAPI application entry point
- `frontend/src/app/router.tsx` - Route definitions
- `frontend/src/app/main.tsx` - Frontend entry point
- `backend/config/config.example.yaml` - dev config starting point
- `frontend/coverage-exclusions.md` - V8 exclusion registry
- `scripts/Containerfile` - Container build definition

## Environment Variables

- `WAVE_CONFIG_FILE=/abs/path/config.yaml` - Use another config file (default `backend/config/config.yaml`)
- `WAVE_ADMIN_ALLOWED=true` - Enable admin API
- `WAVE_LOG_LEVEL=DEBUG` - Log verbosity (DEBUG/INFO/WARN/ERROR/FATAL); overrides the config file's level at startup
- `VITE_API_BASE_URL=http://localhost:8001` - Override API URL for frontend
- `SONAR_TOKEN` - Required for SonarQube scanning
- `WAVE_MCP_SECRETS_DIR` - Server-side root for the recipe `value_from_file` secret mode (overrides `security.secrets_input_dir`; unset disables the mode)
