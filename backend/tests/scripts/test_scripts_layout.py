"""The folders under scripts/: each file in its folder, and no old path left in the clone."""

import fnmatch
import re
import subprocess
from pathlib import Path

import pytest

from tests.scripts.gate_support import GATES
from tests.scripts.script_support import CLONE

SCRIPTS = CLONE / "scripts"

LAYOUT = {
    "gate": [file for file, _ in GATES.values()] + ["run.sh"],
    "report": ["sonar-results-backend.sh", "sonar-results-frontend.sh"],
    "audit": ["check-licenses.py", "dependency-licenses.json", "audit-dependencies.py"],
    "e2e": [
        "e2e-stack.sh",
        "e2e-targeted-local.sh",
        "run-e2e-shard.sh",
        "e2e-shard-plan.mjs",
        "e2e-shard-weights.mjs",
        "generate-shard-weights.sh",
        "e2e-config-with-key.sh",
    ],
    "images": ["Containerfile", "Containerfile.e2e", "build-ci-image.sh", "build-e2e-image.sh"],
    "lib": [
        "run-coverage-backend.sh",
        "fetch-remote-wheels.sh",
        "sonar-env.sh",
        "check-exclusions.py",
    ],
    "release": ["update-version.sh"],
    "dev": ["opensearch-api-spec-extract.mjs"],
}
OWNED_FOLDERS = ["gate", "lib", "report", "e2e", "images"]

# Scripts whose work a gate script took over under another name. Built at run time, so this
# file names none of them.
RETIRED = [
    "check-" + "branch-name.sh",
    "check-" + "text.sh",
    "check-" + "orphaned-files.sh",
    "ci-" + "checks-local.sh",
    "ci-" + "backend-local.sh",
    "ci-" + "frontend-local.sh",
    "ci-" + "playwright-local.sh",
    "codeql-" + "scan.sh",
    "sonar-" + "scan-backend.sh",
    "sonar-" + "scan-frontend.sh",
]
MOVED = [name for folder, names in LAYOUT.items() if folder != "gate" for name in names]


def entries(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir() if p.name != "__pycache__")


def clone_files() -> list[str]:
    """Every tracked or new file of the clone that .gitignore does not exclude."""
    done = subprocess.run(
        ["git", "-C", str(CLONE), "ls-files", "-co", "--exclude-standard", "-z"],
        capture_output=True,
        text=True,
        check=True,
    )
    return sorted(rel for rel in done.stdout.split("\0") if rel and (CLONE / rel).is_file())


def text_of(rel: str) -> str:
    data = (CLONE / rel).read_bytes()
    return "" if b"\0" in data else data.decode("utf-8", errors="replace")


FILES = clone_files()


def files_naming(pattern: re.Pattern[str]) -> list[str]:
    return [rel for rel in FILES if pattern.search(text_of(rel))]


class TestFolders:
    """scripts/ holds only its eight folders, each with exactly its files."""

    def test_scripts_holds_only_the_folders(self) -> None:
        assert entries(SCRIPTS) == sorted(LAYOUT)

    @pytest.mark.parametrize("folder", sorted(LAYOUT))
    def test_the_folder_holds_its_files(self, folder: str) -> None:
        path = SCRIPTS / folder
        assert path.is_dir(), f"scripts/{folder}/ does not exist in the clone."

        assert entries(path) == sorted(LAYOUT[folder])

    def test_no_script_is_a_link(self) -> None:
        links = [p.relative_to(CLONE).as_posix() for p in SCRIPTS.rglob("*") if p.is_symlink()]

        assert links == []

    def test_the_python_cache_folder_is_ignored(self) -> None:
        done = subprocess.run(
            ["git", "-C", str(CLONE), "check-ignore", "-q", "scripts/__pycache__/tool.pyc"],
            capture_output=True,
            check=False,
        )

        assert done.returncode == 0


class TestNoOldPath:
    """No file of the clone names a script by a path that no longer exists."""

    @pytest.mark.parametrize("name", RETIRED)
    def test_no_file_names_a_retired_script(self, name: str) -> None:
        assert files_naming(re.compile(re.escape(name))) == []

    @pytest.mark.parametrize("name", MOVED)
    def test_no_file_names_the_old_path_of_a_moved_file(self, name: str) -> None:
        old = re.compile(r"(?<![\w/.-])scripts/" + re.escape(name) + r"\b")

        assert files_naming(old) == []

    @pytest.mark.parametrize("name", RETIRED)
    def test_no_retired_script_is_left(self, name: str) -> None:
        assert list(SCRIPTS.rglob(name)) == []


def owned(rel: str, patterns: list[str]) -> bool:
    """Whether a CODEOWNERS pattern covers a path."""
    for pattern in patterns:
        bare = pattern.lstrip("/")
        if bare.endswith("/") and rel.startswith(bare):
            return True
        if fnmatch.fnmatchcase(rel, bare):
            return True
    return False


def owner_patterns() -> list[str]:
    lines = (CLONE / ".github" / "CODEOWNERS").read_text(encoding="utf-8").splitlines()
    return [line.split()[0] for line in lines if line.strip() and not line.startswith("#")]


class TestCodeOwners:
    """Every gate, lib, report, e2e and images file and .github/scripts/ has its code owner."""

    @pytest.mark.parametrize(
        "rel",
        [f"scripts/{folder}/{name}" for folder in OWNED_FOLDERS for name in LAYOUT[folder]],
    )
    def test_the_file_has_a_code_owner(self, rel: str) -> None:
        assert owned(rel, owner_patterns()), rel

    def test_the_workflow_scripts_have_a_code_owner(self) -> None:
        assert owned(".github/scripts/docs-check.cjs", owner_patterns())
