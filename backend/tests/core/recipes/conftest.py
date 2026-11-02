"""Shared fixtures and builders for the recipe core tests.

Test files defer their imports of wavecore.core.recipes into helpers.
"""

from collections.abc import Generator, Sequence
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.mcp.conftest import seed_registries  # noqa: F401

LOG_STEP: dict[str, Any] = {"block": "log", "settings": {"message": "hello"}}


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:  # noqa: F811 - fixture param, not a redefinition
    """Recipe validation resolves blocks against the live registries."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    """Isolate the functions and profiles stores recipe lookups touch."""
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common

    def _clear() -> None:
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()

    _clear()
    yield
    _clear()


def dump_recipe(doc: dict[str, Any]) -> str:
    """Serialize a recipe document dict to YAML text preserving key order."""
    return yaml.safe_dump(doc, sort_keys=False)


def make_recipe(
    flow: list[Any],
    *,
    name: str = "Recipe Under Test",
    description: str | None = None,
    tags: list[str] | None = None,
    variables: dict[str, Any] | None = None,
    functions: list[dict[str, Any]] | None = None,
) -> str:
    """Build a recipe YAML text from parts."""
    test: dict[str, Any] = {"name": name}
    if description is not None:
        test["description"] = description
    if tags is not None:
        test["tags"] = tags
    doc: dict[str, Any] = {"test": test}
    if variables is not None:
        doc["variables"] = variables
    if functions is not None:
        doc["functions"] = functions
    doc["flow"] = flow
    return dump_recipe(doc)


def codes(findings: Sequence[dict[str, Any]]) -> list[str]:
    return [finding["code"] for finding in findings]


def error_findings(findings: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    return [finding for finding in findings if finding["severity"] == "error"]


def find_finding(findings: Sequence[dict[str, Any]], code: str) -> dict[str, Any]:
    matches = [finding for finding in findings if finding["code"] == code]
    assert len(matches) == 1, f"expected exactly one {code} finding in {findings!r}"
    return matches[0]


def create_profile(
    name: str,
    profile_type: str = "custom",
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from wavecore.api.services.profiles import service as profile_service

    if config is None:
        config = {"username": "user", "password": "secret"}
    return profile_service.create_profile(name, profile_type, config=config)


def create_library_function(
    name: str,
    *,
    version: str = "1.0.0",
    inputs: Sequence[dict[str, Any]] = (),
    outputs: Sequence[dict[str, Any]] = (),
) -> dict[str, Any]:
    from wavecore.api.services.functions import service as function_service

    definition, _etag = function_service.create_function(
        {
            "name": name,
            "description": f"{name} library function",
            "tags": [],
            "inputs": [dict(item) for item in inputs],
            "outputs": [dict(item) for item in outputs],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": version,
        }
    )
    return definition
