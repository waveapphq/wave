"""Shared fixtures for backend Function tests.

These tests exercise the Function backend. They rely
on the autouse temp_storage_path fixture in `backend/tests/conftest.py` to point
storage at a temporary directory; this module adds Function-specific helpers
that build sample payloads and reset any Function in-memory caches.
"""

from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

# Reusable parameter type set.
PARAM_TYPES = ("string", "integer", "float", "boolean", "array", "map", "table")


@pytest.fixture(autouse=True)
def _reset_functions_cache() -> Generator[None, None, None]:
    """Reset any Function in-memory cache between tests.

    The Function service exposes a private `_clear_in_memory_cache` helper for
    test isolation. It is imported lazily so this fixture does not error when
    the service module is missing.
    """
    try:
        from wavecore.api.services.functions.service import (
            _clear_in_memory_cache,
        )
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _clear_in_memory_cache()
    yield
    _clear_in_memory_cache()


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    """Register the log plugin + core controls so reference validators resolve.

    The reference dimension (``_validate_references``) consults the global
    plugin and control registries; unit tests run without the app's startup
    hook so we re-register on every test (idempotent via clear + register).
    """
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


@pytest.fixture
def client() -> TestClient:
    """FastAPI TestClient bound to the WAVE app."""
    from wavecore.api.app import app

    return TestClient(app)


def make_function_payload(**overrides: Any) -> dict[str, Any]:
    """Build a valid Function create/update payload with sensible defaults.

    Overrides any top-level key. Inputs/outputs/dependencies default to empty
    lists or dicts to match the on-disk schema.
    """
    payload: dict[str, Any] = {
        "name": overrides.pop("name", "sample_function"),
        "description": overrides.pop("description", "A sample function for tests."),
        "tags": overrides.pop("tags", []),
        "inputs": overrides.pop("inputs", []),
        "outputs": overrides.pop("outputs", []),
        "dependencies": overrides.pop("dependencies", {"functions": [], "plugins": []}),
        "workflow": overrides.pop("workflow", {"nodes": [], "edges": []}),
    }
    payload.update(overrides)
    return payload


def make_input(
    name: str = "x",
    type_: str = "string",
    required: bool = True,
    default: Any = None,
    description: str = "",
) -> dict[str, Any]:
    """Build a single input parameter declaration."""
    return {
        "name": name,
        "type": type_,
        "required": required,
        "default": default,
        "description": description,
    }


def make_output(
    name: str = "result",
    type_: str = "string",
    description: str = "",
) -> dict[str, Any]:
    """Build a single output parameter declaration."""
    return {
        "name": name,
        "type": type_,
        "description": description,
    }
