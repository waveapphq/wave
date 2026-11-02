"""Direct unit tests for the Function storage module.

Tests the helpers in `wavecore.api.services.functions._storage`:
- compute_etag: deterministic SHA-256 over canonical JSON
- save_function / load_function / delete_function_file: atomic file IO
- list_function_summaries: directory scan
- set_index_timestamps: sets the created and updated times of an entry index
- validate_structural: required-field, name format, type set, parameter names
- detect_circular_deps: cycle detection over a Function reference index
- load_reference_index: what every stored version of a Function references
- scan_dependents: walks Tests and Functions storage looking for references

Published Functions are stored under
`backend/data/functions/<id>/`. The autouse temp_storage_path
fixture (see backend/tests/conftest.py) redirects the base path to a
per-test temporary directory.
"""

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml

# Anchored regex for the cycle path message: "<id> -> <id> -> ... -> <id>".
_CYCLE_RE = re.compile(r"^[0-9a-fA-F-]+( -> [0-9a-fA-F-]+)+$")


def _published_dir() -> Path:
    """Return the on-disk root for Published Function definitions."""
    from wavecore.api.services.storage_paths import get_base_path

    return get_base_path() / "functions"


def _write_function_file(function_id: str, definition: dict[str, Any]) -> Path:
    """Helper that writes a Function in the multi-version layout by hand.

    Used to set up scenarios where the storage module reads pre-existing data.
    Writes ``index.yaml`` + ``versions/1.0.0.yaml`` per the versioned layout.
    """
    fn_dir = _published_dir() / function_id
    fn_dir.mkdir(parents=True, exist_ok=True)
    versions_dir = fn_dir / "versions"
    versions_dir.mkdir(parents=True, exist_ok=True)
    version = definition.get("version", "1.0.0") or "1.0.0"
    with open(fn_dir / "index.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(
            {
                "id": function_id,
                "name": definition.get("name", ""),
                "latest_version": version,
                "available_versions": [version],
                "created_at": (definition.get("metadata") or {}).get("created_at", ""),
                "updated_at": (definition.get("metadata") or {}).get("updated_at", ""),
            },
            f,
            sort_keys=False,
        )
    body = {
        "inputs": list(definition.get("inputs") or []),
        "outputs": list(definition.get("outputs") or []),
        "dependencies": {
            "functions": list((definition.get("dependencies") or {}).get("functions") or []),
            "plugins": list((definition.get("dependencies") or {}).get("plugins") or []),
        },
        "workflow": dict(definition.get("workflow") or {"nodes": [], "edges": []}),
    }
    metadata = {
        "description": definition.get("description", "") or "",
        "tags": list(definition.get("tags") or []),
        "changelog": "",
        "details": "",
        "published_at": (definition.get("metadata") or {}).get("created_at", ""),
        "published_by": "wave",
    }
    version_path = versions_dir / f"{version}.yaml"
    with open(version_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(
            {"version": version, "definition": body, "metadata": metadata},
            f,
            sort_keys=False,
        )
    return version_path


def _library_block(function_id: str, node_id: str = "call-1") -> dict[str, Any]:
    """A library Function block that calls ``function_id``."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "nodeType": "function",
            "elementType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
        },
    }


def _workflow_calling(*function_ids: str) -> dict[str, Any]:
    """A workflow with one library Function block per id."""
    return {
        "nodes": [
            _library_block(function_id, f"call-{position}")
            for position, function_id in enumerate(function_ids, start=1)
        ],
        "edges": [],
    }


# ---------------------------------------------------------------------------
# compute_etag
# ---------------------------------------------------------------------------


class TestComputeEtag:
    """Verifies that compute_etag is a deterministic hash over canonical JSON."""

    def test_returns_64_hex_chars(self) -> None:
        from wavecore.api.services.functions._storage import compute_etag

        etag = compute_etag({"id": "x", "name": "y"})
        assert re.fullmatch(r"[0-9a-f]{64}", etag)

    def test_is_deterministic_for_same_input(self) -> None:
        from wavecore.api.services.functions._storage import compute_etag

        definition = {"id": "abc", "name": "fn", "inputs": [], "outputs": []}
        assert compute_etag(definition) == compute_etag(definition)

    def test_is_independent_of_key_order(self) -> None:
        """Canonical JSON sort_keys=True ensures key permutations produce the same hash."""
        from wavecore.api.services.functions._storage import compute_etag

        a = {"id": "x", "name": "fn", "tags": ["a", "b"]}
        b = {"tags": ["a", "b"], "name": "fn", "id": "x"}
        assert compute_etag(a) == compute_etag(b)

    def test_changes_when_content_changes(self) -> None:
        from wavecore.api.services.functions._storage import compute_etag

        a = compute_etag({"id": "x", "name": "fn", "description": ""})
        b = compute_etag({"id": "x", "name": "fn", "description": "different"})
        assert a != b

    def test_changes_when_list_order_changes(self) -> None:
        """List positions are semantically significant (input ordering matters)."""
        from wavecore.api.services.functions._storage import compute_etag

        a = compute_etag({"id": "x", "tags": ["a", "b"]})
        b = compute_etag({"id": "x", "tags": ["b", "a"]})
        assert a != b


# ---------------------------------------------------------------------------
# load_function / delete_function_file / list_function_summaries
# ---------------------------------------------------------------------------


def _persist(fn_id: str, definition: dict) -> None:
    """Persist a full definition via the write-once ``save_new_version`` path."""
    from wavecore.api.services.functions._storage import save_new_version

    md = definition.get("metadata") or {}
    save_new_version(
        fn_id,
        definition.get("version", "1.0.0"),
        definition,
        {
            "description": definition.get("description", ""),
            "tags": definition.get("tags", []),
            "published_at": md.get("created_at", ""),
            "published_by": md.get("author", "wave"),
        },
        name=definition.get("name", ""),
    )


class TestSaveAndLoadFunction:
    """Verifies persistence helpers in `_storage`."""

    def test_save_creates_directory_with_index_and_version_yaml(self) -> None:
        fn_id = str(uuid.uuid4())
        definition = {
            "id": fn_id,
            "name": "my_fn",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
            "metadata": {
                "author": "tester",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        }
        _persist(fn_id, definition)

        index_path = _published_dir() / fn_id / "index.yaml"
        version_path = _published_dir() / fn_id / "versions" / "1.0.0.yaml"
        assert index_path.exists()
        assert version_path.exists()
        with open(index_path, encoding="utf-8") as f:
            index = yaml.safe_load(f)
        assert index["id"] == fn_id
        assert index["name"] == "my_fn"
        assert index["latest_version"] == "1.0.0"

    def test_save_leaves_no_temp_files(self, tmp_path: Path) -> None:
        """Atomic save: no .tmp stragglers remain in the dir after save."""
        fn_id = str(uuid.uuid4())
        definition = {
            "id": fn_id,
            "name": "atomic",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
        }
        _persist(fn_id, definition)
        fn_dir = _published_dir() / fn_id
        for path in fn_dir.rglob("*"):
            assert not path.name.endswith(".tmp"), path

    def test_save_then_load_roundtrips_user_fields(self) -> None:
        """Save then load preserves the user-visible field set (id, name, tags,
        inputs, outputs, dependencies, workflow, version)."""
        from wavecore.api.services.functions._storage import load_function

        fn_id = str(uuid.uuid4())
        definition = {
            "id": fn_id,
            "name": "roundtrip",
            "description": "",
            "tags": ["a", "b"],
            "inputs": [{"name": "x", "type": "integer", "required": True}],
            "outputs": [{"name": "y", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "version": "1.0.0",
            "metadata": {},
        }
        _persist(fn_id, definition)
        loaded, etag = load_function(fn_id)
        assert loaded["id"] == fn_id
        assert loaded["name"] == "roundtrip"
        assert loaded["tags"] == ["a", "b"]
        assert loaded["inputs"][0]["name"] == "x"
        assert loaded["outputs"][0]["name"] == "y"
        assert loaded["version"] == "1.0.0"
        assert len(etag) == 64

    def test_load_raises_lookup_error_when_missing(self) -> None:
        from wavecore.api.services.functions._storage import load_function

        with pytest.raises(LookupError):
            load_function(str(uuid.uuid4()))

    def test_delete_removes_directory(self) -> None:
        from wavecore.api.services.functions._storage import delete_function_file

        fn_id = str(uuid.uuid4())
        _persist(fn_id, {"id": fn_id, "name": "deleteme"})
        assert (_published_dir() / fn_id).exists()
        delete_function_file(fn_id)
        assert not (_published_dir() / fn_id).exists()

    def test_delete_missing_raises_lookup_error(self) -> None:
        from wavecore.api.services.functions._storage import delete_function_file

        with pytest.raises(LookupError):
            delete_function_file(str(uuid.uuid4()))

    def test_list_summaries_empty_when_no_functions(self) -> None:
        from wavecore.api.services.functions._storage import list_function_summaries

        assert list_function_summaries() == []

    def test_list_summaries_returns_one_row_per_function(self) -> None:
        from wavecore.api.services.functions._storage import list_function_summaries

        ids = [str(uuid.uuid4()) for _ in range(3)]
        for i, fn_id in enumerate(ids):
            _persist(
                fn_id,
                {
                    "id": fn_id,
                    "name": f"fn_{i}",
                    "description": "",
                    "tags": [],
                    "metadata": {
                        "created_at": f"2026-01-0{i + 1}T00:00:00Z",
                        "updated_at": f"2026-01-0{i + 1}T00:00:00Z",
                    },
                },
            )
        summaries = list_function_summaries()
        assert len(summaries) == 3
        summary_ids = {row["id"] for row in summaries}
        assert summary_ids == set(ids)
        # Every summary row carries id, name, description, tags, created_at, updated_at.
        for row in summaries:
            for key in ("id", "name", "description", "tags", "created_at", "updated_at"):
                assert key in row, f"missing key {key} in {row}"

    def test_list_summaries_skips_non_directory_entries(self) -> None:
        """A stray file in the functions/ root must not break the listing."""
        from wavecore.api.services.functions._storage import list_function_summaries

        _published_dir().mkdir(parents=True, exist_ok=True)
        (_published_dir() / "stray.txt").write_text("not a function")
        summaries = list_function_summaries()
        assert summaries == []


# ---------------------------------------------------------------------------
# set_index_timestamps
# ---------------------------------------------------------------------------


class TestSetIndexTimestamps:
    """Verifies the setter of an entry index's created and updated times."""

    def test_a_function_without_an_index_raises_lookup_error(self) -> None:
        from wavecore.api.services.functions._storage import set_index_timestamps

        fn_id = str(uuid.uuid4())
        (_published_dir() / fn_id).mkdir(parents=True)

        with pytest.raises(LookupError, match=rf"^Function '{re.escape(fn_id)}' not found$"):
            set_index_timestamps(
                fn_id,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-02T00:00:00Z",
            )


# ---------------------------------------------------------------------------
# validate_structural
# ---------------------------------------------------------------------------


class TestValidateStructural:
    """Verifies structural validation surfaces the exact error strings."""

    def _valid_definition(self) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "name": "good_function",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "metadata": {},
        }

    def test_valid_definition_returns_empty_list(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        assert validate_structural(self._valid_definition()) == []

    def test_missing_name_returns_required_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["name"] = ""
        errors = validate_structural(definition)
        assert "Function name is required" in errors

    def test_name_exceeding_32_chars_returns_too_long_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["name"] = "X" * 33
        errors = validate_structural(definition)
        expected = f"Function name '{'X' * 33}' exceeds 32 characters"
        assert expected in errors

    def test_invalid_input_type_returns_type_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["inputs"] = [
            {
                "name": "x",
                "type": "blob",
                "required": True,
                "default": None,
                "description": "",
            }
        ]
        errors = validate_structural(definition)
        assert "Function input 'x' has invalid type 'blob'" in errors

    def test_invalid_output_type_returns_type_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["outputs"] = [{"name": "y", "type": "blob", "description": ""}]
        errors = validate_structural(definition)
        assert "Function output 'y' has invalid type 'blob'" in errors

    def test_invalid_input_name_returns_name_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["inputs"] = [
            {
                "name": "1bad",
                "type": "string",
                "required": True,
                "default": None,
                "description": "",
            }
        ]
        errors = validate_structural(definition)
        expected = (
            "Function input '1bad' has invalid name; "
            "must match pattern '^[a-zA-Z][a-zA-Z0-9_]*$'"
        )
        assert expected in errors

    def test_invalid_output_name_returns_name_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["outputs"] = [{"name": "1bad", "type": "string", "description": ""}]
        errors = validate_structural(definition)
        expected = (
            "Function output '1bad' has invalid name; "
            "must match pattern '^[a-zA-Z][a-zA-Z0-9_]*$'"
        )
        assert expected in errors

    def test_input_missing_type_returns_missing_type_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["inputs"] = [
            {
                "name": "x",
                "required": True,
                "default": None,
                "description": "",
            }
        ]
        errors = validate_structural(definition)
        assert "Function input 'x' is required and missing a type" in errors

    def test_output_missing_type_returns_missing_type_error(self) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["outputs"] = [{"name": "y", "description": ""}]
        errors = validate_structural(definition)
        assert "Function output 'y' is missing a type" in errors

    @pytest.mark.parametrize(
        "good_type",
        ["string", "integer", "float", "boolean", "array", "map", "table"],
    )
    def test_accepts_all_documented_input_types(self, good_type: str) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["inputs"] = [
            {
                "name": "x",
                "type": good_type,
                "required": False,
                "default": None,
                "description": "",
            }
        ]
        assert validate_structural(definition) == []

    @pytest.mark.parametrize(
        "good_type",
        ["string", "integer", "float", "boolean", "array", "map", "table"],
    )
    def test_accepts_all_documented_output_types(self, good_type: str) -> None:
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["outputs"] = [{"name": "y", "type": good_type, "description": ""}]
        assert validate_structural(definition) == []

    def test_accumulates_multiple_errors(self) -> None:
        """A definition with multiple structural defects returns multiple messages."""
        from wavecore.api.services.functions._storage import validate_structural

        definition = self._valid_definition()
        definition["name"] = ""
        definition["inputs"] = [
            {
                "name": "1bad",
                "type": "string",
                "required": True,
                "default": None,
                "description": "",
            }
        ]
        errors = validate_structural(definition)
        assert len(errors) >= 2


# ---------------------------------------------------------------------------
# detect_circular_deps
# ---------------------------------------------------------------------------


class TestDetectCircularDeps:
    """Verifies cycle detection over a Function reference index."""

    def test_no_dependencies_returns_none(self) -> None:
        from wavecore.api.services.functions._storage import detect_circular_deps

        fn_id = str(uuid.uuid4())
        assert detect_circular_deps(fn_id, {fn_id: set()}) is None

    def test_self_reference_returns_cycle(self) -> None:
        from wavecore.api.services.functions._storage import detect_circular_deps

        fn_id = str(uuid.uuid4())
        cycle = detect_circular_deps(fn_id, {fn_id: {fn_id}})
        assert cycle is not None
        assert _CYCLE_RE.match(cycle)
        # Cycle path always starts and ends with the same id.
        first, last = cycle.split(" -> ")[0], cycle.split(" -> ")[-1]
        assert first == last == fn_id

    def test_two_function_cycle_returns_full_path(self) -> None:
        """A references B, B references A -> cycle path includes both ids."""
        from wavecore.api.services.functions._storage import detect_circular_deps

        a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
        cycle = detect_circular_deps(a_id, {a_id: {b_id}, b_id: {a_id}})
        assert cycle is not None
        assert a_id in cycle and b_id in cycle
        assert cycle.split(" -> ")[0] == cycle.split(" -> ")[-1]

    def test_longer_cycle_returns_full_path(self) -> None:
        """A -> B -> C -> A cycle."""
        from wavecore.api.services.functions._storage import detect_circular_deps

        a_id, b_id, c_id = (str(uuid.uuid4()) for _ in range(3))
        cycle = detect_circular_deps(a_id, {a_id: {b_id}, b_id: {c_id}, c_id: {a_id}})
        assert cycle is not None
        for fid in (a_id, b_id, c_id):
            assert fid in cycle

    def test_acyclic_chain_returns_none(self) -> None:
        """A references B, B references nothing -> no cycle."""
        from wavecore.api.services.functions._storage import detect_circular_deps

        a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
        assert detect_circular_deps(a_id, {a_id: {b_id}, b_id: set()}) is None

    def test_dependency_on_unknown_id_is_ignored(self) -> None:
        """Ids outside the index are skipped; save validation reports them separately."""
        from wavecore.api.services.functions._storage import detect_circular_deps

        a_id = str(uuid.uuid4())
        assert detect_circular_deps(a_id, {a_id: {str(uuid.uuid4())}}) is None

    def test_a_circle_in_the_reference_index_is_found(self) -> None:
        from wavecore.api.services.functions._storage import detect_circular_deps

        a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
        # The stored lists form a circle, so only the index decides the answer.
        for fn_id, name, listed_id in ((a_id, "a", b_id), (b_id, "b", a_id)):
            _write_function_file(
                fn_id,
                {
                    "id": fn_id,
                    "name": name,
                    "dependencies": {"functions": [listed_id], "plugins": []},
                },
            )

        circle = detect_circular_deps(a_id, {a_id: {b_id}, b_id: {a_id}})
        assert circle == f"{a_id} -> {b_id} -> {a_id}"
        assert detect_circular_deps(a_id, {a_id: set(), b_id: set()}) is None


# ---------------------------------------------------------------------------
# load_reference_index
# ---------------------------------------------------------------------------


class TestLoadReferenceIndex:
    """Verifies the index of what every stored version of a Function references."""

    def test_the_index_holds_what_any_version_of_a_function_references(self) -> None:
        from wavecore.api.services.functions._storage import load_reference_index

        a_id, b_id, c_id = (str(uuid.uuid4()) for _ in range(3))
        _persist(b_id, {"id": b_id, "name": "fn_b"})
        _persist(c_id, {"id": c_id, "name": "fn_c"})
        _persist(
            a_id,
            {"id": a_id, "name": "fn_a", "version": "1.0.0", "workflow": _workflow_calling(b_id)},
        )
        _persist(
            a_id,
            {"id": a_id, "name": "fn_a", "version": "1.1.0", "workflow": _workflow_calling(c_id)},
        )

        assert load_reference_index()[a_id] == {b_id, c_id}

    def test_references_below_the_top_level_are_in_the_index(self) -> None:
        from wavecore.api.services.functions._storage import load_reference_index

        a_id, b_id, c_id, d_id = (str(uuid.uuid4()) for _ in range(4))
        local_block = {
            "id": "local-1",
            "type": "workflowNode",
            "data": {
                "label": "Local_1",
                "nodeType": "function",
                "elementType": "function",
                "functionLifecycle": "local",
                "localDefinition": {"name": "Local_1", "workflow": _workflow_calling(b_id)},
            },
        }
        edited_block = _library_block(d_id, "edit-1")
        edited_block["data"]["editMode"] = True
        edited_block["data"]["draft"] = {"name": "fn_d", "workflow": _workflow_calling(c_id)}
        _persist(
            a_id,
            {
                "id": a_id,
                "name": "fn_a",
                "workflow": {"nodes": [local_block, edited_block], "edges": []},
            },
        )

        assert load_reference_index()[a_id] == {b_id, c_id, d_id}

    def test_a_folder_without_an_index_is_skipped(self) -> None:
        from wavecore.api.services.functions._storage import load_reference_index

        a_id, b_id, orphan_id = (str(uuid.uuid4()) for _ in range(3))
        _persist(a_id, {"id": a_id, "name": "fn_a", "workflow": _workflow_calling(b_id)})
        version_path = _write_function_file(
            orphan_id, {"id": orphan_id, "name": "orphan", "workflow": _workflow_calling(a_id)}
        )
        (version_path.parent.parent / "index.yaml").unlink()

        index = load_reference_index()

        assert orphan_id not in index
        assert index[a_id] == {b_id}


# ---------------------------------------------------------------------------
# scan_dependents
# ---------------------------------------------------------------------------


class TestScanDependents:
    """Verifies the dependents scanner walks Tests and Functions for references."""

    def _write_test_with_function_node(self, library_id: str) -> str:
        """Helper that writes a Test fixture referencing a Published Function."""
        from wavecore.api.services.storage_paths import get_tests_storage_path

        test_id = str(uuid.uuid4())
        test_dir = get_tests_storage_path() / test_id
        test_dir.mkdir(parents=True, exist_ok=True)
        test_definition = {
            "id": test_id,
            "name": f"test_{test_id[:8]}",
            "version": "1.0.0",
            "workflow": {
                "nodes": [
                    {
                        "id": str(uuid.uuid4()),
                        "type": "workflowNode",
                        "data": {
                            "nodeType": "function",
                            "elementType": "function",
                            "functionId": library_id,
                            "config": {
                                "values": {},
                                "outputBindings": {},
                                "profileBindings": [],
                            },
                        },
                    }
                ],
                "edges": [],
            },
            "variables": {},
            "metadata": {},
        }
        with open(test_dir / "test.yaml", "w", encoding="utf-8") as f:
            yaml.safe_dump(test_definition, f, sort_keys=False)
        return test_id

    def test_empty_dependents_when_nothing_references(self) -> None:
        from wavecore.api.services.functions._storage import scan_dependents

        result = scan_dependents(str(uuid.uuid4()))
        assert result == {"tests": [], "functions": []}

    def test_finds_test_that_references_function(self) -> None:
        from wavecore.api.services.functions._storage import scan_dependents

        library_id = str(uuid.uuid4())
        test_id = self._write_test_with_function_node(library_id)
        result = scan_dependents(library_id)
        assert any(t["id"] == test_id for t in result["tests"])
        assert result["functions"] == []

    def test_finds_function_that_references_function(self) -> None:
        from wavecore.api.services.functions._storage import scan_dependents

        callee_id = str(uuid.uuid4())
        caller_id = str(uuid.uuid4())
        _write_function_file(
            caller_id,
            {
                "id": caller_id,
                "name": "caller",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": _workflow_calling(callee_id),
                "metadata": {},
            },
        )
        result = scan_dependents(callee_id)
        assert any(fn["id"] == caller_id for fn in result["functions"])
