<div align="center">

# WAVE

### Workflow Automation and Validation Engine

Open source test automation for backend systems.

Build a test by dragging Blocks onto a canvas. Run it and debug it with breakpoints. You do not need to write code.

[waveapp.dev](https://waveapp.dev)

[![CI](https://github.com/waveapphq/wave/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/waveapphq/wave/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Version](https://img.shields.io/badge/version-1.0.0--alpha61-blue)
![Python](https://img.shields.io/badge/python-3.12+-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)

[![WAVE running a test](https://waveapp.dev/media/readme-demo.gif)](https://waveapp.dev/media/quick-tour.mp4)

</div>

---

## What is WAVE?

WAVE runs your tests against real systems, such as Kubernetes clusters, databases, SSH hosts and HTTP services. You drag Blocks onto a canvas, fill in their settings, connect them and click 'Run'.

```
Start --> SSH into host --> Query database --> Assert row count --> End
```

You build and run tests in the Workbench. WAVE runs on your own machine, on your own network.

**Key capabilities:**

- **Workbench**: drag Blocks onto a canvas and fill in a form for each one. WAVE checks the flow before it runs.
- **40 plugins** for Kubernetes and Helm, code execution, networking, databases, file operations, and data parsing
- **15 controls** for branching, loops, parallel branches, error handling, assertions and timing
- **Live runs**: see each Block's status, the logs and the variable values while the test runs.
- **Tests, Suites, Regressions, Profiles and Environments**, each with its own list in the app.
- **MCP server** that lets an AI assistant build and run tests. It is off until you turn it on in Settings. For Claude Code, the wave-mcp skill in [waveapphq/wave-skills](https://github.com/waveapphq/wave-skills) teaches the assistant to use it: run `/plugin marketplace add waveapphq/wave-skills`, then `/plugin install wave-mcp@wave-skills`.

## Quick Start

### Prerequisites

- Python 3.12+
- Poetry 2 or later
- Node.js 22.13+, or Node.js 24+
- Git

### 1. Clone and install

```bash
git clone https://github.com/waveapphq/wave.git
cd wave

# Backend
cd backend
poetry install

# Frontend
cd ../frontend
npm ci
```

Remote Execution carries database drivers to the remote host. To use Oracle, SQL Server or SQLite inside Remote Execution, run this from the repository root:

```bash
./scripts/fetch-remote-wheels.sh
```

### 2. Create the config file

WAVE reads its settings from `backend/config/config.yaml` and does not start without it. From the repository root, copy the example:

```bash
cp backend/config/config.example.yaml backend/config/config.yaml
```

The example has no secret key, and WAVE does not start without one. Make your own key in the backend folder:

```bash
cd backend
poetry run wave-new-secret-key
cd ..
```

It prints a new random key on one line. In `backend/config/config.yaml`, put it between the quotes of `secret_key: ""`, the last line of the `security` section. Share the key only with people who should read the same secrets.

The file also sets the data folder, where WAVE keeps its tests, profiles and run history:

```yaml
storage:
  base_path: ../data
```

A relative path starts at the config file's folder, so this is `backend/data`. WAVE does not start without this setting. `WAVE_STORAGE_BASE_PATH` overrides it and must be an absolute path.

Create the folder before the first start. The start command in step 3 stops with an error when `backend/data` does not exist. From the repository root, run:

```bash
mkdir -p backend/data
```

### 3. Start development servers

```bash
# Terminal 1 - Backend
cd backend
poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### 4. Open the app

Navigate to `http://localhost:3000`. Create a Test, open the Workbench, and start building.

## Architecture

```
                    +------------------+
                    |   React 19 SPA   |
                    |  (Workbench UI)  |
                    +--------+---------+
                             |
                    REST + WebSocket
                             |
                    +--------+---------+
                    |  FastAPI Server   |
                    |  (Python 3.12+)  |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----+----+  +-----+----+  +------+-----+
        |  Plugin  |  | Control  |  |  Storage   |
        |  System  |  |  Engine  |  | (YAML/JSON)|
        +----------+  +----------+  +------------+
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19, XYFlow, Zustand, Vite, TypeScript | The Workbench and the pages of the app |
| Backend | Python 3.12+, FastAPI, Pydantic, WebSockets | REST API, execution engine, plugin runtime |
| Storage | File-based YAML/JSON | Test definitions, profiles, environments, results |
| Editors | CodeMirror, tree-sitter-python (WASM) | Code editing with syntax validation |

## Plugins

A plugin is a Block that does one job, such as an HTTP call, a SQL query or a Kubernetes command.

| Category | Plugins | What they do |
|----------|---------|-------------|
| **Network** | HTTP, Ping, Netcat | REST/API calls with auth and TLS, reachability checks |
| **Remote** | SSH Session Open / Exec / Script / Close, SSH Tunnel Open / Close, SFTP, Remote Execution | Run commands and scripts on a host over a reusable SSH session, forward ports, transfer files, or run a group of Blocks on the host itself. A remote host needs only Python 3.10 or newer, on Intel/AMD or ARM, Alpine included; nothing is installed on it. |
| **Database** | SQL, OpenSearch | Query databases and search engines |
| **System** | Shell Script, Shell Exec, Python, File I/O, Log | Execute scripts with captured stdout/stderr, read and write files, record test logs |
| **Kubernetes** | K8s Connect, Get, Events, Logs, Top, Apply, Delete, Scale, Rollout, Exec, Script, Copy | Connect to a cluster once, then use one Block for each kubectl verb, on any kind of object: read objects, apply manifests, scale and restart workloads, and run commands inside pods |
| **Helm** | Helm Install, Upgrade, Rollback, Uninstall, Test, Status | Run the helm installed where the Block runs, on the cluster you connected to with K8s Connect: install and upgrade charts, roll back, run chart test hooks, and read a release |
| **Data** | CSV, Excel, XML, JSON | Extract and transform structured data |

## Controls

A control is a Block that changes how a test runs, such as a condition, a loop or a wait.

| Control | Description |
|---------|-------------|
| **If / Else** | Run one branch or the other, based on a condition |
| **Switch** | Run one of many cases, based on conditions |
| **Assert** | Fail when a condition is false |
| **For Loop** | Repeat over a range of numbers |
| **For Each** | Repeat for each item in a collection |
| **While Loop** | Repeat while a condition is true |
| **Break** | Leave the current loop |
| **Continue** | Skip to the next pass of the loop |
| **Parallel** | Run several branches at the same time |
| **Try / Catch** | Handle errors, with a 'finally' part for cleanup |
| **Halt** | Stop the run at the Test, Suite or Regression level |
| **Var Setter** | Set or change variables |
| **Delay** | Wait for a set time |
| **Wait Until** | Wait until a condition is true or the time runs out |
| **Note** | Add a text note to the canvas |

## Features

### Workbench

You build and run tests in the Workbench.

- Drag Blocks from the palette onto the canvas
- Fill in a form for each Block
- Connect Blocks to set the order they run in. WAVE checks the paths.
- Run a Test and see each Block's status change while it runs, such as running, passed or failed.
- Read the logs as they arrive in the console panel, with filters
- See variables change live in the Variable Manager
- Zoom and pan, select several Blocks by dragging a box, and use keyboard shortcuts and right-click menus
- Save your work as a Test, and add the Test to a Suite

### Reusable Functions

A **Function** is a self-contained, versioned unit with typed inputs and outputs. Keep it as a **local** Function inside one Test, or **publish** it to the shared library so every Test can use it.

- **Local** Functions live inline in a Test; **published** Functions are immutable, versioned library entries
- Typed input/output contracts, validated at design time
- Semantic versioning with changelog and per-version history
- Import and export Functions. WAVE asks what to do when an imported Function conflicts with one you have.

### Tests, Suites and more

Each of these has its own page. You can export all of them, and import all of them except Executions.

- **Tests** - Each Test holds its Blocks and variables
- **Suites** - Group Tests to run together
- **Regressions** - Group Suites to run together, such as for a release
- **Profiles** - Connection profiles for target systems (SSH, DB, K8s, etc.)
- **Environments** - Named sets of settings, so one Test can run against different systems
- **Executions** - Run history with results, logs, and timing

### Variable System

- Variables live at four levels: system, Regression, Suite and Test.
- Computed variables with Python expression evaluation
- Secrets are masked in run logs, the console and reports. You can choose to show them, with a setting for all of WAVE or with an option on one Block.
- See their values live while a Test runs

### Administration

- Dashboard with execution stats and recent activity
- Backup and restore as ZIP archives, for the items you pick
- System variables, set in Settings
- Import and export with validation and conflict handling, except Executions, which export only.
- Admin mode, which logs a reason and can reset the data you pick
- Change the log level while WAVE runs

## Development

[CONTRIBUTING.md](CONTRIBUTING.md) says how to build WAVE and run its tests.

### SonarQube

Static analysis and code quality tracking via SonarQube. Requires `sonar-scanner` in `$PATH`, `SONAR_TOKEN`, and `SONAR_URL` (e.g. `http://localhost:9000`).

```bash
# Run scanner
./scripts/sonar-scan-backend.sh
./scripts/sonar-scan-frontend.sh

# View results (metrics, bugs, hotspots)
./scripts/sonar-results-backend.sh
./scripts/sonar-results-frontend.sh
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.12+, FastAPI, Pydantic v2, WebSockets |
| Frontend | React 19, TypeScript 5.9, Vite 7, Zustand 5 |
| Canvas | XYFlow (@xyflow/react) |
| Editors | CodeMirror 6, tree-sitter-python (WASM) |
| Design | Tailwind CSS, shadcn/ui, Radix primitives |
| Testing | pytest (100% cov), Vitest, Playwright |
| CI/CD | GitHub Actions, Podman, SonarQube |

## Contribute

[CONTRIBUTING.md](CONTRIBUTING.md) says how to set up a clone, run the tests and send a change.
To report a security bug, follow [SECURITY.md](SECURITY.md).
For anything else, open an issue or write to support@waveapp.dev.

## License

WAVE is under the MIT License. [LICENSE](LICENSE) holds its text.

The WAVE name and logo belong to TrueByte LLC and are not covered by the MIT License.
