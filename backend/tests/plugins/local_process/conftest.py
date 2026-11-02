"""Keeps the coverage runner's variables out of the environments these tests spawn."""

import os

import pytest


@pytest.fixture(autouse=True)
def _no_coverage_in_children(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in [key for key in os.environ if key.startswith("COV_CORE_")]:
        monkeypatch.delenv(name)
