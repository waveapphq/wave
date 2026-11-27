"""No CI or E2E file names the shared temp folder, turns shellcheck off or starts its own server."""

import re

import pytest

from tests.scripts.gate_support import GATES, RUNNER, gate_path
from tests.scripts.script_support import CLONE, SHARED_TEMP, SHARED_TEMP_PATTERN

# The CI scripts, E2E config files and Containerfiles.
FILES = [
    *[gate_path(number) for number in GATES],
    RUNNER,
    "scripts/e2e/run-e2e-shard.sh",
    "scripts/e2e/e2e-targeted-local.sh",
    "scripts/e2e/generate-shard-weights.sh",
    "tests/e2e/playwright.config.ts",
    "tests/e2e/playwright.functional.config.ts",
    "tests/e2e/helpers/config.ts",
    "scripts/images/Containerfile",
    "scripts/images/Containerfile.e2e",
    "tests/e2e/services/kwok/Containerfile",
    "tests/e2e/services/oci-registry/Containerfile",
    "tests/e2e/services/sshd/Containerfile",
]


@pytest.mark.parametrize("rel", FILES)
def test_the_file_names_no_shared_temp_path(rel: str) -> None:
    path = CLONE / rel
    assert path.is_file(), f"{rel} does not exist in the clone."

    hits = [
        f"{rel}:{number}: {line.strip()}"
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if SHARED_TEMP_PATTERN.search(line)
    ]

    assert hits == [], f"{rel} names {SHARED_TEMP}"


def test_the_log_folder_is_ignored_and_the_coverage_markers_are_gone() -> None:
    lines = (CLONE / ".gitignore").read_text(encoding="utf-8").splitlines()

    assert "ci-output/" in [line.strip() for line in lines]
    assert not any(".ci-be-coverage-ready" in line for line in lines)
    assert not any(".ci-fe-coverage-ready" in line for line in lines)


# A comment that turns a shellcheck warning off, such as `# shellcheck disable=SC2086`.
SHELLCHECK_SUPPRESSION = re.compile(r"#\s*shellcheck\s+disable\b")

SCRIPTS = sorted(
    path.relative_to(CLONE).as_posix()
    for path in (CLONE / "scripts").rglob("*")
    if path.is_file() and "__pycache__" not in path.parts
)


def test_the_scripts_folder_is_scanned() -> None:
    assert gate_path(15) in SCRIPTS


@pytest.mark.parametrize("rel", SCRIPTS)
def test_the_script_turns_no_shellcheck_warning_off(rel: str) -> None:
    text = (CLONE / rel).read_text(encoding="utf-8", errors="replace")

    hits = [
        f"{rel}:{number}: {line.strip()}"
        for number, line in enumerate(text.splitlines(), 1)
        if SHELLCHECK_SUPPRESSION.search(line)
    ]

    assert hits == [], f"{rel} turns a shellcheck warning off"


# The host-mode web server path: a vite preview of a per-stack build-<i> folder.
PLAYWRIGHT_CONFIGS = ["tests/e2e/playwright.config.ts", "tests/e2e/playwright.functional.config.ts"]
HOST_MODE_TEXTS = ["webServer", "build-", "vite preview"]


@pytest.mark.parametrize("text", HOST_MODE_TEXTS)
@pytest.mark.parametrize("rel", PLAYWRIGHT_CONFIGS)
def test_the_playwright_config_has_no_host_mode_web_server(rel: str, text: str) -> None:
    lines = (CLONE / rel).read_text(encoding="utf-8").splitlines()

    hits = [
        f"{rel}:{number}: {line.strip()}" for number, line in enumerate(lines, 1) if text in line
    ]

    assert hits == [], f"{rel} names {text}"
