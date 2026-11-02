"""Tests for `services.workbench.functions.publish_local_function`.

Contract:

    services.workbench.functions.publish_local_function(test_id, node_id, payload)
        Validates the local Function's body via validate_function_for_save;
        runs detect_circular_deps; creates the library entry via
        services.functions.create_function; mutates the Test's workflow node
        from local -> reference; returns the new function_id + updated node.
        Atomic: rolls back library create on Test mutation failure.

Error messages are asserted with anchored regex.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import pytest

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
)
from wavecore.api.services.functions import _storage as _function_storage
from wavecore.api.services.functions import service as functions_service
from wavecore.api.services.tests import service as test_service

from .conftest import (
    make_local_function_node,
    make_published_function_payload,
    make_test_with_function_node,
)


def publish_local_function(*args: Any, **kwargs: Any) -> Any:
    """Lazy proxy: re-binds to the real implementation at call-time so the
    test module collects without importing the public symbol from
    ``wavecore.api.services.workbench.functions`` up front."""
    from wavecore.api.services.workbench.functions import (
        publish_local_function as _impl,
    )

    return _impl(*args, **kwargs)


def _library_function_block(node_id: str, function_id: str) -> dict[str, Any]:
    """A library Function block that calls ``function_id`` at 1.0.0."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


# Anchored regex helpers for the exact strings.
NAME_REQUIRED_RE = re.compile(r"^Function name is required$")
NAME_TOO_LONG_RE = re.compile(r"^Function name '.+' exceeds 32 characters$")
NAME_IN_USE_RE = re.compile(r"^Function name '.+' is already in use$")
TEST_NOT_FOUND_RE = re.compile(r"^Test '.+' not found$")
NODE_NOT_FOUND_RE = re.compile(r"^Block '.+' not found in Test '.+'$")
NODE_NOT_LOCAL_RE = re.compile(r"^Block '.+' is not a local Function$")


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestPublishHappyPath:
    """A well-formed local Function publishes into the library and updates the Test."""

    def test_creates_library_entry_with_v1_version(self) -> None:
        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet User")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        result = publish_local_function(
            test_id,
            "fn-1",
            make_published_function_payload(
                name="Greet User",
                description="Publishes a greeting.",
                tags=["greet", "demo"],
                changelog="Initial release",
                details="Reusable greeting Function.",
            ),
        )

        assert "function_id" in result
        assert result["version"] == "1.0.0"
        assert result["node"]["data"]["functionLifecycle"] == "shared"
        assert result["node"]["data"]["functionId"] == result["function_id"]

        # The library entry exists on disk with the version field populated.
        definition, _etag = _function_storage.load_function(result["function_id"])
        assert definition["name"] == "Greet User"
        assert definition["version"] == "1.0.0"
        assert definition["description"] == "Publishes a greeting."
        assert definition["tags"] == ["greet", "demo"]

    def test_updates_test_node_to_reference(self) -> None:
        fn_node = make_local_function_node(node_id="fn-ref", fn_name="My Helper")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        result = publish_local_function(
            test_id, "fn-ref", make_published_function_payload(name="My Helper")
        )

        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-ref")
        assert node["data"]["functionLifecycle"] == "shared"
        assert node["data"]["functionId"] == result["function_id"]
        # The local body is dropped from the Test node once the reference is set.
        assert "localDefinition" not in node["data"]

    def test_published_library_entry_omits_profile_bindings(self) -> None:
        """profileBindings live on instances, not the library entry."""
        fn_node = make_local_function_node(
            node_id="fn-pb",
            fn_name="Bound Function",
            profile_bindings=[{"profileId": "prof-1", "bindings": {}}],
        )
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        result = publish_local_function(
            test_id, "fn-pb", make_published_function_payload(name="Bound Function")
        )

        definition, _etag = _function_storage.load_function(result["function_id"])
        # The library entry never carries profile bindings.
        assert "profile_bindings" not in definition
        assert "profileBindings" not in definition

    def test_the_library_version_keeps_the_functions_own_variables(self) -> None:
        """A Function's own variables are published with it (REQ-3.1.2.1)."""
        variables = [
            {"name": "fn_kept", "type": "string", "value": "kept"},
            {"name": "doubled", "type": "integer", "isExpression": True, "value": "2 * 3"},
        ]
        fn_node = make_local_function_node(node_id="fn-vars", fn_name="Keeps Locals")
        fn_node["data"]["localDefinition"]["variables"] = variables
        created = test_service.create_test(make_test_with_function_node(fn_node))

        result = publish_local_function(
            created["id"], "fn-vars", make_published_function_payload(name="Keeps Locals")
        )

        definition, _etag = _function_storage.load_function(result["function_id"])
        assert definition.get("variables") == variables
        version = _function_storage.load_version(result["function_id"], "1.0.0")
        assert version.get("variables") == variables

    @pytest.mark.asyncio
    async def test_a_published_instance_run_seeds_the_functions_own_variables(self) -> None:
        from wavecore.api.services import log_streaming_service
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.api.services.workbench.functions import handle_function_node
        from wavecore.api.services.workbench.node_helpers import _extract_node_fields

        fn_node = make_local_function_node(node_id="fn-run", fn_name="Reads Local")
        local_def = fn_node["data"]["localDefinition"]
        local_def["variables"] = [{"name": "fn_kept", "type": "string", "value": "kept"}]
        local_def["outputs"] = [{"name": "out", "type": "string"}]
        body_log = local_def["workflow"]["nodes"][0]["data"]["config"]
        body_log["values"]["message"] = "fn_kept"
        body_log["outputBindings"] = {"line": "out"}
        created = test_service.create_test(make_test_with_function_node(fn_node))
        published = publish_local_function(
            created["id"], "fn-run", make_published_function_payload(name="Reads Local")
        )

        session_id = "publish-run-seeds-locals"
        _wb_common._workbench_sessions[session_id] = {
            "session_id": session_id,
            "status": "running",
            "block_states": {},
            "variables": {},
            "websocket_topic": f"workbench:{session_id}",
            "log_topic": f"log:{session_id}",
            "skipped_node_ids": [],
            "scope_failed": False,
        }
        try:
            outputs = await handle_function_node(
                _extract_node_fields({"id": "fn-run", "data": published["node"]["data"]}),
                variables={},
                session_id=session_id,
                node_id="fn-run",
            )
        finally:
            _wb_common._workbench_sessions.pop(session_id, None)
            log_streaming_service._clear_session_logs(session_id)

        assert outputs == {"out": "kept"}


