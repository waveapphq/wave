"""No CI script or E2E infrastructure file names the host's shared temp folder."""

import pytest

from tests.scripts.script_support import CLONE, SHARED_TEMP, SHARED_TEMP_PATTERN

# The CI and E2E scripts, the three E2E config files and the five Containerfiles.
FILES = [
    "scripts/ci-checks-local.sh",
    "scripts/ci-backend-local.sh",
    "scripts/ci-frontend-local.sh",
    "scripts/ci-playwright-local.sh",
    "scripts/run-e2e-shard.sh",
    "scripts/e2e-targeted-local.sh",
    "scripts/generate-shard-weights.sh",
    "tests/e2e/playwright.config.ts",
    "tests/e2e/playwright.functional.config.ts",
    "tests/e2e/helpers/config.ts",
    "scripts/Containerfile",
    "scripts/Containerfile.e2e",
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
