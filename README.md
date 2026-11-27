<h1 align="center"><a href="https://waveapp.dev"><img src="https://waveapp.dev/favicon.svg" width="64" height="64" align="absmiddle" alt="WAVE logo"></a>&nbsp;WAVE</h1>

<h3 align="center">Open source test automation for backend systems.</h3>

<p align="center"><a href="https://waveapp.dev"><b>Website</b></a> · <a href="#quick-start"><b>Quick Start</b></a> · <a href="https://github.com/waveapphq/wave-docs"><b>Docs</b></a> · <a href="https://github.com/waveapphq/wave-skills"><b>Skills</b></a> · <a href="https://waveapp.dev/roadmap"><b>Roadmap</b></a></p>

<p align="center">
  <a href="https://github.com/waveapphq/wave/actions/workflows/ci.yml"><img src="https://github.com/waveapphq/wave/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/version-1.0.0--alpha62-blue" alt="Version">
  <img src="https://img.shields.io/badge/python-3.12+-3776AB?logo=python&amp;logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react&amp;logoColor=black" alt="React">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/backend_tests-45%2C000%2B-brightgreen" alt="backend tests: 44,000+">
  <img src="https://img.shields.io/badge/frontend_tests-34%2C000%2B-brightgreen" alt="frontend tests: 33,000+">
  <img src="https://img.shields.io/badge/playwright_tests-5%2C000%2B-brightgreen" alt="playwright tests: 5,000+">
  <a href="tests/exclusions/README.md"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen" alt="coverage: 100%"></a>
</p>

<p align="center">
  <a href="https://sonarcloud.io/summary/new_code?id=waveapphq_wave-backend"><img src="https://img.shields.io/sonar/quality_gate/waveapphq_wave-backend?server=https%3A%2F%2Fsonarcloud.io&amp;label=backend%20quality%20gate" alt="backend quality gate on SonarQube Cloud"></a>
  <a href="https://sonarcloud.io/summary/new_code?id=waveapphq_wave-frontend"><img src="https://img.shields.io/sonar/quality_gate/waveapphq_wave-frontend?server=https%3A%2F%2Fsonarcloud.io&amp;label=frontend%20quality%20gate" alt="frontend quality gate on SonarQube Cloud"></a>
</p>

<p align="center">
  <a href="https://waveapp.dev/media/quick-tour.mp4">
    <img src="https://waveapp.dev/media/readme-demo.gif" alt="WAVE running a test">
  </a>
</p>

For engineers who test the same backend by hand every release: its HTTP APIs, Linux hosts, databases and Kubernetes clusters. Build each test once from Blocks on a canvas, debug it with breakpoints, and run it again every release.

There is no framework to learn, and you do not have to write code. When you want to, use a Python or shell Block. WAVE needs no account, sends no telemetry, never checks for updates, and works offline once it is installed.

## What WAVE does

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://waveapp.dev/media/workflow-clip.mp4"><img src="https://waveapp.dev/media/readme-debug.webp" width="400" alt="A WAVE test stopped at a breakpoint, with the Variable Manager showing the values the run holds"></a>
      <p><b>Debug a run step by step.</b> Set a breakpoint on any Block. When the run stops, you see every value it holds, and you can change one before you step on.</p>
    </td>
    <td width="50%" valign="top">
      <a href="https://waveapp.dev/media/shot-history.webp"><img src="https://waveapp.dev/media/shot-history.webp" width="400" alt="A saved WAVE run, read-only, with every Block on its path marked and the values the run ended with"></a>
      <p><b>Look back at old runs.</b> Open a run from months ago and see the test as it ran: the path it took, its values, its logs and the files it wrote.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://waveapp.dev/media/report-clip.mp4"><img src="https://waveapp.dev/media/report-clip-poster.webp" width="400" alt="The top of an exported WAVE report: result, environment, who started it and how long it took"></a>
      <p><b>Share the result.</b> Export a run as one HTML file that opens in any browser.</p>
    </td>
    <td width="50%" valign="top">
      <a href="https://waveapp.dev/media/shot-publish.webp"><img src="https://waveapp.dev/media/shot-publish.webp" width="400" alt="The Publish Function dialog with a version, tags and a changelog"></a>
      <p><b>Build it once, reuse it.</b> Build a Function once, publish it with a version and a changelog, and use it in any test as one Block.</p>
    </td>
  </tr>
