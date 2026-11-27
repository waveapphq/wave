# Contributing

This doc covers how to work on WAVE itself. It says how to set up a clone, build and check the code, run the tests and send a change. It also gives the rules for code and docs, what each folder of the clone holds, and the license of a contribution.

## Set up a clone

The gate scripts are tuned for Ubuntu 22.04 with its Podman 3.4, on an x86_64 machine with 16 cores, 24 GB of memory and 100 GB of free disk. This is a hard requirement.

You need these tools on your machine:

| What you need | What uses it |
|---|---|
| Python 3.12 or later | The backend. |
| Poetry 2 or later | The backend. Poetry installs its packages and runs its commands. |
| Node.js 22.13 or a later 22 release, or Node.js 24 or later | The frontend. |
| Podman 3.4, the version that Ubuntu 22.04 ships | The gate scripts 04 to 09 and 15, which run in containers. |
| The `docker-compose` v2 binary, on your `PATH` | `scripts/e2e/e2e-stack.sh`, which starts the services that the E2E specs run against. |
| `sonar-scanner`, on your `PATH`, and a SonarQube Cloud token in `SONAR_TOKEN` | The SonarQube scans, gates 10 and 11, as [The SonarQube step](#the-sonarqube-step) says. |
| The CodeQL CLI, `codeql`, on your `PATH` | The CodeQL scan, gate 12, as [The CodeQL check](#the-codeql-check) says. |
| `jq` | The test count at the end of `./scripts/gate/15-playwright.sh`. Without it, the count says 0. The result of the run does not change. |

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

The container checks of the gate run in Podman containers. Run these commands once, from the root of the clone, to build the images that they use:

```sh
./scripts/images/build-ci-image.sh
./scripts/images/build-e2e-image.sh
./scripts/e2e/e2e-stack.sh build
```

| Command | What it builds |
|---|---|
| `./scripts/images/build-ci-image.sh` | The image `wave-ci`, with Python, Poetry, Node.js and the backend packages in it. It also fetches the wheels that `backend/vendor/wheels.lock` pins into `backend/vendor/wheels/`, which the backend tests read. |
| `./scripts/images/build-e2e-image.sh` | The image `wave-e2e`, which is `wave-ci` with Chromium for Playwright. It needs `wave-ci`. |
| `./scripts/e2e/e2e-stack.sh build` | The images of the services that the E2E specs run against, such as SSH hosts, databases, Kubernetes API servers and an OpenSearch node. Building them accepts the vendor license terms in `tests/e2e/services/README.md`. |

Build `wave-ci` again when the backend packages change. When the frontend or E2E packages change, run `npm ci` in `frontend/` and `tests/e2e/`. Build `wave-e2e` again after each build of `wave-ci`, and when the version of Playwright changes. Run `./scripts/e2e/e2e-stack.sh build` again when a file in `tests/e2e/services/` or `tests/e2e/simulators/https/` changes, before the next E2E run, targeted or full.

`scripts/e2e/e2e-stack.sh` reaches Podman through the API socket of your user, at `$XDG_RUNTIME_DIR/podman/podman.sock`. Start that socket before you run an E2E spec.

```sh
systemctl --user enable --now podman.socket
```

## Build and check the code

Run each command in the folder that the table names. The gate scripts 02 to 07 run these checks, as [Run the tests](#run-the-tests) says.

| Folder | Command | What it does |
|---|---|---|
| `backend/` | `poetry run mypy wavecore/` | Checks the types of the backend code. |
| `backend/` | `poetry run black --check wavecore/ tests/` | Checks the format of the backend code and tests. `poetry run black wavecore/ tests/` fixes the format. |
| `backend/` | `poetry run ruff check wavecore/ tests/` | Lints the backend code and tests. |
| `frontend/` | `npm run type-check` | Checks the types of `frontend/src/` and `frontend/tests/`. |
| `frontend/` | `npm run lint` | Lints `frontend/src/` and `frontend/tests/` with ESLint. |
| `frontend/` | `npm run build` | Checks the types, then builds the frontend into `frontend/build/`. |
| `tests/e2e/` | `npm run type-check` | Checks the types of the E2E specs and helpers. |
| The root of the clone | `./scripts/gate/02-grammar.sh` | Runs the text checks, as [Run the tests](#run-the-tests) says. |

## Run the tests

The gate is every check a pull request must pass. Each check is a script in `scripts/gate/`, numbered in the order it runs, and each runs alone from the root of the clone. The runner runs the scripts your change needs, in number order, and stops at the first failure:

```sh
./scripts/gate/run.sh
```

With no area, it reads the files your branch changes against its release branch (`master` for any other branch), with your uncommitted and untracked files. Name areas to pick the scripts instead: `backend`, `frontend`, `e2e` and `scripts`. Playwright runs only when you ask for it, after every other script, with a spec list or the full suite:

```sh
./scripts/gate/run.sh backend frontend
./scripts/gate/run.sh --playwright full
```

| Script | What it checks | Runs when |
|---|---|---|
| `01-branch-name.sh` | The branch name, as step 3 of [Send a change](#send-a-change) says. | Always. |
| `02-grammar.sh` | The text checks. | A text file changed. |
| `03-orphans.sh` | Frontend files that no other file imports, and each exclusion ID comment against its list. | `frontend/src/`, `backend/wavecore/` or `tests/exclusions/` changed. |
| `04-backend-static.sh` | In a `wave-ci` container: mypy over `backend/wavecore/`, `black --check` and ruff over `backend/wavecore/` and `backend/tests/`. | `backend/` changed. |
| `05-frontend-static.sh` | In a `wave-ci` container: ESLint over `frontend/src/` and `frontend/tests/`, and the frontend type check. | `frontend/` changed. |
| `06-e2e-types.sh` | In a `wave-ci` container: the E2E type check. | `tests/e2e/` changed. |
| `07-frontend-build.sh` | In a `wave-ci` container: the frontend build. | `frontend/` changed. |
| `08-backend-tests.sh` | In a `wave-ci` container: every backend test with pytest, which fails below 100% coverage. | `backend/` or `scripts/` changed. |
| `09-frontend-tests.sh` | In a `wave-ci` container: every frontend test with Vitest, which fails below 100% coverage of lines, branches and statements, or 96% of functions. | `frontend/` changed. |
| `10-sonar-backend.sh` | The SonarQube scan of the backend. | `backend/` changed. |
| `11-sonar-frontend.sh` | The SonarQube scan of the frontend. | `frontend/` changed. |
| `12-codeql.sh` | CodeQL code scanning of the languages your branch changes. | Python, TypeScript, JavaScript or a workflow changed. |
| `13-sonar-exclusions.sh` | SonarQube Cloud's false positive marks against their entries. | 10 or 11 ran. |
| `14-codeql-exclusions.sh` | GitHub's dismissed CodeQL alerts against their entries. | 12 ran. |
| `15-playwright.sh` | On the host: the frontend build and the E2E services. In up to 8 `wave-e2e` containers: the specs you name, or every Playwright spec with `full`, split between the containers. Each container has its own backend, frontend and data. | You give `--playwright`. |

Each script prints one result line, such as `08 Backend tests: passed` or `08 Backend tests: failed (<reason>)`, and exits with 0 when it passes, 1 when it fails and 2 when it cannot run, such as without its container image. Run alone, a container check starts its own `wave-ci` container; the runner runs them all in one. Gates 04 and 05 run each of their tools, even after one fails, and the reason names each tool that failed. The runner ends with a table of every gate script and its result, `skipped: not needed` for a script your change does not need.

The frontend tests fail below 100% coverage of lines, branches and statements, or below 96% of functions. They also fail when a test writes anything to stderr.

While the tests run, gate 08 prints a line such as `Progress: 40%` each time pytest's percentage changes, and gates 09 and 15 print one once a minute. The Playwright line gives each container its own share, such as `Progress: shard 1/8 40%, shard 2/8 35%`. Set `WAVE_CI_PROGRESS_SECONDS` to print the line at another interval, in seconds. Gate 09 also prints each failed test, with its file and its error, as soon as it fails, and ends with the line `Tests: <passed> passed, <failed> failed, <skipped> skipped (<files> files)`.

The text checks fail on spelling that `typos.toml` does not allow, on an em or en dash in any text file that `.gitignore` does not exclude, and on a reference to a roadmap, a phase, a session or a ticket in a source comment, a Python docstring or a line of a `/* */` comment. They never fail on `REQ-*`, design IDs or `COV-*`. `poetry install` in `backend/` installs `typos`, the tool of the first check, at the version that `backend/poetry.lock` pins. Its settings are in `typos.toml`. Fix each line that the checks list.

### The SonarQube step

Gates 10 and 11 run the SonarQube scan of the backend and the frontend, wait for its quality gate and print the results of the scan. GitHub runs them on each pull request too. Run them after gates 08 and 09, which write the coverage the scan reads:

```sh
./scripts/gate/10-sonar-backend.sh
./scripts/gate/11-sonar-frontend.sh
```

The scan goes to SonarQube Cloud, to the project `waveapphq_wave-backend` or `waveapphq_wave-frontend` of the organization `waveapphq`. It needs these on the host:

- `sonar-scanner`, on your `PATH`.
- `SONAR_TOKEN`, set to a token of your SonarQube Cloud account. The account needs scan rights on the two projects. A maintainer grants them together with collaborator access.
- A checked-out branch. SonarQube Cloud analyzes a local scan as your current branch, and compares a fix/ or feature/ branch with its release branch.
- Your work on the project committed, because the scan of a branch counts only the files its commits change.

The scan stops when one of these is missing. To scan on another SonarQube server, set `SONAR_URL` to its address and `SONAR_TOKEN` to a token of that server.

The check fails on a failed condition of the quality gate, on an issue or a security hotspot on a line your branch changed, and on `NOT PROVEN`, when the scan counted no line of the code your branch changed (exit 3). On a fix or feature branch, changed lines count from its release branch; on master or a release branch, from that branch on origin. A coverage condition counts only once the coverage of gate 08 or 09 is on disk.

### The CodeQL check

GitHub runs CodeQL code scanning on each pull request. `./scripts/gate/12-codeql.sh` runs the same checks on the host, for the languages your branch changes. It scans the files your push would carry and compares them with the branch your pull request goes into, and fails on every alert that branch does not have. It lists each such alert with its file and line; `--flows` also shows the path from the input to the problem. With `--all` it lists every alert in your files, fails when there is one, and does not scan the other branch. Name `python`, `javascript-typescript` or `actions` to scan those languages. It needs these on the host:

- The CodeQL CLI bundle from the `github/codeql-action` releases, with `codeql` on your `PATH`, or `CODEQL` set to its path.
- Room for its work files while a scan runs, several GB, by default in `~/.cache/wave-codeql`. Set `CODEQL_WORK_DIR` to put them on another disk.
- A checked-out branch. A `fix/<version>-<name>` or `feature/<version>-<name>` branch is compared with `release/<version>`, any other branch with `master`. Set `CODEQL_BASE` to compare with another branch.

A maintainer dismisses a false alarm on GitHub. With `CODEQL_GITHUB_TOKEN` set to a token that can read code scanning alerts, the scan leaves out the alerts dismissed for your branch or its pull request; without it, the scan lists them too. With the token, the scan also takes the other branch's results from GitHub's own scan of it, and scans that branch on your machine only when GitHub has no scan of that commit.

### The license check

`python3 scripts/audit/check-licenses.py` checks the license of every dependency that WAVE ships: the backend runtime packages, the frontend runtime packages and the remote host wheels. It runs on its own, once per release, and no CI runs it. Run it from the root of the clone, after `poetry install` in `backend/` and `./scripts/lib/fetch-remote-wheels.sh`.

It compares each package with its entry in `scripts/audit/dependency-licenses.json`, the approved list. It fails on a package that has no entry, on a license that differs from its entry, and on a GPL or AGPL license. It also fails when a dependency comes from git, a path, a URL or a file, when the clone holds a `patches/` folder outside `tests/e2e/services/`, and when a wheel in `backend/vendor/wheels/` is not in `wheels.lock` or does not match its sha256.

It prints one line for each problem, then `License check failed:` and the count, and exits with 1. When all is well, it prints `License check passed:` and the number of packages, and exits with 0.

To approve a new package, read its license files, and add its entry to the list with its ecosystem (`pypi`, `npm` or `wheel`), in ecosystem and name order. An entry holds the license as an SPDX expression and a one-line reason. List each bundled library or file under another license in `bundled`.

### The vulnerability audit

`python3 scripts/audit/audit-dependencies.py` looks up the known vulnerabilities of the backend, frontend and E2E packages and the remote host wheels. It runs on its own, and no CI runs it. Run it from the root of the clone, after `poetry install` in `backend/`. It installs pip-audit in a temporary folder; set `WAVE_PIP_AUDIT` to the path of a pip-audit you have, to use that one.

It prints one line for each group, such as `frontend runtime: 0 critical, 1 high, 0 moderate, 0 low, 0 unknown`, then one line for each advisory, with the package, its version, the advisory ID, the severity and the version that fixes it.

| Exit code | Meaning |
|---|---|
| 0 | No known vulnerability. |
| 1 | At least one advisory. The last line gives the number of advisories and packages. |
| 2 | pip-audit or npm audit could not be reached. The last line gives the error. |

### Skipped checks

Every check that WAVE skips is listed in public with its reason in [tests/exclusions/README.md](tests/exclusions/README.md): code left out of coverage, SonarQube Cloud false positives and dismissed CodeQL alerts.

Fix the code first. When your change needs an exclusion, add its entry to the right list and its ID in a comment at the spot, in the same pull request, and say why in the pull request description. A maintainer reviews the reason, then marks the issue or dismisses the alert in SonarQube Cloud or CodeQL.

Gate 03 checks that each ID comment in the code has its entry. Gates 13 and 14, SonarQube exclusions and CodeQL exclusions, fail when a mark or a dismissal does not match its entry. Each failure line says what to add or change. Run gate 13 after gates 10 and 11 with `./scripts/gate/13-sonar-exclusions.sh`, and gate 14 after CodeQL (gate 12, or GitHub's CodeQL on the pushed commit) with `./scripts/gate/14-codeql-exclusions.sh`.

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
./scripts/e2e/e2e-targeted-local.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts
```

`./scripts/e2e/e2e-targeted-local.sh` runs the specs in one `wave-e2e` container, with its own backend and data. It starts the E2E services, and stops them when it ends. Set `WAVE_E2E_KEEP_STACK=1` to keep the services running between runs.

To run many specs faster, name them to `./scripts/gate/15-playwright.sh`. It splits them between up to 8 containers, one spec or more each:

```sh
./scripts/gate/15-playwright.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts visual/dashboard/v-dash-01.spec.ts
```

`./scripts/gate/15-playwright.sh full` runs every spec. It checks every listed path before it starts or deletes anything. A path that does not exist stops the run with `Spec not found:` and the path, and the last run's artifacts stay. So does a file that neither Playwright config picks up, with `Not in any Playwright config:` and the path.

Never run the Playwright configs in `tests/e2e/` straight on the host, such as with `npx playwright test`. Their setup resets the data of the backend on port 8000. That is the port of your dev backend.

### Log files

Each gate script writes its whole output to a log file in `ci-output/`, at the root of the clone, which git ignores. The log is named after the script, such as `ci-output/08-backend-tests.log` for `./scripts/gate/08-backend-tests.sh`. Each script prints the full path of its log file as `Log:` at its start and its end. Read the log file after a run, in place of running the check again.

| Script | Other files |
|---|---|
| `./scripts/gate/15-playwright.sh` | `ci-output/e2e-artifacts/shard-<n>.log` for each container, with its reports and traces in `ci-output/e2e-artifacts/shard-<n>/` |
| `./scripts/e2e/e2e-targeted-local.sh` | Its log `ci-output/ci-playwright-targeted.log`, and the backend log and traces in `ci-output/e2e-targeted-artifacts/` |

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

3. From that release branch, make a branch for one change. `<version>` is the version of that release branch, and `<branch>` is the name of the new branch. Name a bug fix or a cleanup `fix/<version>-` followed by a short name, such as `fix/1.0.0-ssh-timeout`. Name a feature or an enhancement `feature/<version>-` followed by a short name, such as `feature/1.0.0-csv-export`. The short name has only lowercase letters, digits and single hyphens. Gate 01 enforces these names, on your machine and on each pull request. A `fix/` branch holds bug fixes and cleanup only; a change that adds behavior goes on a `feature/` branch.

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

6. Run the gate, with the full Playwright suite:

   ```sh
   ./scripts/gate/run.sh --playwright full
   ```

   Every script your change needs must pass on your machine before you ask for review. There is one exception: a check that also fails on the release branch.

   If your change makes a check fail, fix the code in your branch. Change a test only as the code rules in [CLAUDE.md](CLAUDE.md) allow. Never change the CI files to make a check pass. These are the gate scripts in `scripts/gate/` and the scripts they run in `scripts/lib/`, `scripts/report/`, `scripts/e2e/` and `scripts/images/`; the settings of the text checks in `typos.toml`; the SonarQube settings `backend/sonar-project.properties` and `frontend/sonar-project.properties`; and the GitHub workflows in `.github/workflows/`, the scripts they load in `.github/scripts/` and `.github/CODEOWNERS`. A maintainer rejects a pull request that changes these files, unless fixing them is the purpose of its issue.

   A maintainer keeps the gate passing on `master` and on each release branch. If a check also fails on the release branch, do not fix it in your branch. Open an issue for it, and link that issue in the description of your pull request. A maintainer fixes it before any other work.

7. Push the branch:

   ```sh
   git push -u origin <branch>
   ```

8. Open `https://github.com/waveapphq/wave/compare/release/<version>...<branch>?expand=1`, and click 'Create pull request'. The page opens with `release/<version>` as the base branch. The page fills the description from a template. In it, link the issue of the change, such as with `Closes #123`.

9. If the change needs a docs change, push the docs branch with `git push -u origin <branch>`. Open `https://github.com/waveapphq/wave-docs/compare/release/<version>...<branch>?expand=1`, and click 'Create pull request'. The page opens with `release/<version>` as the base branch. In the description of your WAVE pull request, tick the box "Docs pull request link:" and put the full link of that pull request after it, in place of the template's `NUMBER` link. If the change needs no docs change, tick the box "No docs change needed" in the description. The check reads only these two lines of the template; a docs link anywhere else counts for nothing.

A check blocks the merge of each pull request until it ticks "No docs change needed" or ticks the docs link line with a merged pull request of the docs repo with the same branch name. While the linked docs pull request is open, the check waits and the merge stays blocked. When the docs pull request is merged, re-run the check. The check fails when the description ticks no box, or when the linked docs pull request is on a branch with another name, was closed without a merge, or does not exist. The check is `.github/scripts/docs-check.cjs`, run by `.github/workflows/docs-check.yml`.

A pull request that changes a CI file needs the approval of the code owner that `.github/CODEOWNERS` names.

GitHub runs the gate on each pull request, each script as the job of the same name, such as `08 Backend tests`, and skips a job your change does not need. CodeQL code scanning runs as GitHub's own check in place of gate 12. GitHub never runs the Playwright suite.

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
| `backend/wavecore/storage/` | The loading of plugin definitions from the data folder. |
| `backend/tests/` | The backend tests, which run with pytest. |
| `backend/config/` | The example config file, `config.example.yaml`, and its README. |
| `backend/vendor/` | `wheels.lock`, which pins the wheels that Remote Execution carries to a remote host. `./scripts/images/build-ci-image.sh` fetches them into `wheels/`. |
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
| `tests/exclusions/` | The public lists of every check that WAVE skips, with the reason for each. |
| `scripts/` | The gate scripts in `scripts/gate/` and the scripts they run, and the scripts that build the test images, check the dependencies and set the version. |
| `.github/` | The GitHub workflows and the scripts they load, the pull request template and the code owners. |
| `LICENSES/` | The license texts of the third-party work that `NOTICE` lists. |

## License

WAVE is under the MIT License. [LICENSE](LICENSE) holds its text.

Contributions are licensed under the same MIT License. No sign-off line or contributor agreement is needed.
