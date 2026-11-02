"""UUID-collision safety on Function import (REQ-3.1.2.5).

A file whose ``id`` already belongs to a different library entry must be treated
as a resolvable import conflict on the id axis, exactly like a name conflict, so
a manual file edit can never silently rename an existing Function and inject a
version into it.

Contract:
- ``validate_import`` annotates each item with ``conflict_reason`` of
  ``name`` / ``id`` / ``both`` (absent for a clean entry).
- ``rename`` of an id-colliding entry mints a FRESH uuid and leaves the
  pre-existing entry's name + available versions untouched.
- ``overwrite`` of an id-colliding entry targets the colliding id.
- ``skip`` (or no supplied resolution) leaves the library unchanged and reports
  ``UUID '<id>' already exists in the library``.
- A renamed dependency inside a ZIP batch is remapped in its dependents
  (``dependencies.functions`` and every in-body ``functionId``).
"""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from typing import Any

import pytest
import yaml

from wavecore.api.services.functions import _storage, import_export

pytestmark = pytest.mark.usefixtures("temp_storage_path")


# ---------------------------------------------------------------------------
# Builders / seeding
# ---------------------------------------------------------------------------


def _seed_existing(fn_id: str, name: str, version: str = "1.0.0") -> None:
    """Publish a single-version library entry with a known id + name."""
    body = {
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    metadata = {
        "description": "original",
        "tags": [],
        "changelog": "seed",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }
    _storage.save_new_version(fn_id, version, body, metadata, name=name)


def _doc(name: str, fn_id: str, version: str = "1.0.0", **extra: Any) -> dict[str, Any]:
    """Build an importable single-Function document."""
    doc: dict[str, Any] = {
        "id": fn_id,
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
        "version": version,
    }
    doc.update(extra)
    return doc


def _function_node(library_id: str, node_id: str = "node-dep-1") -> dict[str, Any]:
    """A shared-Function body node referencing ``library_id``."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": library_id,
            "functionVersion": "1.0.0",
            "label": "calls dependency",
        },
    }


def _local_node(library_id: str) -> dict[str, Any]:
    """A Local Function block whose body and dependency list name ``library_id``."""
    return {
        "id": "node-local",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "label": "local step",
            "localDefinition": {
                "name": "local step",
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [library_id], "plugins": []},
                "workflow": {"nodes": [_function_node(library_id, "node-in-local")], "edges": []},
            },
        },
    }


def _editing_node(library_id: str) -> dict[str, Any]:
    """An edit-mode block of ``library_id`` whose draft calls it too."""
    node = _function_node(library_id, "node-editing")
    node["data"]["editMode"] = True
    node["data"]["upstreamLink"] = {"functionId": library_id, "sourceVersion": "1.0.0"}
    node["data"]["draft"] = {
        "workflow": {"nodes": [_function_node(library_id, "node-in-draft")], "edges": []}
    }
    return node


def _yaml_bytes(doc: dict[str, Any]) -> bytes:
    return yaml.safe_dump(doc, sort_keys=False).encode()


def _zip_bytes(docs: dict[str, dict[str, Any]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, doc in docs.items():
            zf.writestr(filename, yaml.safe_dump(doc, sort_keys=False))
    buf.seek(0)
    return buf.read()


def _validate(doc: dict[str, Any], filename: str = "fn.yaml") -> dict[str, Any]:
    return import_export.validate_import(_yaml_bytes(doc), filename)


def _item_for(result: dict[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in result["items"] if item["name"] == name)


def _import(
    doc: dict[str, Any], filename: str = "fn.yaml", resolutions: dict[str, str] | None = None
) -> dict[str, Any]:
    return import_export.import_functions(_yaml_bytes(doc), filename, resolutions)


# ---------------------------------------------------------------------------
# validate_import annotates the collided axis
# ---------------------------------------------------------------------------


class TestValidateDetectsCollisionReason:
    def test_id_collision_only_marks_reason_id(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Occupied")
        # Fresh name, but the incoming id collides with the existing entry.
        result = _validate(_doc(name="Newcomer", fn_id=existing))
        item = _item_for(result, "Newcomer")
        assert item["status"] == "conflict"
        assert item["conflict_reason"] == "id"

    def test_name_collision_only_marks_reason_name(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Shared")
        # Same name, but a different (fresh) id -> a pure name collision.
        result = _validate(_doc(name="Shared", fn_id=str(uuid.uuid4())))
        item = _item_for(result, "Shared")
        assert item["status"] == "conflict"
        assert item["conflict_reason"] == "name"

    def test_name_and_id_collision_marks_reason_both(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Both")
        result = _validate(_doc(name="Both", fn_id=existing))
        item = _item_for(result, "Both")
        assert item["status"] == "conflict"
        assert item["conflict_reason"] == "both"

    def test_clean_entry_has_no_conflict_reason(self) -> None:
        _seed_existing(str(uuid.uuid4()), name="Occupied")
        result = _validate(_doc(name="Totally New", fn_id=str(uuid.uuid4())))
        item = _item_for(result, "Totally New")
        assert item["status"] == "ok"
        assert item.get("conflict_reason") is None

    def test_a_name_that_differs_only_by_case_is_a_conflict(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Shared")
        result = _validate(_doc(name="shared", fn_id=str(uuid.uuid4())))
        item = _item_for(result, "shared")
        assert item["status"] == "conflict"
        assert item["conflict_reason"] == "name"
        assert item["existing_id"] == existing


# ---------------------------------------------------------------------------
# rename mints a fresh uuid and never touches the colliding entry
# ---------------------------------------------------------------------------


class TestRenameMintsFreshId:
    def test_rename_resolution_mints_new_uuid(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        result = _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "rename"},
        )
        assert result["total_imported"] == 1, result
        entry = result["imported"][0]
        assert entry["action"] == "renamed"
        assert entry["id"] != existing

    def test_colliding_rename_leaves_existing_untouched(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "rename"},
        )
        # The pre-existing entry keeps its name and its single version; the
        # incoming 2.0.0 must NOT have been injected into it.
        definition, _etag = _storage.load_function(existing)
        assert definition["name"] == "Original"
        assert set(definition["available_versions"]) == {"1.0.0"}

    def test_renamed_copy_is_a_separate_function(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        result = _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "rename"},
        )
        new_id = result["imported"][0]["id"]
        assert new_id != existing
        definition, _etag = _storage.load_function(new_id)
        assert definition["name"] == "Imported"
        assert set(definition["available_versions"]) == {"2.0.0"}


# ---------------------------------------------------------------------------
# overwrite targets the colliding id
# ---------------------------------------------------------------------------


class TestOverwriteTargetsCollidingId:
    def test_overwrite_resolution_reports_overwritten_against_colliding_id(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        result = _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "overwrite"},
        )
        assert result["total_imported"] == 1, result
        entry = result["imported"][0]
        assert entry["action"] == "overwritten"
        assert entry["id"] == existing

    def test_overwrite_does_not_create_a_second_entry(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "overwrite"},
        )
        summaries = _storage.list_function_summaries()
        assert [s["id"] for s in summaries] == [existing]

    def test_overwrite_is_blocked_when_the_id_and_the_name_point_at_two_entries(self) -> None:
        id_holder, name_holder = str(uuid.uuid4()), str(uuid.uuid4())
        _seed_existing(id_holder, name="Alpha", version="1.0.0")
        _seed_existing(name_holder, name="Beta", version="1.0.0")
        result = _import(
            _doc(name="Beta", fn_id=id_holder, version="2.0.0"),
            resolutions={"Beta": "overwrite"},
        )
        assert result["total_imported"] == 0, result
        assert [entry["name"] for entry in result["skipped"]] == ["Beta"]
        reason = result["skipped"][0]["reason"]
        assert re.fullmatch(r"^Another Function here has this name$", reason), reason
        for function_id, name in ((id_holder, "Alpha"), (name_holder, "Beta")):
            definition, _etag = _storage.load_function(function_id)
            assert definition["name"] == name
            assert set(definition["available_versions"]) == {"1.0.0"}


# ---------------------------------------------------------------------------
# skip / unresolved id collision leaves the library unchanged
# ---------------------------------------------------------------------------


class TestSkipLeavesLibraryUnchanged:
    _UUID_REASON = r"^UUID '{id}' already exists in the library$"

    def test_skip_resolution_reports_uuid_reason(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        result = _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "skip"},
        )
        assert result["total_imported"] == 0, result
        assert result["total_skipped"] == 1
        reason = result["skipped"][0]["reason"]
        assert re.match(self._UUID_REASON.format(id=re.escape(existing)), reason), reason

    def test_unresolved_id_collision_is_skipped_with_uuid_reason(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        result = _import(_doc(name="Imported", fn_id=existing, version="2.0.0"))
        assert result["total_imported"] == 0, result
        assert result["total_skipped"] == 1
        reason = result["skipped"][0]["reason"]
        assert re.match(self._UUID_REASON.format(id=re.escape(existing)), reason), reason

    def test_skip_leaves_existing_entry_unchanged(self) -> None:
        existing = str(uuid.uuid4())
        _seed_existing(existing, name="Original", version="1.0.0")
        _import(
            _doc(name="Imported", fn_id=existing, version="2.0.0"),
            resolutions={"Imported": "skip"},
        )
        definition, _etag = _storage.load_function(existing)
        assert definition["name"] == "Original"
        assert set(definition["available_versions"]) == {"1.0.0"}


# ---------------------------------------------------------------------------
# intra-batch dependency remap on rename
# ---------------------------------------------------------------------------


class TestIntraBatchDependencyRemap:
    def _batch(self, collide_id: str, dependent_id: str) -> bytes:
        dependency = _doc(name="DepFn", fn_id=collide_id, version="1.0.0")
        dependent = _doc(
            name="MainFn",
            fn_id=dependent_id,
            version="1.0.0",
            dependencies={"functions": [collide_id], "plugins": []},
            workflow={"nodes": [_function_node(collide_id)], "edges": []},
        )
        return _zip_bytes({"main.yaml": dependent, "dep.yaml": dependency})

    def test_renamed_dependency_is_remapped_in_dependent_deps(self) -> None:
        collide_id = str(uuid.uuid4())
        dependent_id = str(uuid.uuid4())
        _seed_existing(collide_id, name="Occupied", version="1.0.0")
        result = import_export.import_functions(
            self._batch(collide_id, dependent_id), "batch.zip", {"DepFn": "rename"}
        )
        assert result["total_imported"] == 2, result
        dep_entry = next(e for e in result["imported"] if e["name"] == "DepFn")
        assert dep_entry["action"] == "renamed"
        new_dep_id = dep_entry["id"]
        assert new_dep_id != collide_id
        definition, _etag = _storage.load_function(dependent_id)
        assert definition["dependencies"]["functions"] == [new_dep_id]

    def test_renamed_dependency_is_remapped_in_body_node(self) -> None:
        collide_id = str(uuid.uuid4())
        dependent_id = str(uuid.uuid4())
        _seed_existing(collide_id, name="Occupied", version="1.0.0")
        result = import_export.import_functions(
            self._batch(collide_id, dependent_id), "batch.zip", {"DepFn": "rename"}
        )
        assert result["total_imported"] == 2, result
        new_dep_id = next(e for e in result["imported"] if e["name"] == "DepFn")["id"]
        definition, _etag = _storage.load_function(dependent_id)
        node_data = definition["workflow"]["nodes"][0]["data"]
        assert node_data["functionId"] == new_dep_id

    def test_a_caller_listed_before_its_renamed_callee_follows_it(self) -> None:
        collide_id = str(uuid.uuid4())
        dependent_id = str(uuid.uuid4())
        _seed_existing(collide_id, name="Occupied", version="1.0.0")
        dependent = _doc(
            name="MainFn",
            fn_id=dependent_id,
            workflow={"nodes": [_function_node(collide_id)], "edges": []},
        )
        dependency = _doc(name="DepFn", fn_id=collide_id)
        result = import_export.import_functions(
            _zip_bytes({"main.yaml": dependent, "dep.yaml": dependency}),
            "batch.zip",
            {"DepFn": "rename"},
        )
        assert result["total_imported"] == 2, result
        new_dep_id = next(e for e in result["imported"] if e["name"] == "DepFn")["id"]
        assert new_dep_id != collide_id
        definition, _etag = _storage.load_function(dependent_id)
        assert definition["workflow"]["nodes"][0]["data"]["functionId"] == new_dep_id

    def test_the_rewrite_reaches_every_depth(self) -> None:
        collide_id = str(uuid.uuid4())
        dependent_id = str(uuid.uuid4())
        _seed_existing(collide_id, name="Occupied", version="1.0.0")
        dependency = _doc(name="DepFn", fn_id=collide_id)
        dependent = _doc(
            name="MainFn",
            fn_id=dependent_id,
            workflow={"nodes": [_local_node(collide_id), _editing_node(collide_id)], "edges": []},
        )
        result = import_export.import_functions(
            _zip_bytes({"dep.yaml": dependency, "main.yaml": dependent}),
            "batch.zip",
            {"DepFn": "rename"},
        )
        assert result["total_imported"] == 2, result
        new_dep_id = next(e for e in result["imported"] if e["name"] == "DepFn")["id"]
        assert new_dep_id != collide_id
        definition, _etag = _storage.load_function(dependent_id)
        nodes = {node["id"]: node["data"] for node in definition["workflow"]["nodes"]}
        local = nodes["node-local"]["localDefinition"]
        assert local["workflow"]["nodes"][0]["data"]["functionId"] == new_dep_id
        assert local["dependencies"]["functions"] == [new_dep_id]
        editing = nodes["node-editing"]
        assert editing["draft"]["workflow"]["nodes"][0]["data"]["functionId"] == new_dep_id
        assert editing["upstreamLink"]["functionId"] == new_dep_id
