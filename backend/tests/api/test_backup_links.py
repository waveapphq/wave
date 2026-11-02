"""The id rewrite of every link a restored item holds (REQ-5.2.4.9.5)."""

import copy
from typing import Any

import pytest

from wavecore.api.services.backup import links

_STAMP = "2026-09-01T08:00:00+00:00"


def _block(node_id: str, profile_ids: tuple[str, ...] = (), **data: Any) -> dict[str, Any]:
    config = {
        "values": {},
        "outputBindings": {},
        "profileBindings": [{"profileId": profile_id, "alias": "db"} for profile_id in profile_ids],
    }
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {"label": node_id, **data, "config": config},
    }


def _log(node_id: str, *profile_ids: str) -> dict[str, Any]:
    return _block(node_id, profile_ids, elementType="log", nodeType="plugin")


def _library(node_id: str, function_id: str, **extra: Any) -> dict[str, Any]:
    return _block(
        node_id,
        elementType="function",
        nodeType="function",
        functionLifecycle="shared",
        functionId=function_id,
        functionVersion="1.0.0",
        **extra,
    )


def _body(nodes: list[dict[str, Any]], functions: list[str] | None = None) -> dict[str, Any]:
    return {
        "name": "Body",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": functions or [], "plugins": []},
        "workflow": {"nodes": nodes, "edges": []},
    }


def _local(
    node_id: str, nodes: list[dict[str, Any]], functions: list[str] | None = None
) -> dict[str, Any]:
    return _block(
        node_id,
        elementType="function",
        nodeType="function",
        functionLifecycle="local",
        localDefinition=_body(nodes, functions),
    )


