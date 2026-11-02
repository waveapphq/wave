"""Global 32-char Function version length cap (REQ-3.1.2.2).

A Function version string is capped at 32 characters globally - the same cap
the storage layer already enforces on Function names (``NAME_MAX_LENGTH = 32``).
The cap is the single source of truth in ``_versioning.is_valid_version``: a
version longer than 32 characters is not a valid version, even when it is
otherwise well-formed semver.

The publish / version-write sites surface a length-specific message so the user
can tell an over-long version apart from a malformed one. The message asserted
here is the one those sites raise instead of ``... is not a valid semver`` when
the only problem is length.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.exceptions import UnprocessableEntityException, ValidationException

# Anchored length message raised at the publish / version-write sites.
VERSION_TOO_LONG_RE = re.compile(
    r"^Function version '.+' exceeds the maximum length of 32 characters$"
)

# "1.0.0-" is 6 chars; pad the pre-release so the whole string is 32 / 33 chars.
# Both are well-formed semver per the existing regex - only length differs.
VERSION_32 = "1.0.0-" + "a" * 26  # 32 chars, valid
VERSION_33 = "1.0.0-" + "a" * 27  # 33 chars, over the cap


# ---------------------------------------------------------------------------
# Unit: the cap lives in is_valid_version (single source of truth)
# ---------------------------------------------------------------------------


class TestIsValidVersionLengthCap:
    """``is_valid_version`` rejects a version longer than 32 characters."""

    def test_version_over_32_chars_is_invalid(self) -> None:
        from wavecore.api.services.functions._versioning import is_valid_version

        assert len(VERSION_33) == 33
        assert is_valid_version(VERSION_33) is False

    def test_version_exactly_32_chars_is_valid(self) -> None:
        from wavecore.api.services.functions._versioning import is_valid_version

        assert len(VERSION_32) == 32
        assert is_valid_version(VERSION_32) is True

    def test_plain_semver_still_valid(self) -> None:
        """The cap must not regress ordinary short versions."""
        from wavecore.api.services.functions._versioning import is_valid_version

        assert is_valid_version("1.0.0") is True
        assert is_valid_version("12.34.56") is True

    def test_malformed_short_version_still_invalid(self) -> None:
        from wavecore.api.services.functions._versioning import is_valid_version

        assert is_valid_version("not-a-semver") is False


# ---------------------------------------------------------------------------
# Integration: the publish path raises the length-specific message
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
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


def _local_function_node(node_id: str, name: str) -> dict[str, Any]:
    """A canvas node carrying a publishable Local Function with a one-Log body."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": name,
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": name,
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": [
                        {
                            "id": "inner-log",
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "label": "inner",
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "config": {
                                    "values": {"message": "'hi'", "level": "INFO"},
                                    "profileBindings": [],
                                    "outputBindings": {},
                                },
                                "displayName": "inner",
                                "expressionFields": ["message"],
                                "templateFields": [],
                                "variableExpressionKeys": [],
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "inner-log"}],
                },
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _seed_test_with_local_function(node_id: str, name: str) -> str:
    from wavecore.api.services.tests import service as test_service

    test_id = str(uuid.uuid4())
    test_service._save_test(
        {
            "id": test_id,
            "name": "Publisher",
            "version": "1.0.0",
            "workflow": {
                "nodes": [_local_function_node(node_id, name)],
                "edges": [{"source": "start-node", "target": node_id}],
            },
            "variables": {},
        }
    )
    return test_id


class TestPublishVersionLengthCap:
    """Publishing a local Function with an over-length version is rejected."""

    def test_publish_over_length_version_raises_length_message(self) -> None:
        from wavecore.api.services.workbench import functions as workbench_functions

        test_id = _seed_test_with_local_function("fn-pub", "cap_publish_fn")
        with pytest.raises(ValidationException) as excinfo:
            workbench_functions.publish_local_function(
                test_id,
                "fn-pub",
                {"name": "cap_published", "version": VERSION_33},
            )
        assert VERSION_TOO_LONG_RE.match(excinfo.value.message or ""), excinfo.value.message

    def test_publish_32_char_version_is_accepted(self) -> None:
        from wavecore.api.services.workbench import functions as workbench_functions

        test_id = _seed_test_with_local_function("fn-pub", "cap_publish_ok_fn")
        result = workbench_functions.publish_local_function(
            test_id,
            "fn-pub",
            {"name": "cap_published_ok", "version": VERSION_32},
        )
        assert result["version"] == VERSION_32


class TestVersionWriteSiteLengthCap:
    """The storage + edit-mode-publish write sites raise the length message."""

    def test_save_new_version_over_length_raises_length_message(self) -> None:
        from wavecore.api.services.functions import _storage

        # The length check guards before any filesystem write, so a minimal
        # definition/metadata is enough to reach it.
        with pytest.raises(ValidationException) as excinfo:
            _storage.save_new_version(str(uuid.uuid4()), VERSION_33, {}, {}, name="cap_fn")
        assert VERSION_TOO_LONG_RE.match(excinfo.value.message or ""), excinfo.value.message

    def test_add_function_version_over_length_raises_length_message(self) -> None:
        from wavecore.api.services.functions import service as function_service

        # Length check fires after the changelog guard and before the source load.
        with pytest.raises(UnprocessableEntityException) as excinfo:
            function_service.add_function_version(
                str(uuid.uuid4()),
                source_version="1.0.0",
                target_version=VERSION_33,
                draft_definition={},
                changelog="x",
                description="",
                tags=[],
                details="",
            )
        assert VERSION_TOO_LONG_RE.match(excinfo.value.message or ""), excinfo.value.message


pytestmark = pytest.mark.usefixtures("temp_storage_path")