# ---------------------------------------------------------------------------
# Name validation
# ---------------------------------------------------------------------------


class TestPublishNameValidation:
    def test_empty_name_raises_validation_error(self) -> None:
        fn_node = make_local_function_node(node_id="fn-x")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        with pytest.raises(ValidationException, match=NAME_REQUIRED_RE):
            publish_local_function(test_id, "fn-x", make_published_function_payload(name=""))

    def test_whitespace_only_name_raises_validation_error(self) -> None:
        fn_node = make_local_function_node(node_id="fn-x")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        with pytest.raises(ValidationException, match=NAME_REQUIRED_RE):
            publish_local_function(test_id, "fn-x", make_published_function_payload(name="   "))

    def test_name_over_32_chars_raises_validation_error(self) -> None:
        fn_node = make_local_function_node(node_id="fn-x")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        too_long = "X" * 33
        with pytest.raises(ValidationException, match=NAME_TOO_LONG_RE):
            publish_local_function(test_id, "fn-x", make_published_function_payload(name=too_long))

    def test_duplicate_name_raises_conflict(self) -> None:
        """Publishing with a name already in the library is rejected (case-insensitive)."""
        functions_service.create_function(
            {
                "name": "Existing Name",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            }
        )
        fn_node = make_local_function_node(node_id="fn-x")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        with pytest.raises((ConflictException, ValidationException), match=NAME_IN_USE_RE):
            publish_local_function(
                test_id, "fn-x", make_published_function_payload(name="EXISTING NAME")
            )


# ---------------------------------------------------------------------------
# Error precedence
# ---------------------------------------------------------------------------