def _editing(node_id: str, function_id: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    return _library(
        node_id,
        function_id,
        editMode=True,
        upstreamLink={"functionId": function_id, "sourceVersion": "1.0.0"},
        draft=_body(nodes),
    )


def _nesting(holder: str, nodes: list[dict[str, Any]]) -> dict[str, Any]:
    """A block that nests the given blocks in its Local body or in its draft."""
    if holder == "localDefinition":
        return _local("outer", nodes)
    return _editing("outer", "fn-outer", nodes)


def _workflow(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {"nodes": list(nodes), "edges": []}


def _linked_everywhere(function_id: str, profile_id: str) -> dict[str, Any]:
    """One Function id and one profile id in every place a workflow can hold them."""
    return _workflow(
        _library("top", function_id),
        _log("bound", profile_id),
        _local(
            "local",
            [_library("in-local", function_id), _log("bound-in-local", profile_id)],
            functions=[function_id],
        ),
        _editing(
            "editing",
            function_id,
            [_library("in-draft", function_id), _log("bound-in-draft", profile_id)],
        ),
    )


def _test_document(workflow: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "id": "test-1",
        "name": "Checkout",
        "version": "1.0.0",
        "description": "",
        "workflow": workflow,
        "variables": {},
        "metadata": {},
        "created_at": _STAMP,
        "updated_at": _STAMP,
        **extra,
    }


def _version_record(version: str, workflow: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": version,
        "definition": {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": ["log"]},
            "workflow": workflow,
        },
        "metadata": {"description": "", "tags": [], "published_at": _STAMP, "published_by": "wave"},
    }


def _function_document(latest: dict[str, Any], older: dict[str, Any]) -> dict[str, Any]:
    """A Function export document with two versions, newest first."""
    return {
        "id": "fn-1",
        "name": "Calc",
        "version": "1.1.0",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": ["log"]},
        "workflow": copy.deepcopy(latest),
        "available_versions": ["1.1.0", "1.0.0"],
        "metadata": {"author": "wave", "created_at": _STAMP, "updated_at": _STAMP},
        "versions": [_version_record("1.1.0", latest), _version_record("1.0.0", older)],
    }


def _profile_document(environment_values: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "profile-1",
        "name": "bk-profile",
        "type": "custom",
        "config": {"host": "base.example"},
        "environment_values": environment_values,
        "tags": [],
        "created_at": _STAMP,
        "updated_at": _STAMP,
    }


def _suite_document(tests: list[str]) -> dict[str, Any]:
    return {
        "id": "suite-1",
        "name": "bk-suite",
        "version": "1.0.0",
        "description": "",
        "tests": tests,
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": _STAMP,
        "updated_at": _STAMP,
    }


def _regression_document(suites: list[str], **extra: Any) -> dict[str, Any]:
    return {
        "id": "regression-1",
        "name": "bk-regression",
        "version": "1.1.0",
        "description": "",
        "suites": suites,
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": _STAMP,
        "updated_at": _STAMP,
        **extra,
    }


def _history_row(
    version: str, suites: list[str] | None = None, changes: str = "Update"
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "version": version,
        "created_at": _STAMP,
        "created_by": "system",
        "changes": changes,
    }
    if suites is not None:
        row["snapshot"] = {"description": "", "suites": suites, "variables": {}}
    return row


def _nodes(document: dict[str, Any]) -> list[dict[str, Any]]:
    return document["workflow"]["nodes"]


def _nested(block: dict[str, Any], holder: str) -> list[dict[str, Any]]:
    return block["data"][holder]["workflow"]["nodes"]


def _bindings(block: dict[str, Any]) -> list[dict[str, Any]]:
    return block["data"]["config"]["profileBindings"]


class TestRemapTest:
    """links.remap_test: the Function ids and the profile ids of a Test."""

    def test_a_function_id_at_the_top_level_follows_the_map(self) -> None:
        document = _test_document(_workflow(_library("call", "fn-old")))

        result = links.remap_test(document, function_ids={"fn-old": "fn-new"}, profile_ids={})

        assert _nodes(result)[0]["data"]["functionId"] == "fn-new"

    def test_a_function_id_inside_a_local_body_follows_the_map(self) -> None:
        document = _test_document(_workflow(_local("local", [_library("inner", "fn-old")])))

        result = links.remap_test(document, function_ids={"fn-old": "fn-new"}, profile_ids={})

        inner = _nested(_nodes(result)[0], "localDefinition")[0]
        assert inner["data"]["functionId"] == "fn-new"

    def test_a_function_id_inside_a_draft_follows_the_map(self) -> None:
        editing = _editing("editing", "fn-edit", [_library("inner", "fn-old")])
        document = _test_document(_workflow(editing))

        result = links.remap_test(document, function_ids={"fn-old": "fn-new"}, profile_ids={})

        inner = _nested(_nodes(result)[0], "draft")[0]
        assert inner["data"]["functionId"] == "fn-new"

    def test_the_upstream_link_follows_the_map(self) -> None:
        document = _test_document(_workflow(_editing("editing", "fn-old", [])))

        result = links.remap_test(document, function_ids={"fn-old": "fn-new"}, profile_ids={})

        assert _nodes(result)[0]["data"]["upstreamLink"] == {
            "functionId": "fn-new",
            "sourceVersion": "1.0.0",
        }

    def test_a_local_definitions_dependency_list_follows_the_map(self) -> None:
        local = _local("local", [], functions=["fn-old", "fn-kept"])
        document = _test_document(_workflow(local))

        result = links.remap_test(document, function_ids={"fn-old": "fn-new"}, profile_ids={})

        dependencies = _nodes(result)[0]["data"]["localDefinition"]["dependencies"]
        assert dependencies["functions"] == ["fn-new", "fn-kept"]

    def test_a_profile_id_in_a_block_binding_follows_the_map(self) -> None:
        document = _test_document(_workflow(_log("bound", "p-old")))

        result = links.remap_test(document, function_ids={}, profile_ids={"p-old": "p-new"})

        assert _bindings(_nodes(result)[0]) == [{"profileId": "p-new", "alias": "db"}]

    @pytest.mark.parametrize("holder", ["localDefinition", "draft"])
    def test_a_profile_id_below_the_top_level_follows_the_map(self, holder: str) -> None:
        document = _test_document(_workflow(_nesting(holder, [_log("inner", "p-old")])))

        result = links.remap_test(document, function_ids={}, profile_ids={"p-old": "p-new"})

        inner = _nested(_nodes(result)[0], holder)[0]
        assert _bindings(inner) == [{"profileId": "p-new", "alias": "db"}]

    def test_ids_outside_the_maps_are_left(self) -> None:
        document = _test_document(_linked_everywhere("fn-kept", "p-kept"))

        result = links.remap_test(
            document, function_ids={"fn-old": "fn-new"}, profile_ids={"p-old": "p-new"}
        )

        assert result == _test_document(_linked_everywhere("fn-kept", "p-kept"))

    def test_a_copy_comes_back_and_breadcrumbs_are_left(self) -> None:
        document = _test_document(
            _linked_everywhere("id-old", "id-old"), metadata={"cloned_from": "id-old"}
        )
        before = copy.deepcopy(document)

        result = links.remap_test(
            document, function_ids={"id-old": "id-new"}, profile_ids={"id-old": "id-new"}
        )

        assert document == before
        assert result == _test_document(
            _linked_everywhere("id-new", "id-new"), metadata={"cloned_from": "id-old"}
        )


class TestRemapFunctionDocument:
    """links.remap_function_document: the profile ids of a Function export document."""

    def test_profile_ids_in_every_version_follow_the_map(self) -> None:
        document = _function_document(
            _linked_everywhere("fn-dep", "p-old"), _linked_everywhere("fn-dep", "p-older")
        )

        result = links.remap_function_document(
            document, profile_ids={"p-old": "p-new", "p-older": "p-newer"}
        )

        assert result["workflow"] == _linked_everywhere("fn-dep", "p-new")
        assert [record["definition"]["workflow"] for record in result["versions"]] == [
            _linked_everywhere("fn-dep", "p-new"),
            _linked_everywhere("fn-dep", "p-newer"),
        ]

    def test_function_ids_are_left_as_they_are(self) -> None:
        body = _linked_everywhere("fn-dep", "p-kept")
        document = _function_document(body, copy.deepcopy(body))
        document["dependencies"]["functions"] = ["fn-dep"]
        expected = copy.deepcopy(document)

        result = links.remap_function_document(
            document, profile_ids={"fn-dep": "changed", "fn-1": "changed"}
        )

        assert result == expected

    def test_a_copy_comes_back(self) -> None:
        document = _function_document(
            _linked_everywhere("fn-dep", "p-old"), _linked_everywhere("fn-dep", "p-old")
        )
        before = copy.deepcopy(document)

        result = links.remap_function_document(document, profile_ids={"p-old": "p-new"})

        assert document == before
        assert result == _function_document(
            _linked_everywhere("fn-dep", "p-new"), _linked_everywhere("fn-dep", "p-new")
        )


class TestRemapProfile:
    """links.remap_profile: the environment ids that key a profile's values."""

    def test_the_environment_keys_follow_the_map(self) -> None:
        document = _profile_document({"env-1": {"host": "one"}, "env-2": {"host": "two"}})

        result = links.remap_profile(
            document, environment_ids={"env-1": "env-here-1", "env-2": "env-here-2"}
        )

        assert result["environment_values"] == {
            "env-here-1": {"host": "one"},
            "env-here-2": {"host": "two"},
        }

    def test_a_key_outside_the_map_is_left(self) -> None:
        document = _profile_document({"env-1": {"host": "one"}, "env-kept": {"host": "two"}})

        result = links.remap_profile(document, environment_ids={"env-1": "env-here-1"})

        assert result["environment_values"] == {
            "env-here-1": {"host": "one"},
            "env-kept": {"host": "two"},
        }


class TestRemapSuite:
    """links.remap_suite: the Tests of a Suite."""

    def test_the_tests_follow_the_map_in_order(self) -> None:
        document = _suite_document(["test-2", "test-1", "test-3"])

        result = links.remap_suite(
            document,
            test_ids={"test-1": "here-1", "test-2": "here-2", "test-3": "here-3"},
        )

        assert result["tests"] == ["here-2", "here-1", "here-3"]

    def test_a_test_id_outside_the_map_is_left(self) -> None:
        document = _suite_document(["test-1", "test-gone", "test-2"])

        result = links.remap_suite(document, test_ids={"test-1": "here-1", "test-2": "here-2"})

        assert result["tests"] == ["here-1", "test-gone", "here-2"]


class TestRemapRegression:
    """links.remap_regression: the Suites of a Regression and of its history."""

    def test_the_suites_follow_the_map(self) -> None:
        document = _regression_document(["suite-2", "suite-1"])

        result = links.remap_regression(
            document, [], suite_ids={"suite-1": "here-1", "suite-2": "here-2"}
        )

        assert isinstance(result, tuple)
        remapped, _history = result
        assert remapped["suites"] == ["here-2", "here-1"]

    def test_the_history_snapshots_follow_the_map(self) -> None:
        history = [
            _history_row("1.1.0", ["suite-2", "suite-1"]),
            _history_row("1.0.1"),
            _history_row("1.0.0", ["suite-1"]),
        ]

        _document, rows = links.remap_regression(
            _regression_document(["suite-2", "suite-1"]),
            history,
            suite_ids={"suite-1": "here-1", "suite-2": "here-2"},
        )

        assert rows == [
            _history_row("1.1.0", ["here-2", "here-1"]),
            _history_row("1.0.1"),
            _history_row("1.0.0", ["here-1"]),
        ]

    def test_both_values_are_copies_and_history_text_is_left(self) -> None:
        document = _regression_document(["suite-1"], metadata={"cloned_from": "suite-1"})
        history = [_history_row("1.1.0", ["suite-1"], changes="Added suite suite-1")]
        document_before = copy.deepcopy(document)
        history_before = copy.deepcopy(history)

        remapped, rows = links.remap_regression(document, history, suite_ids={"suite-1": "here-1"})

        assert document == document_before
        assert history == history_before
        assert remapped == _regression_document(["here-1"], metadata={"cloned_from": "suite-1"})
        assert rows == [_history_row("1.1.0", ["here-1"], changes="Added suite suite-1")]
