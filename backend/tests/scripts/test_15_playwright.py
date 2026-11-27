"""Tests for scripts/gate/15-playwright.sh with stub containers: spec list, full run, shards."""

import json
import re
import shutil
from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    GateContract,
    GateRun,
    copy_gate,
    copy_ignores,
    gate_path,
    log_paths,
)
from tests.scripts.script_support import (
    NODE_BODY,
    PODMAN_BODY,
    Call,
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    file_lines,
    refuse_shared_temp,
    run,
    stub_env,
    terminated,
)

NUMBER = 15
SCRIPT = gate_path(NUMBER)
PLANNER = "scripts/e2e/e2e-shard-plan.mjs"
STACK = "scripts/e2e/e2e-stack.sh"
RUN_SHARD_SCRIPT = "scripts/e2e/run-e2e-shard.sh"
FULL = "full"
FUNCTIONAL = [f"area{n}/f{n}.spec.ts" for n in range(1, 11)]
VISUAL = {"dashboard/v-dash-01.spec.ts": "empty-db-dark", "lists/v-list-01.spec.ts": "fixture-dark"}

FAKE_PLAYWRIGHT = """
functional = {functional!r}
visual = {visual!r}
if any(a.startswith("--config=playwright.functional.config.ts") for a in ARGS):
    specs = [{{"file": f, "tests": [{{"projectName": "functional-workflow"}}]}} for f in functional]
else:
    specs = [{{"file": f, "tests": [{{"projectName": p}}]}} for f, p in visual.items()]
print(json.dumps({{"suites": [{{"specs": specs, "suites": []}}]}}))
"""

# A shard container's run: prints a little and takes a few seconds.
RUN_SHARD = """
print(f"[shard-{os.environ.get('SHARD_INDEX')}/{os.environ.get('SHARD_TOTAL')}] starting shard")
time.sleep(float(os.environ.get("STUB_SHARD_SECONDS", "0")))
sys.exit(1 if "shard-" + os.environ.get("SHARD_INDEX", "") in FAIL else 0)
"""


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    copy_from_clone(tree, PLANNER)
    copy_from_clone(tree, "scripts/e2e/e2e-shard-weights.mjs")
    tree.write("frontend/package.json", ['{"name": "frontend"}'])
    (tree.root / "frontend" / "node_modules").mkdir(parents=True)
    tree.write("tests/e2e/package.json", ['{"name": "e2e"}'])
    for rel in FUNCTIONAL:
        tree.write(f"tests/e2e/functional/{rel}", ["// a spec"])
    for rel in VISUAL:
        tree.write(f"tests/e2e/visual/{rel}", ["// a spec"])
    weights = {
        "functional": {rel: 10.0 + n for n, rel in enumerate(FUNCTIONAL)},
        "visual": {rel: 5.0 for rel in VISUAL},
    }
    tree.write("tests/e2e/shard-weights.json", [json.dumps(weights)])
    return tree


@pytest.fixture
def stubs(tmp_path: Path, repo: Repo) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.node_tools()
    playwright = tools.tool(
        "playwright", FAKE_PLAYWRIGHT.format(functional=FUNCTIONAL, visual=VISUAL)
    )
    target = repo.root / "tests" / "e2e" / "node_modules" / ".bin" / "playwright"
    target.parent.mkdir(parents=True)
    shutil.copy2(playwright, target)
    tools.script(repo, gate_path(1), key="branch")
    tools.script(repo, STACK)
    tools.script(repo, RUN_SHARD_SCRIPT, RUN_SHARD)
    return tools


