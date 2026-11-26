"""Tests for scripts/e2e/e2e-shard-plan.mjs with a spec list, over a fake `playwright --list`."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.scripts.script_support import CLONE, Stubs

PLANNER = CLONE / "scripts" / "e2e" / "e2e-shard-plan.mjs"
EMPTY_DB = "empty-db-dark"

FUNCTIONAL = {"a.spec.ts": 30.0, "b.spec.ts": 20.0, "c.spec.ts": 10.0, "d.spec.ts": 5.0}
# Visual file -> (weight, {project: test count}).
VISUAL = {
    "dashboard/e1.spec.ts": (6.0, {EMPTY_DB: 2}),
    "dashboard/e2.spec.ts": (4.0, {EMPTY_DB: 1}),
    "dashboard/e3.spec.ts": (8.0, {EMPTY_DB: 3}),
    "lists/n1.spec.ts": (9.0, {"no-data-dark": 3}),
    "lists/n2.spec.ts": (7.0, {"fixture-dark": 2}),
}

# Prints the JSON list report for the functional config or for the visual projects.
FAKE_PLAYWRIGHT = """
functional = {functional!r}
visual = {visual!r}
if any(a.startswith("--config=playwright.functional.config.ts") for a in ARGS):
    specs = [
        {{"file": f, "tests": [{{"projectName": "functional-workflow"}}]}} for f in functional
    ]
else:
    specs = []
    for f, projects in visual.items():
        tests = [{{"projectName": p}} for p, n in projects.items() for _ in range(n)]
        specs.append({{"file": f, "tests": tests}})