class TestPublishErrorPrecedence:
    """A taken name is reported before the version and the body are judged."""

    TAKEN = "Existing Name"

    def _seed_library_entry(self) -> None:
        functions_service.create_function(
            {
                "name": self.TAKEN,
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            }
        )

    def _test_with_node(self, inputs: list[dict[str, Any]] | None = None) -> str:
        fn_node = make_local_function_node(node_id="fn-x", inputs=inputs)
        # A Test save refuses a Function Block that leaves a Required input empty.
        fn_node["data"]["config"]["values"] = {
            item["name"]: "x" for item in inputs or [] if item.get("required")
        }
        created = test_service.create_test(make_test_with_function_node(fn_node))
        return str(created["id"])

    def test_taken_name_beats_an_invalid_version(self) -> None:
        self._seed_library_entry()
        test_id = self._test_with_node()
        payload = make_published_function_payload(name=self.TAKEN)
        payload["version"] = "not-a-semver"

        with pytest.raises(ConflictException, match=NAME_IN_USE_RE):
            publish_local_function(test_id, "fn-x", payload)

    def test_taken_name_beats_an_over_long_version(self) -> None:
        self._seed_library_entry()
        test_id = self._test_with_node()
        payload = make_published_function_payload(name=self.TAKEN)
        payload["version"] = "9" * 70

        with pytest.raises(ConflictException, match=NAME_IN_USE_RE):
            publish_local_function(test_id, "fn-x", payload)

    def test_taken_name_beats_an_invalid_input_name(self) -> None:
        self._seed_library_entry()
        test_id = self._test_with_node()
        # A Test save refuses the invalid name itself, so the stored Test is written as is.
        raw = test_service._get_raw_test(test_id)
        assert raw is not None
        (node,) = [node for node in raw["workflow"]["nodes"] if node["id"] == "fn-x"]
        node["data"]["localDefinition"]["inputs"] = [
            {"name": "1bad name", "type": "string", "required": True, "default": None}
        ]
        test_service._update_raw_test(test_id, {"workflow": raw["workflow"]})

        with pytest.raises(ConflictException, match=NAME_IN_USE_RE):
            publish_local_function(
                test_id, "fn-x", make_published_function_payload(name=self.TAKEN)
            )

    def test_taken_name_is_matched_case_insensitively(self) -> None:
        self._seed_library_entry()
        test_id = self._test_with_node()

        with pytest.raises(ConflictException, match=NAME_IN_USE_RE):
            publish_local_function(
                test_id, "fn-x", make_published_function_payload(name="eXiStInG nAmE")
            )


# ---------------------------------------------------------------------------
# Cycle rejection
# ---------------------------------------------------------------------------


class TestPublishCircularDependencyDetection:
    def test_a_first_publish_that_closes_a_circle_of_body_blocks_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """B's body calls the id A is published under, and A's body calls B."""
        a_id = "deadbeef-cafe-cafe-cafe-deadbeefcafe"
        b_id = "feedface-cafe-cafe-cafe-feedfacecafe"
        _function_storage.save_new_version(
            b_id,
            "1.0.0",
            {
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": [_library_function_block("call_a", a_id)],
                    "edges": [{"source": "start-node", "target": "call_a"}],
                },
            },
            {"published_at": "2026-01-01T00:00:00Z", "published_by": "wave"},
            name="fn_b",
        )
        fn_node = make_local_function_node(
            node_id="fn-a-node",
            fn_name="fn_a",
            extra_workflow_nodes=[_library_function_block("call_b", b_id)],
        )
        fn_node["data"]["localDefinition"]["workflow"]["edges"].append(
            {"source": "inner_log", "target": "call_b"}
        )
        created = test_service.create_test(make_test_with_function_node(fn_node))
        # The first publish draws the new Function id from uuid4.
        monkeypatch.setattr(uuid, "uuid4", lambda: uuid.UUID(a_id))

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Circular Function reference: fn_a -> fn_b -> fn_a$",
        ) as exc_info:
            publish_local_function(
                created["id"], "fn-a-node", make_published_function_payload(name="fn_a")
            )

        assert exc_info.value.status_code == 422


# ---------------------------------------------------------------------------
# Test / node lookup
# ---------------------------------------------------------------------------