</table>

## Connect an AI assistant

<p align="center"><a href="https://waveapp.dev/mcp.html"><img src="https://waveapp.dev/media/readme-mcp.gif" width="850" alt="A terminal chat asks for a WAVE test, the test builds in the WAVE Workbench, then runs and passes."></a></p>

WAVE has an MCP server. An AI assistant connected to it can read your tests, write or change one, start a run, and read the results. If the test is open in WAVE, you see each change and each run as it happens.

Turn the MCP server on in WAVE's Settings, connect your assistant and add WAVE's skill: [the MCP page](https://waveapp.dev/mcp.html) has the commands, and the skill is in [waveapphq/wave-skills](https://github.com/waveapphq/wave-skills). There is no AI model in WAVE, and WAVE calls none.

## What a test can reach

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
./scripts/lib/fetch-remote-wheels.sh
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

## Reference

<details>
<summary>Controls</summary>

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

</details>

<details>
<summary>Workbench</summary>

You build and run tests in the Workbench.

- Drag Blocks from the palette onto the canvas
- Fill in a form for each Block
- Connect Blocks to set the order they run in. WAVE checks the paths.
- Run a Test and see each Block's status change while it runs, such as running, passed or failed.
- Read the logs as they arrive in the console panel, with filters
- See variables change live in the Variable Manager
- Zoom and pan, select several Blocks by dragging a box, and use keyboard shortcuts and right-click menus
- Save your work as a Test, and add the Test to a Suite

</details>

<details>
<summary>Reusable Functions</summary>

A **Function** is a self-contained, versioned unit with typed inputs and outputs. Keep it as a **local** Function inside one Test, or **publish** it to the shared library so every Test can use it.

- **Local** Functions live inline in a Test; **published** Functions are immutable, versioned library entries
- Typed input/output contracts, validated at design time
- Semantic versioning with changelog and per-version history
- Import and export Functions. WAVE asks what to do when an imported Function conflicts with one you have.

</details>

<details>
<summary>Tests, Suites and more</summary>

Each of these has its own page. You can export all of them, and import all of them except Executions.

- **Tests** - Each Test holds its Blocks and variables
- **Suites** - Group Tests to run together
- **Regressions** - Group Suites to run together, such as for a release
- **Profiles** - Connection profiles for target systems (SSH, DB, K8s, etc.)
- **Environments** - Named sets of settings, so one Test can run against different systems
- **Executions** - Run history with results, logs, and timing

</details>

<details>
<summary>Variable System</summary>

- Variables live at four levels: system, Regression, Suite and Test.
- Computed variables with Python expression evaluation
- Secrets are masked in run logs, the console and reports. You can choose to show them, with a setting for all of WAVE or with an option on one Block.
- See their values live while a Test runs

</details>

<details>
<summary>Administration</summary>

- Dashboard with execution stats and recent activity
- Backup and restore as ZIP archives, for the items you pick
- System variables, set in Settings
- Import and export with validation and conflict handling, except Executions, which export only.
- Admin mode, which logs a reason and can reset the data you pick
- Change the log level while WAVE runs

</details>

<details>
<summary>Architecture</summary>

### Architecture

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

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.12+, FastAPI, Pydantic v2, WebSockets |
| Frontend | React 19, TypeScript 5.9, Vite 7, Zustand 5 |
| Canvas | XYFlow (@xyflow/react) |
| Editors | CodeMirror 6, tree-sitter-python (WASM) |
| Design | Tailwind CSS, shadcn/ui, Radix primitives |
| Testing | pytest (100% cov), Vitest, Playwright |
| CI/CD | GitHub Actions, Podman, SonarQube |

</details>

## Contribute

[CONTRIBUTING.md](CONTRIBUTING.md) says how to set up a clone, run the tests and send a change.
Every check that WAVE skips, in coverage, SonarQube Cloud or CodeQL, is listed in public with its reason in [tests/exclusions](tests/exclusions/README.md).
To report a security bug, follow [SECURITY.md](SECURITY.md).
For anything else, open an issue or write to support@waveapp.dev.

## License

WAVE is under the MIT License. [LICENSE](LICENSE) holds its text.

The name WAVE stands for Workflow Automation and Validation Engine. The WAVE name and logo belong to TrueByte LLC and are not covered by the MIT License.
