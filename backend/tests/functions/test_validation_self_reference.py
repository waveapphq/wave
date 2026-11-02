"""A Function nested inside itself (directly or transitively) is rejected.

REQ-3.1.2.4. Beyond the library-scope cycle check (which governs published
entries at publish time), the recursive validation descent independently catches
a self-referential composition graph: a Function whose body references itself, or
references a Function that transitively references it back. A cycle introduced by
any path the FE drop-guard does not cover - import, a hand-edited file - is
reported as a `SELF_REFERENTIAL_FUNCTION` error (carrying the function_path trail)
rather than walked without bound.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest

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


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _shared_instance(
    *, node_id: str, function_id: str, label: str, version: str = "1.0.0"
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": version,
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _seed_function_with_body(
    *,
    fn_id: str,
    name: str,
    body_nodes: list[dict[str, Any]],
    version: str = "1.0.0",
) -> None:
    """Seed a published Function through the storage layer, past save validation."""
    from wavecore.api.services.functions._storage import save_new_version

    save_new_version(
        fn_id,
        version,
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": body_nodes, "edges": []},
        },
        {
            "description": "",
            "tags": [],
            "changelog": "seed",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )


def _local_fn(*, node_id: str, label: str, body_nodes: list[dict[str, Any]]) -> dict[str, Any]:
    entry_target = body_nodes[0]["id"] if body_nodes else "start-node"
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": label,
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {
                    "nodes": body_nodes,
                    "edges": [{"source": "start-node", "target": entry_target}],
                },
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _test_with_nodes(nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "name": "T",
        "version": "1.0.0",
        "workflow": {"nodes": nodes, "edges": []},
        "variables": {},
    }


def _self_ref_errors(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e.get("code") == "SELF_REFERENTIAL_FUNCTION"]


# ---------------------------------------------------------------------------
# Direct self-reference: F's body contains an instance of F
# ---------------------------------------------------------------------------


class TestDirectSelfReferenceTopLevel:
    """A Test directly instantiates F, whose stored body instantiates F again."""

    def _result(self) -> dict[str, Any]:
        from wavecore.api.services.tests.service import _validate_test_data

        f_id = str(uuid.uuid4())
        _seed_function_with_body(
            fn_id=f_id,
            name="Selfie",
            body_nodes=[_shared_instance(node_id="self-inner", function_id=f_id, label="Selfie")],
        )
        test = _test_with_nodes(
            [_shared_instance(node_id="top-1", function_id=f_id, label="Selfie")]
        )
        return _validate_test_data(test, context="save")

    def test_emits_self_referential_error(self) -> None:
        assert len(_self_ref_errors(self._result())) >= 1, self._result()["errors"]

    def test_error_carries_a_function_path(self) -> None:
        errors = _self_ref_errors(self._result())
        assert any(isinstance(e.get("function_path"), list) for e in errors), errors


class TestDirectSelfReferenceInsideLocalBody:
    """The self-referential Shared instance sits inside a top-level Local body
    (the descent enters via the Local body, then follows the Shared reference)."""

    def test_emits_self_referential_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        f_id = str(uuid.uuid4())
        _seed_function_with_body(
            fn_id=f_id,
            name="Selfie",
            body_nodes=[_shared_instance(node_id="self-inner", function_id=f_id, label="Selfie")],
        )
        outer = _local_fn(
            node_id="outer-1",
            label="Outer_Fn",
            body_nodes=[_shared_instance(node_id="ref-1", function_id=f_id, label="Selfie")],
        )
        result = _validate_test_data(_test_with_nodes([outer]), context="save")
        assert len(_self_ref_errors(result)) >= 1, result["errors"]


# ---------------------------------------------------------------------------
# Transitive self-reference: F -> G -> F
# ---------------------------------------------------------------------------


class TestTransitiveSelfReference:
    def test_emits_self_referential_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        f_id = str(uuid.uuid4())
        g_id = str(uuid.uuid4())
        _seed_function_with_body(
            fn_id=f_id,
            name="Fn_F",
            body_nodes=[_shared_instance(node_id="f-body", function_id=g_id, label="Fn_G")],
        )
        _seed_function_with_body(
            fn_id=g_id,
            name="Fn_G",
            body_nodes=[_shared_instance(node_id="g-body", function_id=f_id, label="Fn_F")],
        )
        test = _test_with_nodes([_shared_instance(node_id="top-1", function_id=f_id, label="Fn_F")])
        result = _validate_test_data(test, context="save")
        assert len(_self_ref_errors(result)) >= 1, result["errors"]

    def test_a_circle_made_only_of_body_blocks_emits_the_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        f_id = str(uuid.uuid4())
        g_id = str(uuid.uuid4())
        _seed_function_with_body(
            fn_id=f_id,
            name="Fn_F",
            body_nodes=[_shared_instance(node_id="f-body", function_id=g_id, label="Fn_G")],
        )
        _seed_function_with_body(
            fn_id=g_id,
            name="Fn_G",
            body_nodes=[_shared_instance(node_id="g-body", function_id=f_id, label="Fn_F")],
        )
        test = _test_with_nodes(
            [_shared_instance(node_id="top-1", function_id=f_id, label="Call_F")]
        )

        errors = _self_ref_errors(_validate_test_data(test, context="save"))

        assert len(errors) == 1, errors
        assert re.fullmatch(
            rf"^Function 'Call_F' cannot be nested inside itself \(composition cycle: "
            rf"{re.escape(f_id)} -> {re.escape(g_id)} -> {re.escape(f_id)}\)$",
            errors[0]["message"],
        ), errors[0]["message"]

    def test_three_link_cycle_a_b_c_a_emits_error(self) -> None:
        """A transitive cycle through 3+ links (A -> B -> C -> A) among
        Published Functions is caught by the recursive composition guard."""
        from wavecore.api.services.tests.service import _validate_test_data

        a_id = str(uuid.uuid4())
        b_id = str(uuid.uuid4())
        c_id = str(uuid.uuid4())
        _seed_function_with_body(
            fn_id=a_id,
            name="Fn_A",
            body_nodes=[_shared_instance(node_id="a-body", function_id=b_id, label="Fn_B")],
        )
        _seed_function_with_body(
            fn_id=b_id,
            name="Fn_B",
            body_nodes=[_shared_instance(node_id="b-body", function_id=c_id, label="Fn_C")],
        )
        _seed_function_with_body(
            fn_id=c_id,
            name="Fn_C",
            body_nodes=[_shared_instance(node_id="c-body", function_id=a_id, label="Fn_A")],
        )
        test = _test_with_nodes([_shared_instance(node_id="top-1", function_id=a_id, label="Fn_A")])
        result = _validate_test_data(test, context="save")
        assert len(_self_ref_errors(result)) >= 1, result["errors"]


# ---------------------------------------------------------------------------
# A normal acyclic nesting is NOT flagged
# ---------------------------------------------------------------------------


class TestAcyclicNestingNotFlagged:
    def test_non_cyclic_reference_chain_has_no_self_ref_error(self) -> None:
        from wavecore.api.services.tests.service import _validate_test_data

        leaf_id = str(uuid.uuid4())
        parent_id = str(uuid.uuid4())
        _seed_function_with_body(fn_id=leaf_id, name="Leaf", body_nodes=[])
        _seed_function_with_body(
            fn_id=parent_id,
            name="Parent",
            body_nodes=[_shared_instance(node_id="p-body", function_id=leaf_id, label="Leaf")],
        )
        test = _test_with_nodes(
            [_shared_instance(node_id="top-1", function_id=parent_id, label="Parent")]
        )
        result = _validate_test_data(test, context="save")
        assert _self_ref_errors(result) == []