class TestPublishLookupErrors:
    def test_unknown_test_id_raises_not_found(self) -> None:
        missing_test = "00000000-0000-0000-0000-000000000000"
        with pytest.raises(NotFoundException, match=TEST_NOT_FOUND_RE):
            publish_local_function(
                missing_test, "fn-x", make_published_function_payload(name="Greet")
            )

    def test_unknown_node_id_raises_not_found(self) -> None:
        fn_node = make_local_function_node(node_id="fn-real")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        with pytest.raises(NotFoundException, match=NODE_NOT_FOUND_RE):
            publish_local_function(
                test_id, "fn-missing", make_published_function_payload(name="Greet")
            )

    def test_non_function_node_raises(self) -> None:
        """Publishing a plugin node (not a Function) is rejected."""
        plugin_node: dict[str, Any] = {
            "id": "plug-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "plug",
                "nodeType": "plugin",
                "elementType": "log",
                "version": "1.0.0",
                "config": {"values": {"message": "'hi'", "level": "INFO"}, "outputBindings": {}},
                "expressionFields": ["message"],
            },
        }
        created = test_service.create_test(
            {
                "name": "Plugin Container",
                "workflow": {
                    "nodes": [plugin_node],
                    "edges": [{"source": "start-node", "target": "plug-1"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]

        with pytest.raises(ConflictException, match=NODE_NOT_LOCAL_RE):
            publish_local_function(test_id, "plug-1", make_published_function_payload(name="Greet"))

    def test_already_published_node_raises(self) -> None:
        """Publishing a node that is already in `shared` lifecycle is rejected."""
        shared_node = {
            "id": "fn-already-shared",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "Already Shared",
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": "00000000-0000-0000-0000-000000000999",
                "config": {"values": {}, "outputBindings": {}},
            },
        }
        # The save pipeline rejects a missing library entry (REQ-3.1.2.4), so the
        # already-shared state is persisted directly; publishing it must be rejected.
        test_id = "22222222-2222-2222-2222-222222220999"
        test_service._save_test(
            {
                "id": test_id,
                "name": "Already-shared container",
                "version": "1.0.0",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-already-shared"}],
                },
                "variables": {},
            }
        )

        with pytest.raises(ConflictException, match=NODE_NOT_LOCAL_RE):
            publish_local_function(
                test_id,
                "fn-already-shared",
                make_published_function_payload(name="Greet"),
            )


# ---------------------------------------------------------------------------
# Local Function body validation
# ---------------------------------------------------------------------------


class TestPublishBodyValidation:
    def test_local_with_empty_workflow_publishes_with_warning_only(self) -> None:
        """An empty body is a warning, not an error - it should still publish."""
        fn_node = make_local_function_node(node_id="fn-empty")
        # Remove the inner_log node so the workflow is empty.
        fn_node["data"]["localDefinition"]["workflow"] = {"nodes": [], "edges": []}
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        result = publish_local_function(
            test_id, "fn-empty", make_published_function_payload(name="Empty Fn")
        )
        assert result["function_id"]

    def test_local_referencing_unknown_plugin_is_rejected(self) -> None:
        """A body invoking an unregistered plugin fails validate_function_for_save.

        The Test save pipeline normally rejects such a body too; this test
        bypasses that by writing the Test directly to storage so the publish
        path is the one under exercise.
        """
        import uuid as _uuid
        from datetime import UTC, datetime

        fn_node = make_local_function_node(node_id="fn-bad-plugin")
        fn_node["data"]["localDefinition"]["workflow"] = {
            "nodes": [
                {
                    "id": "inner_unknown",
                    "type": "workflowNode",
                    "data": {
                        "label": "inner_unknown",
                        "elementType": "this-plugin-does-not-exist",
                        "nodeType": "plugin",
                        "version": "1.0.0",
                        "config": {"values": {}, "outputBindings": {}},
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "inner_unknown"}],
        }
        test_id = str(_uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id,
                "name": "Bad Plugin Container",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [fn_node],
                    "edges": [{"source": "start-node", "target": "fn-bad-plugin"}],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )

        with pytest.raises(UnprocessableEntityException):
            publish_local_function(
                test_id,
                "fn-bad-plugin",
                make_published_function_payload(name="Bad Plugin Fn"),
            )


# ---------------------------------------------------------------------------
# Atomicity: library write rolls back if Test mutation fails
# ---------------------------------------------------------------------------


class TestPublishAtomicity:
    def test_test_mutation_failure_rolls_back_library_entry(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If the Test cannot be re-saved (storage failure mid-flight),
        the just-created library entry must be removed so the system
        does not end up with a half-published-half-local state.

        We force the Test save to raise after the library entry is written,
        then assert the library entry no longer exists.
        """
        fn_node = make_local_function_node(node_id="fn-atomic", fn_name="Atomic Fn")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        original_save = test_service._save_test

        def _exploding_save(test: dict[str, Any]) -> None:
            # Only blow up on the publish-driven update, not the initial save.
            workflow = test.get("workflow") or {}
            nodes = workflow.get("nodes") or []
            if nodes and nodes[0].get("data", {}).get("functionLifecycle") == "shared":
                raise OSError("disk full")
            original_save(test)

        monkeypatch.setattr(test_service, "_save_test", _exploding_save)

        # Snapshot the library entries before the publish attempt.
        before_ids = {s["id"] for s in _function_storage.list_function_summaries()}

        with pytest.raises(OSError):
            publish_local_function(
                test_id, "fn-atomic", make_published_function_payload(name="Atomic Fn")
            )

        # No new library entries should remain.
        after_ids = {s["id"] for s in _function_storage.list_function_summaries()}
        assert after_ids == before_ids

        # The Test node remains local.
        reloaded = test_service.get_test(test_id)
        assert reloaded is not None
        node = next(n for n in reloaded["workflow"]["nodes"] if n["id"] == "fn-atomic")
        assert node["data"]["functionLifecycle"] == "local"
        assert "localDefinition" in node["data"]


# ---------------------------------------------------------------------------
# Defensive branches in publish_local_function (coverage)
# ---------------------------------------------------------------------------


class TestPublishDefensiveBranches:
    """Cover the rarely-hit error / cleanup paths in `publish_local_function`."""

    def test_invalid_semver_version_is_rejected(self) -> None:
        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]
        payload = make_published_function_payload(name="Greet")
        payload["version"] = "not-a-version"
        with pytest.raises(
            ValidationException, match=r"^Function version '.+' is not a valid semver"
        ):
            publish_local_function(test_id, "fn-1", payload)

    def test_already_in_use_from_create_function_reraises_as_conflict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If a race lets create_function raise the 'is already in use'
        ValidationException after our pre-check passes, publish must
        re-raise it as ConflictException (so the route maps to 409)."""
        from wavecore.api.exceptions import ConflictException as _Conflict

        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        def _raise_collision(_payload):
            raise ValidationException(
                message="Function name 'Greet' is already in use",
                details={"errors": [{"message": "Function name 'Greet' is already in use"}]},
            )

        monkeypatch.setattr(functions_service, "create_function", _raise_collision)
        with pytest.raises(_Conflict, match=r"is already in use"):
            publish_local_function(test_id, "fn-1", make_published_function_payload(name="Greet"))

    def test_generic_validation_from_create_function_propagates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If `create_function` raises a non-name-collision ValidationException,
        publish_local_function must re-raise it as-is (not re-classify)."""
        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        def _raise_generic(_payload):
            raise ValidationException(
                message="Generic non-collision validation error",
                details={"errors": [{"message": "Generic non-collision validation error"}]},
            )

        monkeypatch.setattr(functions_service, "create_function", _raise_generic)
        with pytest.raises(ValidationException, match=r"^Generic non-collision validation error$"):
            publish_local_function(test_id, "fn-1", make_published_function_payload(name="Greet"))

    def test_changelog_lookup_error_during_metadata_set_is_swallowed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If load_function fails after create succeeds (race), publish must
        still complete - the changelog/details just don't land in metadata."""
        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        original_load = _function_storage.load_function

        def _race(function_id: str):
            # Simulate the library entry being missing right after creation.
            raise LookupError(function_id)

        monkeypatch.setattr(_function_storage, "load_function", _race)
        try:
            result = publish_local_function(
                test_id,
                "fn-1",
                make_published_function_payload(name="Greet", changelog="x", details="y"),
            )
            assert result["function_id"]
        finally:
            monkeypatch.setattr(_function_storage, "load_function", original_load)

    def test_rollback_lookup_error_is_swallowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """If the rollback delete_function_file ALSO raises LookupError (the
        entry was deleted by some other actor before rollback ran), the
        OSError from the Test save still surfaces to the caller and the
        rollback exception is swallowed."""
        fn_node = make_local_function_node(node_id="fn-1", fn_name="Greet")
        created = test_service.create_test(make_test_with_function_node(fn_node))
        test_id = created["id"]

        original_save = test_service._save_test
        original_delete = _function_storage.delete_function_file

        def _exploding_save(test):
            workflow = test.get("workflow") or {}
            nodes = workflow.get("nodes") or []
            if nodes and nodes[0].get("data", {}).get("functionLifecycle") == "shared":
                raise OSError("disk full")
            original_save(test)

        def _missing_delete(function_id):
            raise LookupError(function_id)

        monkeypatch.setattr(test_service, "_save_test", _exploding_save)
        monkeypatch.setattr(_function_storage, "delete_function_file", _missing_delete)
        try:
            with pytest.raises(OSError):
                publish_local_function(
                    test_id, "fn-1", make_published_function_payload(name="Greet")
                )
        finally:
            monkeypatch.setattr(test_service, "_save_test", original_save)
            monkeypatch.setattr(_function_storage, "delete_function_file", original_delete)


pytestmark = pytest.mark.usefixtures("temp_storage_path")