print(json.dumps({{"suites": [{{"specs": specs, "suites": []}}]}}))
"""


@pytest.fixture
def e2e_dir(tmp_path: Path) -> Path:
    """A tests/e2e folder with a fake playwright binary and a weights file."""
    folder = tmp_path / "tests" / "e2e"
    stubs = Stubs(tmp_path / "stubs")
    binary = stubs.tool(
        "playwright",
        FAKE_PLAYWRIGHT.format(
            functional=list(FUNCTIONAL),
            visual={f: projects for f, (_w, projects) in VISUAL.items()},
        ),
    )
    target = folder / "node_modules" / ".bin" / "playwright"
    target.parent.mkdir(parents=True)
    shutil.copy2(binary, target)
    weights = {
        "functional": FUNCTIONAL,
        "visual": {f: w for f, (w, _projects) in VISUAL.items()},
    }
    (folder / "shard-weights.json").write_text(json.dumps(weights), encoding="utf-8")
    return folder


def plan(e2e_dir: Path, *args: str) -> subprocess.CompletedProcess[str]:
    node = shutil.which("node")
    assert node is not None, "node is not on PATH"
    log = str(e2e_dir.parents[1] / "stubs" / "calls.jsonl")
    return subprocess.run(
        [
            node,
            str(PLANNER),
            "--weights",
            str(e2e_dir / "shard-weights.json"),
            "--e2e-dir",
            str(e2e_dir),
            *args,
        ],
        cwd=e2e_dir,
        env={"PATH": f"{Path(node).parent}:/usr/bin:/bin", "STUB_LOG": log, "HOME": str(e2e_dir)},
        capture_output=True,
        text=True,
        timeout=40,
        check=False,
    )


def read_plan(folder: Path) -> dict[str, list[str]]:
    return {
        kind: (folder / f"plan-{kind}.txt").read_text(encoding="utf-8").split()
        for kind in ("functional", "visual", "empty-db")
    }


def all_shards(e2e_dir: Path, out: Path, shards: int, *extra: str) -> list[dict[str, list[str]]]:
    done = plan(e2e_dir, "--shards", str(shards), "--artifacts", str(out), *extra)
    assert done.returncode == 0, done.stderr
    return [read_plan(out / f"shard-{k}") for k in range(1, shards + 1)]


def union(bins: list[dict[str, list[str]]], kind: str) -> list[str]:
    return sorted(f for b in bins for f in b[kind])


SPECS = ",".join(
    [
        "functional/a.spec.ts",
        "functional/c.spec.ts",
        "visual/dashboard/e1.spec.ts",
        "visual/dashboard/e2.spec.ts",
        "visual/lists/n1.spec.ts",
    ]
)


class TestWithoutList:
    """Without --specs every listed file is planned."""

    def test_every_file_is_planned(self, e2e_dir: Path, tmp_path: Path) -> None:
        bins = all_shards(e2e_dir, tmp_path / "out", 3)

        assert union(bins, "functional") == sorted(FUNCTIONAL)
        assert union(bins, "visual") == ["lists/n1.spec.ts", "lists/n2.spec.ts"]
        owners = [b for b in bins if b["empty-db"]]
        assert len(owners) == 1
        assert sorted(owners[0]["empty-db"]) == [
            "dashboard/e1.spec.ts",
            "dashboard/e2.spec.ts",
            "dashboard/e3.spec.ts",
        ]


class TestWithList:
    """With --specs only the listed files are packed, with the same weights."""

    def test_only_the_listed_files_are_planned(self, e2e_dir: Path, tmp_path: Path) -> None:
        bins = all_shards(e2e_dir, tmp_path / "out", 3, "--specs", SPECS)

        assert union(bins, "functional") == ["a.spec.ts", "c.spec.ts"]
        assert union(bins, "visual") == ["lists/n1.spec.ts"]

    def test_listed_empty_db_files_go_together_onto_one_shard(
        self, e2e_dir: Path, tmp_path: Path
    ) -> None:
        bins = all_shards(e2e_dir, tmp_path / "out", 3, "--specs", SPECS)

        owners = [b for b in bins if b["empty-db"]]
        assert len(owners) == 1
        assert sorted(owners[0]["empty-db"]) == ["dashboard/e1.spec.ts", "dashboard/e2.spec.ts"]

    def test_a_list_with_no_empty_db_file_gives_no_shard_the_project(
        self, e2e_dir: Path, tmp_path: Path
    ) -> None:
        specs = "functional/b.spec.ts,visual/lists/n2.spec.ts"

        bins = all_shards(e2e_dir, tmp_path / "out", 2, "--specs", specs)

        assert union(bins, "functional") == ["b.spec.ts"]
        assert union(bins, "visual") == ["lists/n2.spec.ts"]
        assert union(bins, "empty-db") == []

    def test_each_file_lands_on_exactly_one_shard(self, e2e_dir: Path, tmp_path: Path) -> None:
        bins = all_shards(e2e_dir, tmp_path / "out", 2, "--specs", SPECS)

        functional = [f for b in bins for f in b["functional"]]
        visual = [f for b in bins for f in b["visual"]]
        assert len(functional) == len(set(functional)) == 2
        assert len(visual) == len(set(visual)) == 1

    def test_every_container_computes_the_same_bins(self, e2e_dir: Path, tmp_path: Path) -> None:
        shards = 3
        expected = all_shards(e2e_dir, tmp_path / "all", shards, "--specs", SPECS)

        for k in range(1, shards + 1):
            out = tmp_path / f"shard-{k}"
            done = plan(
                e2e_dir,
                "--shards",
                str(shards),
                "--shard-index",
                str(k),
                "--out-dir",
                str(out),
                "--specs",
                SPECS,
            )
            assert done.returncode == 0, done.stderr
            assert read_plan(out) == expected[k - 1]

    def test_one_listed_file_fills_one_shard(self, e2e_dir: Path, tmp_path: Path) -> None:
        bins = all_shards(e2e_dir, tmp_path / "out", 1, "--specs", "functional/d.spec.ts")

        assert bins == [{"functional": ["d.spec.ts"], "visual": [], "empty-db": []}]
