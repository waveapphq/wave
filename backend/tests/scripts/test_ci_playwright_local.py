"""Tests for scripts/ci-playwright-local.sh with stub containers: spec list, shards, progress."""

import json
import re
import shutil
from pathlib import Path

import pytest

from tests.scripts.script_support import (
    Call,
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    log_lines,
    refuse_shared_temp,
    run,
    stub_env,
)

SCRIPT = "scripts/ci-playwright-local.sh"
PLANNER = "scripts/e2e-shard-plan.mjs"
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
    copy_from_clone(tree, SCRIPT)
    copy_from_clone(tree, PLANNER)
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
    tools.script(repo, "scripts/check-branch-name.sh", key="branch")
    tools.script(repo, "scripts/e2e-stack.sh")
    tools.script(repo, "scripts/run-e2e-shard.sh", RUN_SHARD)
    return tools


def playwright_ci(repo: Repo, stubs: Stubs, tmp_path: Path, *specs: str, **extra: str) -> Run:
    refuse_shared_temp(repo, SCRIPT, PLANNER)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / SCRIPT), *specs], env, timeout=50)


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
        assert stubs.calls("scripts/e2e-stack.sh") == []

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
        assert stubs.calls("scripts/e2e-stack.sh") == []

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
        assert stubs.calls("scripts/check-branch-name.sh") == []

    def test_the_full_run_does_not_run_it_either(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = playwright_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert stubs.calls("scripts/check-branch-name.sh") == []

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
    """The log and the artifacts go under ci-output/."""

    def test_the_log_path_is_printed_at_start_and_end(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        log = repo.root / "ci-output" / "ci-playwright.log"

        result = playwright_ci(repo, stubs, tmp_path, f"functional/{FUNCTIONAL[0]}")

        named = [i for i, line in enumerate(result.lines) if line == f"Log: {log}"]
        assert len(log_lines(result, log)) >= 2, result.lines
        assert named[0] < len(result.lines) // 2 < named[-1]
        assert log.is_file()

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
