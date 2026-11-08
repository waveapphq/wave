# Contributing

This doc covers how to work on WAVE itself. It says how to set up a clone, build and check the code, run the tests and send a change. It also gives the rules for code and docs, what each folder of the clone holds, and the license of a contribution.

## Set up a clone

The test suites are tuned for Ubuntu 22.04 on an x86_64 machine with 16 cores, 24 GB of memory and 100 GB of free disk. For now, this is a hard requirement. You need these tools on your machine:

| What you need | What uses it |
|---|---|
| Python 3.12 or later | The backend. |
| Poetry 2 or later | The backend. Poetry installs its packages and runs its commands. |
| Node.js 22.13 or a later 22 release, or Node.js 24 or later | The frontend. |
| Podman 3.4, the version that Ubuntu 22.04 ships | The three test suites, which run in containers. |
| The `docker-compose` v2 binary, on your `PATH` | `scripts/e2e-stack.sh`, which starts the services that the E2E specs run against. |
| `sonar-scanner`, on your `PATH` | The SonarQube step of the backend and frontend suites, as [The SonarQube step](#the-sonarqube-step) says. |
| `jq` | The test count at the end of `./scripts/ci-playwright-local.sh`. Without it, the count says 0. The result of the suite does not change. |

Run these commands to clone WAVE and install its packages:

```sh
git clone https://github.com/waveapphq/wave
cd wave
cd backend
poetry install
cd ../frontend
npm ci
cd ../tests/e2e
npm ci
cd ../..
```

`npm ci` installs the exact versions that the `package-lock.json` of its folder pins, and leaves that file as it is.

Then make the config file and its secret key, as [README.md, section "2. Create the config file"](README.md#2-create-the-config-file) says. Start the backend and the frontend as [README.md, section "3. Start development servers"](README.md#3-start-development-servers) says.

### Build the test images

The three test suites run in Podman containers. Run these commands once, from the root of the clone, to build the images that they use:

```sh
./scripts/build-ci-image.sh
./scripts/build-e2e-image.sh
./scripts/e2e-stack.sh build
```

| Command | What it builds |
|---|---|
| `./scripts/build-ci-image.sh` | The image `wave-ci`, with Python, Poetry, Node.js and the backend packages in it. It also fetches the wheels that `backend/vendor/wheels.lock` pins into `backend/vendor/wheels/`, which the backend tests read. |
| `./scripts/build-e2e-image.sh` | The image `wave-e2e`, which is `wave-ci` with Chromium for Playwright. It needs `wave-ci`. |
| `./scripts/e2e-stack.sh build` | The images of the services that the E2E specs run against, such as SSH hosts, databases, Kubernetes API servers and an OpenSearch node. Building them accepts the vendor license terms in `tests/e2e/services/README.md`. |

Build `wave-ci` again when the backend packages change. When the frontend or E2E packages change, run `npm ci` in `frontend/` and `tests/e2e/`. Build `wave-e2e` again after each build of `wave-ci`, and when the version of Playwright changes. Run `./scripts/e2e-stack.sh build` again when a file in `tests/e2e/services/` changes.

`scripts/e2e-stack.sh` reaches Podman through the API socket of your user, at `$XDG_RUNTIME_DIR/podman/podman.sock`. Start that socket before you run an E2E spec.

```sh
systemctl --user enable --now podman.socket
```

## Build and check the code

Run each command in the folder that the table names. The backend and frontend suites run the same checks, as [Run the tests](#run-the-tests) says.

| Folder | Command | What it does |
|---|---|---|
| `backend/` | `poetry run mypy wavecore/` | Checks the types of the backend code. |
| `backend/` | `poetry run black --check wavecore/` | Checks the format of the backend code. `poetry run black wavecore/` fixes the format. |
| `backend/` | `poetry run ruff check wavecore/` | Lints the backend code. |
| `frontend/` | `npm run type-check` | Checks the types of `frontend/src/` and `frontend/tests/`. |
| `frontend/` | `npm run lint` | Lints `frontend/src/` with ESLint. |
| `frontend/` | `npm run build` | Checks the types, then builds the frontend into `frontend/build/`. |
| The root of the clone | `./scripts/check-text.sh` | Runs the text checks, as [Run the tests](#run-the-tests) says. |

## Run the tests

WAVE has three test suites. Each suite has a script that runs it in Podman containers. Run the scripts one at a time, from the root of the clone:

```sh
./scripts/ci-backend-local.sh
./scripts/ci-frontend-local.sh
./scripts/ci-playwright-local.sh
```

| Script | What it runs |
|---|---|
| `./scripts/ci-backend-local.sh` | On the host: the text checks. In a `wave-ci` container: every backend test with pytest, which fails below 100% coverage, then mypy, `black --check` and ruff. On the host: the SonarQube scan of `backend/`. |
| `./scripts/ci-frontend-local.sh` | On the host: the check for orphaned files and the text checks. In a `wave-ci` container: ESLint, the type check, every frontend test with Vitest, and the build. On the host: the SonarQube scan of `frontend/`. |
| `./scripts/ci-playwright-local.sh` | On the host: the frontend build and the E2E services. In 8 `wave-e2e` containers: every Playwright spec, split between the containers. Each container has its own backend, frontend and data. |

The frontend tests fail below 100% coverage of lines, branches and statements. They also fail when a test writes unexpected output to stderr.

The text checks fail on spelling that `typos.toml` does not allow, on an em or en dash in any text file that `.gitignore` does not exclude, and on a reference to a roadmap, a phase, a session or a ticket in a source comment. They never fail on `REQ-*`, design IDs or `COV-*`. `poetry install` in `backend/` installs `typos`, the tool of the first check, at the version that `backend/poetry.lock` pins. Its settings are in `typos.toml`. Fix each line that the checks list.

### The SonarQube step

The backend and frontend scripts each scan their code with SonarQube, on the host. The scan waits for the quality gate of its project, `wave-backend` or `wave-frontend`, and fails when the gate fails. The scan needs these on the host:

- `sonar-scanner`, on your `PATH`.
- `SONAR_URL`, set to the address of a SonarQube server that you can reach.
- `SONAR_TOKEN`, set to a token of that server.

A script stops before its tests when one of these is missing. A scan that does not run fails the suite. Both scripts refuse `--no-sonar` outside GitHub Actions.

### Run a part of the tests

While you work, run only the tests of your change. To run one backend test file, name it:

```sh
cd backend
poetry run pytest tests/secrets/test_key_provider.py
```

To run one frontend test file, name it:

```sh
cd frontend
npx vitest run tests/lib/api.test.ts
```

To run one E2E spec, name its path relative to `tests/e2e/`. You can name more than one spec.

```sh
./scripts/e2e-targeted-local.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts
```

`./scripts/e2e-targeted-local.sh` runs the specs in one `wave-e2e` container, with its own backend and data. It starts the E2E services, and stops them when it ends. Set `WAVE_E2E_KEEP_STACK=1` to keep the services running between runs.

Never run the Playwright configs in `tests/e2e/` straight on the host, such as with `npx playwright test`. Their setup resets the data of the backend on port 8000. That is the port of your dev backend.

### Log files

Each script writes its whole output to a log file. Read the log file after a run, in place of running the suite again.

| Script | Log file |
|---|---|
| `./scripts/ci-backend-local.sh` | `/tmp/ci-backend.log` |
| `./scripts/ci-frontend-local.sh` | `/tmp/ci-frontend.log` |
| `./scripts/ci-playwright-local.sh` | `/tmp/ci-playwright.log`, and `/tmp/wave-e2e-artifacts/shard-<n>.log` for each container |
| `./scripts/e2e-targeted-local.sh` | `/tmp/ci-playwright-targeted.log`, and the backend log and traces in `/tmp/wave-e2e-targeted-artifacts/` |

## Code rules

[CLAUDE.md](CLAUDE.md) holds the code rules. They hold for every change, made by hand or by Claude.

## Write docs

The requirements, the solution description and the high-level design are in the WAVE docs repo, https://github.com/waveapphq/wave-docs, not in this repo.

| Doc | What it holds |
|---|---|
| `README.md` | What WAVE is, and how to install and start it. It is for users. |
| The requirements, in the docs repo | The requirements, each with an ID such as `REQ-4.3.2`. It is the source of truth. |
| The design, in the docs repo | The high-level design. A section carries the ID of the requirement it answers, such as `##### REQ-4.3.2 Test execution recovery`. |

The design follows the requirements, and the code follows the design. When the code does not match a requirement, the code is wrong. The design says what the system is. It holds no code, and no class, method or function names.

These rules hold for every doc that you write or change.

### Scope

- One fact lives in one doc. Other docs link to it.
- A doc says what is. It names a missing thing only where the reader would fail without it, and then says what to do instead.

### Language

- Use no em dash and no en dash. Use a plain hyphen.

### Sentences

- One idea per sentence, in 25 words or fewer.
- Write whole sentences. Leave out no word that the reader must guess: write "The same ID is also on line 41.", not "Also on line 41."
- Steps are commands: "Run", "Open", "Copy". Facts are in the present tense.
- Use plain words, for a reader whose first language may not be English. Use no metaphor and no word of your own: write "The check never runs", not "The guard became unreachable".
- Explain in terms the reader can see: what changes on the page, in a file, or in a command's output.
- Use no filler, such as "simply", "just", "easily", "note that" or "powerful".

### Words

- Give each thing one name, the name that the UI shows, and use it in every file.
- Put a label that the UI shows in single quotes: 'Save'. Put a command, key, path or value in backticks: `npm run lint`.
- Call the reader "you".

### Layout

- Write headings in sentence case.
- Use a table to look things up: three rows or more of one kind, with a header row. For fewer rows, write a list.
- Rows of one kind share one fixed format.
- Put a command in a sh code block, one command per line, so that it runs as written.

## Send a change

`master` holds the release with the highest version. The work for each release is on its release branch, which is named `release/` followed by the version, such as `release/1.0.0`. Each change is made on a branch of its own and goes into a release branch by a pull request. Only a finished release goes into `master`, by a pull request from its release branch.

Only collaborators can open pull requests. To become one, ask in an issue. A maintainer decides. To report a security bug, follow [SECURITY.md](SECURITY.md).

1. Find the issue of the change at https://github.com/waveapphq/wave/issues, or open one. A pull request covers one issue only. The issue says what the pull request covers, so the pull request can be of any size.
2. List the release branches of `waveapphq/wave`:

   ```sh
   git ls-remote origin 'refs/heads/release/*'
   ```

   Each line of the output ends with `refs/heads/release/` and a version, such as `refs/heads/release/1.0.0`. Most changes go into the release branch with the highest version. A fix to an older release goes into the release branch of its patch.

   If no release branch fits the change, ask in its issue which release the change is for. Go on to step 3 when the command lists the release branch.

3. From that release branch, make a branch for one change. `<version>` is the version of that release branch, and `<branch>` is the name of the new branch. Name a fix `fix/<version>-` followed by a short name, such as `fix/1.0.0-ssh-timeout`. Name any other change `feature/<version>-` followed by a short name, such as `feature/1.0.0-csv-export`. A `fix/` branch only fixes a bug of a released version, or of a change that is already merged. It holds nothing else.

   ```sh
   git fetch origin
   git switch -c <branch> --no-track origin/release/<version>
   ```

4. Install the packages that the release branch pins:

   ```sh
   cd backend
   poetry install
   cd ../frontend
   npm ci
   cd ../tests/e2e
   npm ci
   cd ../..
   ```

   If the release branch changes the backend packages, build the test images again, as [Build the test images](#build-the-test-images) says.

5. Make the change, with its tests and docs. Follow [Code rules](#code-rules) and [Write docs](#write-docs). You can also make small fixes in the code that the change already touches. List each of them in the description of the pull request. Open a new issue for anything else, and leave it out of the branch.

   If the change needs a docs change, make it in the docs repo. In your clone of the docs repo, make a branch with the same name as your WAVE branch, such as `feature/1.0.0-csv-export`, from the release branch of the same version:

   ```sh
   git fetch origin
   git switch -c <branch> --no-track origin/release/<version>
   ```

6. Run the three suites, one at a time:

   ```sh
   ./scripts/ci-backend-local.sh
   ./scripts/ci-frontend-local.sh
   ./scripts/ci-playwright-local.sh
   ```

   All three must pass on your machine, SonarQube included, before you ask for review. There is one exception: a suite that also fails on the release branch.

   If your change makes a suite fail, fix the code in your branch. Change a test only as the code rules in [CLAUDE.md](CLAUDE.md) allow. Never change the CI files to make a suite pass. These are the CI scripts `scripts/ci-*.sh` and the scripts they run, such as `scripts/run-coverage-backend.sh`, `scripts/run-e2e-shard.sh`, `scripts/check-orphaned-files.sh` and `scripts/check-text.sh`; the settings of the text checks in `typos.toml`; the SonarQube scripts `scripts/sonar-*.sh` and settings `backend/sonar-project.properties` and `frontend/sonar-project.properties`; and the GitHub workflows in `.github/workflows/` with `.github/CODEOWNERS`. A maintainer rejects a pull request that changes these files, unless fixing them is the purpose of its issue.

   A maintainer keeps all three suites passing on `master` and on each release branch. If a suite also fails on the release branch, do not fix it in your branch. Open an issue for it, and link that issue in the description of your pull request. A maintainer fixes it before any other work.

7. Push the branch:

   ```sh
   git push -u origin <branch>
   ```

8. Open `https://github.com/waveapphq/wave/compare/release/<version>...<branch>?expand=1`, and click 'Create pull request'. The page opens with `release/<version>` as the base branch. The page fills the description from a template. In it, link the issue of the change, such as with `Closes #123`.

9. If the change needs a docs change, push the docs branch with `git push -u origin <branch>`. Open `https://github.com/waveapphq/wave-docs/compare/release/<version>...<branch>?expand=1`, and click 'Create pull request'. The page opens with `release/<version>` as the base branch. Link that pull request in the description of your WAVE pull request. Use the full link, as the template shows. If the change needs no docs change, tick the box "No docs change needed" in the description.

A check blocks the merge of each pull request until it ticks "No docs change needed" or links a merged pull request of the docs repo with the same branch name. While the linked docs pull request is open, the check waits and the merge stays blocked. When the docs pull request is merged, re-run the check. The check fails when the description ticks no box and links no docs pull request, or when the linked docs pull request is on a branch with another name, was closed without a merge, or does not exist.

A pull request that changes a CI file needs the approval of the code owner that `.github/CODEOWNERS` names.

GitHub runs the backend and frontend checks and the SonarQube analysis on each pull request. It never runs the Playwright suite.

Only a maintainer merges, even when every check on a pull request is green. The maintainer reviews the pull request, then merges it into its release branch and deletes the branch.

A contribution needs no sign-off line and no contributor agreement, as [License](#license) says.

## Where each part is

| Folder | What it holds |
|---|---|
| `backend/wavecore/` | The backend, a Python package with a FastAPI server. |
| `backend/wavecore/api/` | The REST routes, the WebSocket, the middleware and the services behind them. |
| `backend/wavecore/connectivity/` | The clients for SQL databases, Kubernetes, Helm and OpenSearch, and the shared TLS and proxy code. |
| `backend/wavecore/controls/` | The controls, such as conditions, loops, waits and assertions. |
| `backend/wavecore/core/` | The execution engine: Blocks, runs, expressions, variables, Functions, parallel branches and secrets. |
| `backend/wavecore/logging/` | The logging of the backend. |
| `backend/wavecore/mcp/` | The MCP server that runs inside the backend. |
| `backend/wavecore/models/` | The data models. |
| `backend/wavecore/plugins/` | The plugins, one file each, such as HTTP, SSH, SQL, Kubernetes and Helm. |
| `backend/wavecore/storage/` | The file storage of tests, profiles and run history. |
| `backend/tests/` | The backend tests, which run with pytest. |
| `backend/config/` | The example config file, `config.example.yaml`, and its README. |
| `backend/vendor/` | `wheels.lock`, which pins the wheels that Remote Execution carries to a remote host. `./scripts/build-ci-image.sh` fetches them into `wheels/`. |
| `frontend/src/` | The frontend, a React app. |
| `frontend/src/app/` | The entry point, the routes and the page layouts. |
| `frontend/src/features/` | One folder for each area of the app, such as `workbench/`, `tests/` and `settings/`. |
| `frontend/src/components/` | The UI components that several areas share. |
| `frontend/src/design-system/` | The design tokens and the base components. |
| `frontend/src/hooks/` | The React hooks that several areas share. |
| `frontend/src/lib/` | Plain logic, with no React in it. |
| `frontend/src/services/` | The clients of the backend API. |
| `frontend/src/stores/` | The global Zustand stores. |
| `frontend/src/types/` | The shared TypeScript types. |
| `frontend/tests/` | The frontend tests, which run with Vitest. |
| `tests/e2e/` | The Playwright specs in `functional/` and `visual/`, their helpers, and the services in `services/` that the specs run against. |
| `scripts/` | The scripts that build the test images, run the suites and set the version. |
| `.github/` | The GitHub workflows, the pull request template and the code owners. |
| `LICENSES/` | The license texts of the third-party work that `NOTICE` lists. |

## License

WAVE is under the MIT License. [LICENSE](LICENSE) holds its text.

Contributions are licensed under the same MIT License. No sign-off line or contributor agreement is needed.
