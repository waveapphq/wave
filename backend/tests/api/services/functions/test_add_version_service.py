"""Unit tests for `services.functions.service.add_function_version` (REQ-3.1.2.2).

The test-independent add-version service writes a new immutable library version
from a client-supplied ``draft_definition``. It owns this validation sequence, with
no ``source_version != draft upstream`` check (there is no node to compare
against here):

    1. changelog required          -> UnprocessableEntityException (422)
    2. valid target semver         -> UnprocessableEntityException (422)
    3. source version exists       -> NotFoundException (404)
    4. target not already present  -> ConflictException (409)
    5. target is an allowed bump   -> UnprocessableEntityException (422)

On success it returns ``{function_id, version}`` and the new version is durable.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
)
from wavecore.api.services.functions.service import SaveValidationError

pytestmark = pytest.mark.usefixtures("temp_storage_path")


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


def _source_body() -> dict[str, Any]:
    return {
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _source_metadata() -> dict[str, Any]:
    return {
        "description": "say hello",
        "tags": ["demo"],
        "changelog": "initial",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }


def _seed_source(name: str = "greet", version: str = "1.0.0") -> str:
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(fn_id, version, _source_body(), _source_metadata(), name=name)
    return fn_id


def _draft_description_change(name: str = "greet") -> dict[str, Any]:
    return {
        "name": name,
        "description": "new wording",
        "tags": ["demo"],
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _draft_added_required_input(name: str = "greet") -> dict[str, Any]:
    return {
        "name": name,
        "description": "say hello",
        "tags": ["demo"],
        "inputs": [
            {"name": "x", "type": "string", "required": True},
            {"name": "y", "type": "integer", "required": True},
        ],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _call(fn_id: str, **overrides: Any) -> dict[str, Any]:
    from wavecore.api.services.functions.service import add_function_version

    kwargs: dict[str, Any] = {
        "source_version": "1.0.0",
        "target_version": "1.0.1",
        "draft_definition": _draft_description_change(),
        "changelog": "Description update",
        "description": "new wording",
        "tags": ["demo"],
        "details": "",
    }
    kwargs.update(overrides)
    return add_function_version(fn_id, **kwargs)


def _workflow_calling(function_id: str, version: str = "1.0.0") -> dict[str, Any]:
    """A reachable body of one library Function block that calls ``function_id``."""
    return {
        "nodes": [
            {
                "id": "call-1",
                "type": "workflowNode",
                "data": {
                    "label": "Call_1",
                    "elementType": "function",
                    "nodeType": "function",
                    "functionLifecycle": "shared",
                    "functionId": function_id,
                    "functionVersion": version,
                    "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
                },
            }
        ],
        "edges": [{"source": "start-node", "target": "call-1"}],
    }


def _seed_plain(name: str, workflow: dict[str, Any] | None = None) -> str:
    """Seed a library Function without inputs or outputs."""
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    body = {
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": workflow or {"nodes": [], "edges": []},
    }
    save_new_version(fn_id, "1.0.0", body, _source_metadata(), name=name)
    return fn_id


def _publish_body_change(fn_id: str, name: str, workflow: dict[str, Any]) -> dict[str, Any]:
    """Publish 1.0.1 of a plain Function whose only change is its body."""
    draft = {
        "name": name,
        "description": "say hello",
        "tags": ["demo"],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": workflow,
    }
    return _call(fn_id, draft_definition=draft, changelog="Body change", description="say hello")


def _version_strings(fn_id: str) -> list[str]:
    from wavecore.api.services.functions._storage import list_versions

    return [entry["version"] for entry in list_versions(fn_id)["versions"]]


class TestAddVersionServiceHappyPath:
    def test_returns_function_id_and_version(self) -> None:
        fn_id = _seed_source()
        result = _call(fn_id)
        assert result == {"function_id": fn_id, "version": "1.0.1"}

    def test_new_version_is_persisted(self) -> None:
        from wavecore.api.services.functions._storage import list_versions, load_version

        fn_id = _seed_source()
        _call(fn_id)
        versions = [entry["version"] for entry in list_versions(fn_id)["versions"]]
        assert "1.0.1" in versions
        # The persisted version is loadable (no LookupError).
        assert load_version(fn_id, "1.0.1") is not None

    def test_major_bump_computed_from_versioning_matrix(self) -> None:
        """A draft that adds a REQUIRED input is only an allowed MAJOR bump."""
        fn_id = _seed_source()
        result = _call(
            fn_id,
            target_version="2.0.0",
            draft_definition=_draft_added_required_input(),
            changelog="Added required input y",
            description="say hello",
        )
        assert result["version"] == "2.0.0"


class TestAddVersionServicePerMajorNoBackports:
    """No-backports is PER-MAJOR: a target must exceed the latest version
    within its OWN major line, but is unconstrained by other major lines.
    """

    def _seed_two_versions(self) -> str:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _source_body(), _source_metadata(), name="greet")
        save_new_version(fn_id, "2.0.0", _source_body(), _source_metadata(), name="greet")
        return fn_id

    def test_prerelease_within_occupied_major_line_is_rejected(self) -> None:
        # 2.0.0 is released; 2.0.0-dev1 sorts below it within the 2.x line.
        fn_id = self._seed_two_versions()
        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Target version '2\.0\.0-dev1' must be greater than the latest "
            r"version '2\.0\.0' in the 2\.x line$",
        ):
            _call(
                fn_id,
                source_version="1.0.0",
                target_version="2.0.0-dev1",
                draft_definition=_draft_added_required_input(),
                changelog="pre-release of an existing release",
                description="say hello",
            )

    def test_patch_in_lower_major_allowed_when_higher_major_exists(self) -> None:
        # Per-major flip: 1.0.1 is allowed even though 2.0.0 exists, because the
        # 1.x line head is 1.0.0 and 1.0.1 advances it.
        fn_id = self._seed_two_versions()
        result = _call(fn_id, source_version="1.0.0", target_version="1.0.1", changelog="patch 1.x")
        assert result == {"function_id": fn_id, "version": "1.0.1"}

    def test_version_above_every_major_is_allowed(self) -> None:
        fn_id = self._seed_two_versions()
        result = _call(
            fn_id,
            source_version="1.0.0",
            target_version="3.0.0",
            draft_definition=_draft_added_required_input(),
            changelog="advance to a new major",
            description="say hello",
        )
        assert result["version"] == "3.0.0"


class TestAddVersionServiceChangelogRequired:
    def test_empty_changelog_raises_unprocessable(self) -> None:
        fn_id = _seed_source()
        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Changelog is required for edit-mode publish$",
        ):
            _call(fn_id, changelog="")

    def test_whitespace_changelog_raises_unprocessable(self) -> None:
        fn_id = _seed_source()
        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Changelog is required for edit-mode publish$",
        ):
            _call(fn_id, changelog="   ")


class TestAddVersionServiceInvalidSemver:
    def test_invalid_target_semver_raises_unprocessable(self) -> None:
        fn_id = _seed_source()
        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Function version 'not-a-semver' is not a valid semver$",
        ):
            _call(fn_id, target_version="not-a-semver")


class TestAddVersionServiceSourceMissing:
    def test_unknown_source_version_raises_not_found(self) -> None:
        fn_id = _seed_source(version="1.0.0")
        with pytest.raises(NotFoundException) as exc_info:
            _call(fn_id, source_version="9.9.9", target_version="9.9.10")
        assert re.match(
            rf"^Function '{re.escape(fn_id)}' version '9\.9\.9' not found$",
            exc_info.value.message,
        ), exc_info.value.message


class TestAddVersionServiceDuplicateTarget:
    def test_existing_target_raises_conflict(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = _seed_source()
        save_new_version(fn_id, "1.0.1", _source_body(), _source_metadata(), name="greet")
        with pytest.raises(
            ConflictException,
            match=r"^Target version '1\.0\.1' already exists in the library$",
        ):
            _call(fn_id, target_version="1.0.1")


class TestAddVersionServiceDisallowedBump:
    def test_patch_target_with_added_required_input_raises_unprocessable(self) -> None:
        fn_id = _seed_source()
        with pytest.raises(UnprocessableEntityException) as exc_info:
            _call(
                fn_id,
                target_version="1.0.1",
                draft_definition=_draft_added_required_input(),
                changelog="Trying to sneak a required input into a patch",
            )
        assert re.match(
            r"^Target version '1\.0\.1' is not a valid bump from '1\.0\.0' "
            r"\(disallowed change: .+\)$",
            exc_info.value.message,
        ), exc_info.value.message


class TestAddVersionServiceReferenceChecks:
    """A new version runs the reference and circular checks of the first publish (REQ-3.1.2.4)."""

    def test_a_version_that_calls_an_unknown_function_is_refused(self) -> None:
        fn_id = _seed_plain("caller")
        unknown_id = str(uuid.uuid4())

        with pytest.raises(SaveValidationError) as exc_info:
            _publish_body_change(fn_id, "caller", _workflow_calling(unknown_id))

        findings = exc_info.value.errors
        assert [finding["code"] for finding in findings] == ["MISSING_FUNCTION_ID"]
        assert re.fullmatch(
            rf"^References unknown Function '{re.escape(unknown_id)}'$", findings[0]["message"]
        ), findings[0]["message"]
        assert findings[0]["function_id"] == unknown_id
        assert findings[0]["function_version"] == "1.0.0"
        assert _version_strings(fn_id) == ["1.0.0"]

    def test_a_version_that_pins_a_missing_version_is_refused(self) -> None:
        callee_id = _seed_plain("callee")
        fn_id = _seed_plain("caller")

        with pytest.raises(SaveValidationError) as exc_info:
            _publish_body_change(fn_id, "caller", _workflow_calling(callee_id, "9.9.9"))

        findings = exc_info.value.errors
        assert [finding["code"] for finding in findings] == ["MISSING_FUNCTION_VERSION"]
        assert re.fullmatch(
            r"^Pinned version 9\.9\.9 is no longer available in the library$",
            findings[0]["message"],
        ), findings[0]["message"]
        assert findings[0]["function_id"] == callee_id
        assert findings[0]["function_version"] == "9.9.9"
        assert _version_strings(fn_id) == ["1.0.0"]

    def test_a_version_that_closes_a_circle_is_refused(self) -> None:
        a_id = _seed_plain("fn_a")
        b_id = _seed_plain("fn_b", _workflow_calling(a_id))

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Circular Function reference: fn_a -> fn_b -> fn_a$",
        ) as exc_info:
            _publish_body_change(a_id, "fn_a", _workflow_calling(b_id))

        assert exc_info.value.status_code == 422
        assert _version_strings(a_id) == ["1.0.0"]