def playwright_ci(repo: Repo, stubs: Stubs, tmp_path: Path, *specs: str, **extra: str) -> Run:
    refuse_shared_temp(repo, SCRIPT, PLANNER)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / SCRIPT), *specs], env, timeout=50)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(playwright_ci(repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}"), repo, stubs)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    specs = [f"functional/{FUNCTIONAL[0]}", f"functional/{FUNCTIONAL[1]}"]
    return GateRun(playwright_ci(repo, stubs, tmp_path, *specs, STUB_FAIL="shard-2"), repo, stubs)


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(playwright_ci(repo, stubs, tmp_path, BAD_OPTION), repo, stubs)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhatItRuns:
    """A spec list or the full suite by name; with neither it runs nothing."""

    def test_no_argument_is_a_usage_error(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = playwright_ci(repo, stubs, tmp_path)

        assert result.code == 2, result.lines
        assert container_runs(stubs) == []

    def test_full_runs_every_shard(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = playwright_ci(repo, stubs, tmp_path, FULL)

        assert result.code == 0, result.lines
        assert {env_value(c, "SHARD_TOTAL") for c in container_runs(stubs)} == {"8"}


def container_runs(stubs: Stubs) -> list[Call]:
    return [c for c in stubs.calls("podman") if c.args[:1] == ["run"]]


def env_value(call: Call, name: str) -> str | None:
    """The value a podman run call passes for one container variable."""
    for i, arg in enumerate(call.args):
        value = call.args[i + 1] if arg in ("-e", "--env") and i + 1 < len(call.args) else arg
        if value.startswith(f"{name}="):
            return value.split("=", 1)[1]
    return None


def volumes(call: Call) -> dict[str, str]:
    """Container path -> host path of each -v of a podman run call."""
    found = {}
    for i, arg in enumerate(call.args):
        if arg in ("-v", "--volume") and i + 1 < len(call.args):
            host, inside = call.args[i + 1].split(":")[:2]
            found[inside] = host
    return found


class TestSpecList:
    """Spec paths relative to tests/e2e are split across up to 8 shards."""

    def test_a_short_list_runs_one_shard_per_file(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        specs = [f"functional/{FUNCTIONAL[0]}", f"functional/{FUNCTIONAL[1]}"]
        specs.append("visual/dashboard/v-dash-01.spec.ts")

        result = playwright_ci(repo, stubs, tmp_path, *specs)

        assert result.code == 0, result.lines
        runs = container_runs(stubs)
        assert len(runs) == 3
        assert sorted(env_value(c, "SHARD_INDEX") or "" for c in runs) == ["1", "2", "3"]
        assert {env_value(c, "SHARD_TOTAL") for c in runs} == {"3"}

    def test_a_long_list_uses_at_most_8_shards(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        specs = [f"functional/{rel}" for rel in FUNCTIONAL]

        result = playwright_ci(repo, stubs, tmp_path, *specs)

        assert result.code == 0, result.lines
        runs = container_runs(stubs)
        assert len(runs) == 8
        assert {env_value(c, "SHARD_TOTAL") for c in runs} == {"8"}

    def test_one_spec_runs_one_shard(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = playwright_ci(repo, stubs, tmp_path, "visual/lists/v-list-01.spec.ts")

        assert result.code == 0, result.lines
        runs = container_runs(stubs)
        assert len(runs) == 1
        assert env_value(runs[0], "SHARD_TOTAL") == "1"

    @pytest.mark.parametrize(
        "specs",
        [
            ["functional/missing.spec.ts"],
            [f"functional/{FUNCTIONAL[0]}", "visual/dashboard/missing.spec.ts"],
            [f"functional/{FUNCTIONAL[0]}", "./functional/nowhere/x.spec.ts"],
        ],
        ids=["only", "second", "dot-slash"],
    )
    def test_a_missing_spec_stops_before_any_container(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, specs: list[str]
    ) -> None:
        result = playwright_ci(repo, stubs, tmp_path, *specs)

        assert result.code == 2, result.lines
        assert f"Spec not found: {specs[-1]}" in result.lines
        assert container_runs(stubs) == []
        assert stubs.calls(STACK) == []

    @pytest.mark.parametrize(
        ("specs", "unpicked"),
        [
            (["functional/orphan/o.spec.ts"], ["functional/orphan/o.spec.ts"]),
            (
                [f"functional/{FUNCTIONAL[0]}", "visual/lists/v-orphan.spec.ts"],
                ["visual/lists/v-orphan.spec.ts"],
            ),
            (
                ["./functional/orphan/o.spec.ts", f"functional/{FUNCTIONAL[1]}"],
                ["./functional/orphan/o.spec.ts"],
            ),
            (
                [
                    "visual/lists/v-orphan.spec.ts",
                    f"functional/{FUNCTIONAL[0]}",
                    "functional/orphan/o.spec.ts",
                ],
                ["visual/lists/v-orphan.spec.ts", "functional/orphan/o.spec.ts"],
            ),
            (["functional/area1/fixture.json"], ["functional/area1/fixture.json"]),
            (["helpers/config.ts"], ["helpers/config.ts"]),
        ],
        ids=["functional", "visual", "dot-slash", "two-in-order", "not-a-spec", "outside"],
    )
    def test_a_spec_no_config_picks_up_stops_before_any_container(
        self,
        repo: Repo,
        stubs: Stubs,
        tmp_path: Path,
        specs: list[str],
        unpicked: list[str],
    ) -> None:
        for rel in (
            "functional/orphan/o.spec.ts",
            "visual/lists/v-orphan.spec.ts",
            "functional/area1/fixture.json",
            "helpers/config.ts",
        ):
            repo.write(f"tests/e2e/{rel}", ["// not in any config"])

        result = playwright_ci(repo, stubs, tmp_path, *specs)

        assert result.code == 2, result.lines
        reported = [
            line for line in result.lines if line.startswith("Not in any Playwright config:")
        ]
        assert reported == [f"Not in any Playwright config: {spec}" for spec in unpicked]
        assert not [line for line in result.lines if line.startswith("Spec not found:")]
        assert container_runs(stubs) == []
        assert stubs.calls(STACK) == []

    def test_a_failed_shard_fails_the_run(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        specs = [f"functional/{FUNCTIONAL[0]}", f"functional/{FUNCTIONAL[1]}"]

        result = playwright_ci(repo, stubs, tmp_path, *specs, STUB_FAIL="shard-2")

        assert result.code == 1, result.lines


class TestNoBranchNameCheck:
    """The local Playwright CI runs no branch name check."""

    def test_the_branch_name_check_does_not_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = playwright_ci(repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}")

        assert result.code == 0, result.lines
        assert stubs.calls(gate_path(1)) == []

    def test_the_full_run_does_not_run_it_either(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = playwright_ci(repo, stubs, tmp_path, FULL)

        assert result.code == 0, result.lines
        assert stubs.calls(gate_path(1)) == []

    @pytest.mark.parametrize("branch", ["not-an-allowed-name", ""], ids=["bad-name", "detached"])
    def test_a_branch_name_the_check_refuses_does_not_stop_the_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, branch: str
    ) -> None:
        repo.commit()
        if branch:
            repo.checkout(branch)
        else:
            repo.detach()

        result = playwright_ci(
            repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}", STUB_FAIL="branch"
        )

        assert result.code == 0, result.lines
        assert len(container_runs(stubs)) == 1


class TestProgress:
    """One progress line with every shard's share."""

    def test_the_progress_line_names_every_shard(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        specs = [f"functional/{rel}" for rel in FUNCTIONAL[:3]]

        result = playwright_ci(
            repo, stubs, tmp_path, *specs, WAVE_CI_PROGRESS_SECONDS="1", STUB_SHARD_SECONDS="3"
        )

        assert result.code == 0, result.lines
        pattern = re.compile(
            r"^Progress: shard 1/3 (100|[1-9]?[0-9])%, shard 2/3 (100|[1-9]?[0-9])%,"
            r" shard 3/3 (100|[1-9]?[0-9])%$"
        )
        progress = [line for line in result.lines if line.startswith("Progress:")]
        assert progress, result.lines
        for line in progress:
            assert pattern.match(line), line


class TestLog:
    """The artifacts go under ci-output/."""

    def test_each_shard_writes_its_artifacts_under_ci_output(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        specs = [f"functional/{FUNCTIONAL[0]}", f"functional/{FUNCTIONAL[1]}"]

        playwright_ci(repo, stubs, tmp_path, *specs)

        artifacts = repo.root / "ci-output" / "e2e-artifacts"
        for call in container_runs(stubs):
            index = env_value(call, "SHARD_INDEX")
            mounted = {inside: Path(host) for inside, host in volumes(call).items()}
            assert artifacts / f"shard-{index}" in mounted.values(), call.args


# A green run with progress lines, one stopped inside the default interval, and a red run.
STOP_CASES = [
    {"WAVE_CI_PROGRESS_SECONDS": "1", "STUB_SHARD_SECONDS": "2"},
    {"STUB_SHARD_SECONDS": "1"},
    {"WAVE_CI_PROGRESS_SECONDS": "1", "STUB_SHARD_SECONDS": "2", "STUB_FAIL": "shard-1"},
]
STOP_IDS = ["progress-lines", "default-interval", "failing-shard"]
# The shell reports a killed job only when it reaps it in time, so one run can miss the line.
STOP_RUNS = 3


class TestProgressLoopStops:
    """Stopping the progress loop prints no shell job report such as a bare Terminated line."""

    @pytest.mark.parametrize("extra", STOP_CASES, ids=STOP_IDS)
    def test_no_terminated_line_is_printed_or_logged(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, extra: dict[str, str]
    ) -> None:
        reported = []
        for _ in range(STOP_RUNS):
            result = playwright_ci(repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}", **extra)
            paths = log_paths(result)
            logged = file_lines(Path(paths[0])) if paths else []
            reported += terminated(result.lines + logged)

        assert reported == []


# The last run's artifacts, relative to ci-output/e2e-artifacts/, with their contents.
LAST_RUN = {
    "steps.log": "Vite build (shared)              12s",
    "shard-1.log": "[1/3] a test of the last run",
    "shard-1/functional-report.json": '{"stats": {"expected": 3}}',
    "shard-2/visual-results/v-dash-01.png": "not really a picture",
}


def seed_last_run(repo: Repo) -> Path:
    artifacts = repo.root / "ci-output" / "e2e-artifacts"
    for rel, text in LAST_RUN.items():
        repo.write(f"ci-output/e2e-artifacts/{rel}", [text])
    return artifacts


def artifact_files(artifacts: Path) -> dict[str, str]:
    """Every file under the artifacts folder, by its relative path, with its contents."""
    return {
        path.relative_to(artifacts).as_posix(): path.read_text(encoding="utf-8").rstrip("\n")
        for path in sorted(artifacts.rglob("*"))
        if path.is_file()
    }


class TestABadSpecListKeepsTheLastRun:
    """Every listed spec is checked before anything is deleted, so the last run's artifacts stay."""

    @pytest.mark.parametrize(
        "specs",
        [
            ["functional/missing.spec.ts"],
            [f"functional/{FUNCTIONAL[0]}", "visual/dashboard/missing.spec.ts"],
            [f"functional/{FUNCTIONAL[0]}", "./functional/nowhere/x.spec.ts"],
        ],
        ids=["only", "second", "dot-slash"],
    )
    def test_a_missing_spec_leaves_the_artifacts_untouched(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, specs: list[str]
    ) -> None:
        artifacts = seed_last_run(repo)

        playwright_ci(repo, stubs, tmp_path, *specs)

        assert artifact_files(artifacts) == LAST_RUN

    @pytest.mark.parametrize(
        "specs",
        [
            ["functional/orphan/o.spec.ts"],
            [f"functional/{FUNCTIONAL[0]}", "visual/lists/v-orphan.spec.ts"],
            ["./functional/orphan/o.spec.ts", f"functional/{FUNCTIONAL[1]}"],
            ["helpers/config.ts"],
        ],
        ids=["functional", "visual", "dot-slash", "outside"],
    )
    def test_a_spec_no_config_picks_up_leaves_the_artifacts_untouched(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, specs: list[str]
    ) -> None:
        for rel in ("functional/orphan/o.spec.ts", "visual/lists/v-orphan.spec.ts"):
            repo.write(f"tests/e2e/{rel}", ["// not in any config"])
        repo.write("tests/e2e/helpers/config.ts", ["// not a spec"])
        artifacts = seed_last_run(repo)

        playwright_ci(repo, stubs, tmp_path, *specs)

        assert artifact_files(artifacts) == LAST_RUN

    def test_a_missing_spec_and_one_no_config_picks_up_keep_the_artifacts_too(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        repo.write("tests/e2e/functional/orphan/o.spec.ts", ["// not in any config"])
        artifacts = seed_last_run(repo)

        playwright_ci(
            repo, stubs, tmp_path, "functional/orphan/o.spec.ts", "functional/missing.spec.ts"
        )

        assert artifact_files(artifacts) == LAST_RUN

    def test_a_missing_spec_still_stops_with_exit_2(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        seed_last_run(repo)

        result = playwright_ci(repo, stubs, tmp_path, "functional/missing.spec.ts")

        assert result.code == 2, result.lines

    def test_a_spec_no_config_picks_up_still_stops_with_exit_2(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        repo.write("tests/e2e/functional/orphan/o.spec.ts", ["// not in any config"])
        seed_last_run(repo)

        result = playwright_ci(repo, stubs, tmp_path, "functional/orphan/o.spec.ts")

        assert result.code == 2, result.lines

    @pytest.mark.parametrize(
        "specs", [[f"functional/{FUNCTIONAL[0]}"], [FULL]], ids=["list", "full"]
    )
    def test_a_good_run_replaces_the_last_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, specs: list[str]
    ) -> None:
        artifacts = seed_last_run(repo)

        playwright_ci(repo, stubs, tmp_path, *specs)

        assert not set(LAST_RUN.items()) & set(artifact_files(artifacts).items())


# podman whose `ps` lists the leftover shard containers that STUB_LEFTOVER names, comma separated.
PODMAN_WITH_LEFTOVERS = (
    """
if ARGS[:1] == ["ps"] and os.environ.get("STUB_LEFTOVER"):
    print("\\n".join(os.environ["STUB_LEFTOVER"].split(",")))
    sys.exit(0)
"""
    + PODMAN_BODY
)


class TestLeftoverContainers:
    """Every leftover shard container is removed, each id its own argument."""

    @pytest.mark.parametrize(
        "ids",
        [["0a1b2c3d4e5f"], ["0a1b2c3d4e5f", "9f8e7d6c5b4a"], ["aaa111", "bbb222", "ccc333"]],
        ids=["one", "two", "three"],
    )
    def test_each_leftover_container_is_removed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, ids: list[str]
    ) -> None:
        stubs.tool("podman", PODMAN_WITH_LEFTOVERS)

        playwright_ci(
            repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}", STUB_LEFTOVER=",".join(ids)
        )

        removals = [c.args for c in stubs.calls("podman") if c.args[:1] == ["rm"]]
        assert removals, stubs.calls("podman")
        for args in removals:
            assert args == ["rm", "-f", *ids]


# npm: `npm ci` in tests/e2e installs the Playwright CLI, as the real install does.
NPM_INSTALLS = """
if ARGS == ["ci"] and os.getcwd().rstrip("/").endswith(os.path.join("tests", "e2e")):
    target = os.path.join(os.getcwd(), "node_modules", ".bin", "playwright")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(os.environ["STUB_PLAYWRIGHT"], target)
sys.exit(0)
"""

# npx: with no local package there is no Playwright to run; every other call works as usual.
NPX_FINDS_NOTHING = (
    """
if ARGS[:1] == ["playwright"]:
    sys.exit(1)
"""
    + NODE_BODY
)


@pytest.fixture
def no_e2e_packages(repo: Repo, stubs: Stubs) -> Path:
    """The E2E packages are not installed; npm ci installs the Playwright CLI."""
    shutil.rmtree(repo.root / "tests" / "e2e" / "node_modules")
    fake = stubs.bin.parent / "fake-playwright"
    stubs.file(fake, "playwright", FAKE_PLAYWRIGHT.format(functional=FUNCTIONAL, visual=VISUAL))
    stubs.tool("npm", "import shutil\n" + NPM_INSTALLS)
    stubs.tool("npx", NPX_FINDS_NOTHING)
    return fake


def test_a_clone_without_e2e_packages_installs_them_before_the_plan(
    repo: Repo, stubs: Stubs, tmp_path: Path, no_e2e_packages: Path
) -> None:
    env = stub_env(tmp_path, stubs, STUB_PLAYWRIGHT=str(no_e2e_packages))

    result = run(repo, [str(repo.root / SCRIPT), f"functional/{FUNCTIONAL[0]}"], env, timeout=50)

    installs = [c for c in stubs.calls("npm") if c.args == ["ci"] and c.cwd.endswith("tests/e2e")]
    assert installs, result.lines
    assert result.code == 0, result.lines
    assert "15 Playwright: passed" in result.lines
