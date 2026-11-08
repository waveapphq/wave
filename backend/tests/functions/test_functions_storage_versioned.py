"""Direct unit tests for the multi-version Function storage layer (REQ-3.1.2.2).

Tests the helpers in `wavecore.api.services.functions._storage`:

- save_new_version(function_id, version, definition, metadata): write a new
  version file + update the index
- load_version(function_id, version): read one version
- list_versions(function_id): ordered version entries from the index
- load_function(function_id): returns the LATEST version

Each Published Function lives under:

    <base>/functions/<id>/index.yaml
    <base>/functions/<id>/versions/<X.Y.Z>.yaml

`index.yaml` carries the per-entry summary (id, name, latest_version,
available_versions, timestamps). `versions/<X.Y.Z>.yaml` carries the
per-version definition + metadata block.

The single-file `<base>/functions/<id>/function.yaml` layout is ignored on
read (no migration).

The autouse `temp_storage_path` fixture redirects the base path to a per-test
tmp directory so disk IO is isolated.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml

# Anchored regex helpers for the error messages.
VERSION_NOT_FOUND_RE = re.compile(r"^Function '[0-9a-fA-F-]+' version '\d+\.\d+\.\d+' not found$")


def _published_dir() -> Path:
    """Return the on-disk root for Published Function definitions."""
    from wavecore.api.services.storage_paths import get_base_path

    return get_base_path() / "functions"


def _make_definition(**overrides: Any) -> dict[str, Any]:
    """Build a complete, valid definition body for a version yaml.

    The version yaml's `definition` block carries workflow + inputs + outputs +
    dependencies. Per-version metadata (description, tags, changelog, details)
    is stored in the version yaml's separate `metadata` block, NOT inside the
    definition itself.
    """
    definition: dict[str, Any] = {
        "inputs": overrides.pop("inputs", []),
        "outputs": overrides.pop("outputs", []),
        "dependencies": overrides.pop("dependencies", {"functions": [], "plugins": []}),
        "workflow": overrides.pop("workflow", {"nodes": [], "edges": []}),
    }
    definition.update(overrides)
    return definition


def _make_metadata(**overrides: Any) -> dict[str, Any]:
    """Build a per-version metadata block.

    Fields: description, tags, changelog, details, published_at, published_by.
    """
    metadata: dict[str, Any] = {
        "description": overrides.pop("description", ""),
        "tags": overrides.pop("tags", []),
        "changelog": overrides.pop("changelog", ""),
        "details": overrides.pop("details", ""),
        "published_at": overrides.pop("published_at", "2026-01-01T00:00:00Z"),
        "published_by": overrides.pop("published_by", "wave"),
    }
    metadata.update(overrides)
    return metadata


def _library_block(node_id: str, function_id: str) -> dict[str, Any]:
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


def _stored_dependency_list(function_id: str, version: str) -> list[str]:
    """The ``dependencies.functions`` list of one version file on disk."""
    path = _published_dir() / function_id / "versions" / f"{version}.yaml"
    with open(path, encoding="utf-8") as f:
        payload = yaml.safe_load(f)
    return list(payload["definition"]["dependencies"]["functions"])


# ---------------------------------------------------------------------------
# save_new_version - happy path
# ---------------------------------------------------------------------------


class TestSaveNewVersionHappyPath:
    """First-time publish of a Function: index + versions/<v>.yaml created."""

    def test_first_version_creates_index_yaml(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="first cut"),
            name="greet",
        )
        index_path = _published_dir() / fn_id / "index.yaml"
        assert index_path.exists()
        with open(index_path, encoding="utf-8") as f:
            index = yaml.safe_load(f)
        assert index["id"] == fn_id
        assert index["name"] == "greet"
        assert index["latest_version"] == "1.0.0"
        assert index["available_versions"] == ["1.0.0"]

    def test_first_version_creates_versions_directory_with_yaml(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(workflow={"nodes": [], "edges": []}),
            _make_metadata(),
            name="greet",
        )
        version_path = _published_dir() / fn_id / "versions" / "1.0.0.yaml"
        assert version_path.exists()
        with open(version_path, encoding="utf-8") as f:
            payload = yaml.safe_load(f)
        # The version file is fully self-describing.
        assert payload["version"] == "1.0.0"
        assert "definition" in payload
        assert "metadata" in payload

    def test_second_version_appends_to_available_versions(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")
        save_new_version(fn_id, "1.1.0", _make_definition(), _make_metadata(), name="greet")
        index = yaml.safe_load((_published_dir() / fn_id / "index.yaml").read_text())
        # available_versions is ordered most-recent-first.
        assert index["available_versions"] == ["1.1.0", "1.0.0"]
        assert index["latest_version"] == "1.1.0"

    def test_third_version_keeps_ordering_most_recent_first(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        for v in ("1.0.0", "1.1.0", "2.0.0"):
            save_new_version(fn_id, v, _make_definition(), _make_metadata(), name="greet")
        index = yaml.safe_load((_published_dir() / fn_id / "index.yaml").read_text())
        assert index["available_versions"] == ["2.0.0", "1.1.0", "1.0.0"]
        assert index["latest_version"] == "2.0.0"

    def test_prerelease_version_saves_and_release_outranks_it_as_latest(self) -> None:
        # A pre-release version is accepted (full semver 2.0.0) and is
        # ordered just below its release, so the release remains `latest`.
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "2.0.0-dev1", _make_definition(), _make_metadata(), name="greet")
        save_new_version(fn_id, "2.0.0", _make_definition(), _make_metadata(), name="greet")
        index = yaml.safe_load((_published_dir() / fn_id / "index.yaml").read_text())
        assert index["latest_version"] == "2.0.0"
        assert index["available_versions"] == ["2.0.0", "2.0.0-dev1"]

    def test_publishing_older_version_after_newer_keeps_latest_as_newest(
        self,
    ) -> None:
        """Publishing 1.0.1 after 2.0.0 must not regress `latest_version`.

        Per the design's "latest is the highest version that has been
        published, not literally the last call". `latest_version` should
        always reflect the highest semver.
        """
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "2.0.0", _make_definition(), _make_metadata(), name="greet")
        save_new_version(fn_id, "1.0.1", _make_definition(), _make_metadata(), name="greet")
        index = yaml.safe_load((_published_dir() / fn_id / "index.yaml").read_text())
        assert index["latest_version"] == "2.0.0"
        # Both versions remain available; ordering reflects semver, not call order.
        assert "2.0.0" in index["available_versions"]
        assert "1.0.1" in index["available_versions"]

    def test_each_version_file_is_independent(self) -> None:
        """Each version yaml stores its own metadata; changes do not bleed across files."""
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="first description", changelog="initial"),
            name="greet",
        )
        save_new_version(
            fn_id,
            "1.1.0",
            _make_definition(),
            _make_metadata(description="second description", changelog="added optional input"),
            name="greet",
        )
        v1 = yaml.safe_load((_published_dir() / fn_id / "versions" / "1.0.0.yaml").read_text())
        v2 = yaml.safe_load((_published_dir() / fn_id / "versions" / "1.1.0.yaml").read_text())
        assert v1["metadata"]["description"] == "first description"
        assert v2["metadata"]["description"] == "second description"
        assert v1["metadata"]["changelog"] == "initial"
        assert v2["metadata"]["changelog"] == "added optional input"

    def test_the_version_body_keeps_variables(self) -> None:
        """A Function's own variables are part of its version body (REQ-3.1.2.1)."""
        from wavecore.api.services.functions._storage import load_version, save_new_version

        variables = [
            {"name": "fn_kept", "type": "string", "value": "kept"},
            {"name": "limit", "type": "integer", "value": 3},
        ]
        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id, "1.0.0", _make_definition(variables=variables), _make_metadata(), name="greet"
        )

        stored = yaml.safe_load((_published_dir() / fn_id / "versions" / "1.0.0.yaml").read_text())
        assert stored["definition"].get("variables") == variables
        assert load_version(fn_id, "1.0.0").get("variables") == variables


# ---------------------------------------------------------------------------
# save_new_version - duplicate target
# ---------------------------------------------------------------------------


class TestSaveNewVersionDuplicate:
    """Republishing the same (id, version) raises a clean conflict - versions
    are write-once and the duplicate must surface as a 409, not a 500."""

    def test_duplicate_version_raises_conflict(self) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")
        with pytest.raises(ConflictException):
            save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")

    def test_duplicate_version_conflict_message_is_anchored(self) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")
        with pytest.raises(ConflictException) as excinfo:
            save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")
        assert excinfo.value.message == f"Function '{fn_id}' version '1.0.0' already exists"


class TestSaveNewVersionImmutability:
    """A published (id, version) record is write-once: a second write to the
    same version is refused and the original bytes never change."""

    def test_overwrite_attempt_leaves_bytes_unchanged(self) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(workflow={"nodes": [{"id": "orig"}], "edges": []}),
            _make_metadata(description="original"),
            name="greet",
        )
        version_path = _published_dir() / fn_id / "versions" / "1.0.0.yaml"
        original_bytes = version_path.read_bytes()

        with pytest.raises(ConflictException):
            save_new_version(
                fn_id,
                "1.0.0",
                _make_definition(workflow={"nodes": [{"id": "tampered"}], "edges": []}),
                _make_metadata(description="tampered"),
                name="greet",
            )

        assert version_path.read_bytes() == original_bytes


class TestSaveNewVersionAtomicWrite:
    """The version and index yaml are written through the shared synced temp-file writer."""

    def test_version_and_index_texts_go_through_the_shared_writer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services import settings_file
        from wavecore.api.services.functions._storage import save_new_version

        real_write = settings_file.write_text_atomic
        calls: list[tuple[Path, str, int | None]] = []

        def spy(path: Path, text: str, mode: int | None = None) -> None:
            calls.append((path, text, mode))
            real_write(path, text, mode)

        monkeypatch.setattr(settings_file, "write_text_atomic", spy)

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")

        fn_dir = _published_dir() / fn_id
        version_path = fn_dir / "versions" / "1.0.0.yaml"
        index_path = fn_dir / "index.yaml"
        assert [(path, mode) for path, _, mode in calls] == [
            (version_path, None),
            (index_path, None),
        ]
        version_text = calls[0][1]
        assert version_text == yaml.safe_dump(yaml.safe_load(version_text), sort_keys=False)
        assert list(yaml.safe_load(version_text)) == ["version", "definition", "metadata"]
        assert calls[1][1] == index_path.read_text(encoding="utf-8")

    def test_a_failed_version_write_leaves_no_temp_file(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import errno
        import os

        from wavecore.api.services.functions._storage import save_new_version

        def refuse(*args: Any, **kwargs: Any) -> None:
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr(os, "replace", refuse)

        fn_id = str(uuid.uuid4())
        with pytest.raises(OSError) as caught:
            save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")

        assert caught.value.errno == errno.ENOSPC
        versions_dir = _published_dir() / fn_id / "versions"
        assert sorted((_published_dir() / fn_id).rglob("*")) == [versions_dir]


class TestSaveNewVersionVersionValidation:
    """Every version string is validated as strict semver before any
    filesystem write, so it can never escape the versions directory or poison
    version ordering."""

    def test_path_escape_version_rejected_and_writes_no_escaped_file(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        with pytest.raises(ValidationException):
            save_new_version(fn_id, "../poison", _make_definition(), _make_metadata(), name="greet")
        # The crafted version must not have escaped into the function directory.
        assert not (_published_dir() / fn_id / "poison.yaml").exists()

    def test_non_semver_version_rejected(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        with pytest.raises(ValidationException):
            save_new_version(fn_id, "abc", _make_definition(), _make_metadata(), name="greet")

    def test_non_semver_version_message_is_anchored(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        with pytest.raises(ValidationException) as excinfo:
            save_new_version(fn_id, "abc", _make_definition(), _make_metadata(), name="greet")
        assert excinfo.value.message == "Function version 'abc' is not a valid semver"


# ---------------------------------------------------------------------------
# load_version
# ---------------------------------------------------------------------------


class TestLoadVersion:
    """`load_version(id, version)` returns the per-version definition payload."""

    def test_returns_definition_for_existing_version(self) -> None:
        from wavecore.api.services.functions._storage import load_version, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(workflow={"nodes": [], "edges": []}),
            _make_metadata(description="hello"),
            name="greet",
        )
        loaded = load_version(fn_id, "1.0.0")
        # Returns a FunctionDefinition shape carrying both
        # the version's definition and version-scoped metadata visible to the
        # caller (the resolver merges this into a uniform shape).
        assert loaded["id"] == fn_id
        assert loaded["name"] == "greet"
        assert loaded["version"] == "1.0.0"
        assert loaded["description"] == "hello"

    def test_returns_correct_version_when_multiple_published(self) -> None:
        from wavecore.api.services.functions._storage import load_version, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="v1"),
            name="greet",
        )
        save_new_version(
            fn_id,
            "2.0.0",
            _make_definition(),
            _make_metadata(description="v2"),
            name="greet",
        )
        v1 = load_version(fn_id, "1.0.0")
        v2 = load_version(fn_id, "2.0.0")
        assert v1["description"] == "v1"
        assert v2["description"] == "v2"

    def test_missing_version_raises_with_exact_message(self) -> None:
        """The missing-version error must use the canonical anchored shape."""
        from wavecore.api.services.functions._storage import load_version, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="greet")
        with pytest.raises(LookupError) as excinfo:
            load_version(fn_id, "9.9.9")
        message = str(excinfo.value)
        expected = f"Function '{fn_id}' version '9.9.9' not found"
        assert message == expected
        assert VERSION_NOT_FOUND_RE.match(message)

    def test_missing_function_raises_function_not_found(self) -> None:
        """When the function id itself does not exist, the error names the function."""
        from wavecore.api.services.functions._storage import load_version

        unknown_id = str(uuid.uuid4())
        with pytest.raises(LookupError) as excinfo:
            load_version(unknown_id, "1.0.0")
        message = str(excinfo.value)
        assert message == f"Function '{unknown_id}' not found"


# ---------------------------------------------------------------------------
# list_versions
# ---------------------------------------------------------------------------


class TestListVersions:
    """`list_versions(id)` returns ordered entries from the index."""

    def test_returns_empty_for_unknown_function(self) -> None:
        from wavecore.api.services.functions._storage import list_versions

        with pytest.raises(LookupError) as excinfo:
            list_versions(str(uuid.uuid4()))
        assert "not found" in str(excinfo.value)

    def test_returns_one_entry_when_one_version(self) -> None:
        from wavecore.api.services.functions._storage import list_versions, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(
                description="d1",
                tags=["t1"],
                changelog="c1",
                details="dt1",
            ),
            name="greet",
        )
        result = list_versions(fn_id)
        # GET /functions/{id}/versions returns
        # {versions: [...], latest: str}. The internal helper exposes the same
        # shape so the route can pass it through.
        assert result["latest"] == "1.0.0"
        assert len(result["versions"]) == 1
        entry = result["versions"][0]
        assert entry["version"] == "1.0.0"
        assert entry["description"] == "d1"
        assert entry["tags"] == ["t1"]
        assert entry["changelog"] == "c1"
        assert entry["details"] == "dt1"
        assert entry["published_at"] == "2026-01-01T00:00:00Z"

    def test_returns_entries_in_most_recent_first_order(self) -> None:
        from wavecore.api.services.functions._storage import list_versions, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(published_at="2026-01-01T00:00:00Z"),
            name="greet",
        )
        save_new_version(
            fn_id,
            "1.1.0",
            _make_definition(),
            _make_metadata(published_at="2026-02-01T00:00:00Z"),
            name="greet",
        )
        save_new_version(
            fn_id,
            "2.0.0",
            _make_definition(),
            _make_metadata(published_at="2026-03-01T00:00:00Z"),
            name="greet",
        )
        result = list_versions(fn_id)
        versions = [entry["version"] for entry in result["versions"]]
        assert versions == ["2.0.0", "1.1.0", "1.0.0"]
        assert result["latest"] == "2.0.0"


# ---------------------------------------------------------------------------
# load_function (returns LATEST)
# ---------------------------------------------------------------------------


class TestLoadFunctionLatest:
    """`load_function(id)` resolves to the latest version's content via the index."""

    def test_returns_latest_after_first_publish(self) -> None:
        from wavecore.api.services.functions._storage import load_function, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="hello"),
            name="greet",
        )
        definition, etag = load_function(fn_id)
        assert definition["id"] == fn_id
        assert definition["name"] == "greet"
        assert definition["version"] == "1.0.0"
        assert definition["description"] == "hello"
        # ETag is a 64-char hex digest (per existing compute_etag contract).
        assert re.fullmatch(r"[0-9a-f]{64}", etag)

    def test_returns_latest_after_second_publish(self) -> None:
        from wavecore.api.services.functions._storage import load_function, save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="v1"),
            name="greet",
        )
        save_new_version(
            fn_id,
            "2.0.0",
            _make_definition(),
            _make_metadata(description="v2"),
            name="greet",
        )
        definition, _etag = load_function(fn_id)
        assert definition["version"] == "2.0.0"
        assert definition["description"] == "v2"

    def test_missing_function_raises_lookup_error(self) -> None:
        from wavecore.api.services.functions._storage import load_function

        with pytest.raises(LookupError):
            load_function(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# The single-file layout is ignored on read (no compat shim)
# ---------------------------------------------------------------------------


class TestSingleFileLayoutIgnored:
    """A single-file `function.yaml` reads as if absent."""

    def _write_single_file_function(self, function_id: str) -> Path:
        """Write a function as one function.yaml, with no index or versions/."""
        fn_dir = _published_dir() / function_id
        fn_dir.mkdir(parents=True, exist_ok=True)
        file_path = fn_dir / "function.yaml"
        with open(file_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                {
                    "id": function_id,
                    "name": "single_file_only",
                    "description": "single-file layout",
                    "tags": [],
                    "inputs": [],
                    "outputs": [],
                    "dependencies": {"functions": [], "plugins": []},
                    "workflow": {"nodes": [], "edges": []},
                    "version": "1.0.0",
                    "metadata": {},
                },
                f,
            )
        return file_path

    def test_single_file_alone_is_not_loadable(self) -> None:
        """The single-file layout (no index, no versions/) raises on load."""
        from wavecore.api.services.functions._storage import load_function

        fn_id = str(uuid.uuid4())
        self._write_single_file_function(fn_id)
        with pytest.raises(LookupError):
            load_function(fn_id)

    def test_list_summaries_ignores_single_file_directories(self) -> None:
        """A directory that has only function.yaml is skipped in summaries."""
        from wavecore.api.services.functions._storage import list_function_summaries

        fn_id = str(uuid.uuid4())
        self._write_single_file_function(fn_id)
        summaries = list_function_summaries()
        assert all(row["id"] != fn_id for row in summaries)

    def test_single_file_does_not_break_new_publish(self) -> None:
        """A stray single-file function in a foreign dir does not block creating new entries."""
        from wavecore.api.services.functions._storage import (
            load_function,
            save_new_version,
        )

        single_file_id = str(uuid.uuid4())
        self._write_single_file_function(single_file_id)

        new_id = str(uuid.uuid4())
        save_new_version(
            new_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="new"),
            name="newfn",
        )
        definition, _etag = load_function(new_id)
        assert definition["id"] == new_id


# ---------------------------------------------------------------------------
# list_function_summaries (carries latest_version)
# ---------------------------------------------------------------------------


class TestListFunctionSummariesIncludesLatest:
    """The summary row carries `latest_version` so `GET /functions` can render it."""

    def test_summary_row_includes_latest_version(self) -> None:
        from wavecore.api.services.functions._storage import (
            list_function_summaries,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="a")
        save_new_version(fn_id, "2.0.0", _make_definition(), _make_metadata(), name="a")

        summaries = list_function_summaries()
        row = next(r for r in summaries if r["id"] == fn_id)
        assert row["latest_version"] == "2.0.0"

    def test_summary_row_includes_description_and_tags_from_latest(self) -> None:
        """The library card uses the LATEST version's description/tags."""
        from wavecore.api.services.functions._storage import (
            list_function_summaries,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(),
            _make_metadata(description="v1 desc", tags=["v1"]),
            name="a",
        )
        save_new_version(
            fn_id,
            "2.0.0",
            _make_definition(),
            _make_metadata(description="v2 desc", tags=["v2"]),
            name="a",
        )
        summaries = list_function_summaries()
        row = next(r for r in summaries if r["id"] == fn_id)
        assert row["description"] == "v2 desc"
        assert row["tags"] == ["v2"]


class TestSemverKeySentinel:
    """`_semver_key` sorts a non-semver string below any real version."""

    def test_non_semver_string_sorts_lowest(self) -> None:
        from wavecore.api.services.functions._storage import _semver_key

        # The precedence key sorts invalid input below every real version.
        assert _semver_key("not-a-semver") < _semver_key("0.0.0")


class TestLoadFunctionPayloadMissing:
    """`load_function` raises LookupError when the latest version's payload is
    unreadable (the function dir + index exist, but the yaml file is gone)."""

    def test_raises_lookup_error_when_version_payload_missing(self) -> None:
        from unittest.mock import patch

        from wavecore.api.services.functions._storage import (
            load_function,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")

        with patch(
            "wavecore.api.services.functions._storage._read_version_payload",
            return_value=None,
        ):
            with pytest.raises(LookupError):
                load_function(fn_id)


class TestDeleteVersion:
    """Coverage for `delete_version` (lookups, yaml unlink, index rewrite, and
    full-function removal when the last version is dropped)."""

    def test_raises_for_unknown_function(self) -> None:
        from wavecore.api.services.functions._storage import delete_version

        with pytest.raises(LookupError):
            delete_version(str(uuid.uuid4()), "1.0.0")

    def test_raises_for_unknown_version(self) -> None:
        from wavecore.api.services.functions._storage import (
            delete_version,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")
        with pytest.raises(LookupError):
            delete_version(fn_id, "9.9.9")

    def test_removes_yaml_and_rewrites_index_when_versions_remain(self) -> None:
        from wavecore.api.services.functions._storage import (
            delete_version,
            list_versions,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")
        save_new_version(fn_id, "1.1.0", _make_definition(), _make_metadata(), name="g")
        delete_version(fn_id, "1.0.0")
        remaining = [v["version"] for v in list_versions(fn_id)["versions"]]
        assert remaining == ["1.1.0"]
        # The unlinked version file is gone, the surviving one is intact.
        assert not (_published_dir() / fn_id / "versions" / "1.0.0.yaml").exists()
        assert (_published_dir() / fn_id / "versions" / "1.1.0.yaml").exists()

    def test_removes_function_entirely_when_last_version_is_dropped(self) -> None:
        from wavecore.api.services.functions._storage import (
            delete_version,
            save_new_version,
        )

        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")
        delete_version(fn_id, "1.0.0")
        # The function directory is removed once its last version is dropped.
        assert not (_published_dir() / fn_id).exists()

    def test_a_listed_version_that_is_not_semver_is_refused_and_deletes_nothing(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.functions._storage import delete_version, save_new_version

        fn_id, other_id = str(uuid.uuid4()), "victim"
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")
        save_new_version(other_id, "1.0.0", _make_definition(), _make_metadata(), name="h")
        crafted = f"../../{other_id}/versions/1.0.0"
        index_file = _published_dir() / fn_id / "index.yaml"
        index = yaml.safe_load(index_file.read_text(encoding="utf-8"))
        index["available_versions"].append(crafted)
        index_file.write_text(yaml.safe_dump(index), encoding="utf-8")

        with pytest.raises(ValidationException) as refused:
            delete_version(fn_id, crafted)

        assert refused.value.message == f"Function version '{crafted}' is not a valid semver"
        assert (_published_dir() / other_id / "versions" / "1.0.0.yaml").exists()


class TestScanFunctionDependentsEdges:
    """`_scan_function_dependents` silently skips non-dir entries and dirs
    that lack an index.yaml, and detects functionId-referenced dependents."""

    def test_skips_non_directory_entry_and_dir_without_index(self) -> None:
        from wavecore.api.services.functions._storage import (
            _scan_function_dependents,
            save_new_version,
        )

        # Seed one real function so the scan has a baseline.
        fn_id = str(uuid.uuid4())
        save_new_version(fn_id, "1.0.0", _make_definition(), _make_metadata(), name="g")

        # Plant a stray file (non-dir) and a dir-without-index alongside it.
        root = _published_dir()
        (root / "stray.txt").write_text("not a function dir")
        (root / "no-index-dir").mkdir()

        deps = _scan_function_dependents(fn_id)
        # Edges handled silently; no crash, no false positives.
        assert deps == []

    def test_detects_function_id_referenced_dependent(self) -> None:
        from wavecore.api.services.functions._storage import (
            _scan_function_dependents,
            save_new_version,
        )

        target_id = str(uuid.uuid4())
        save_new_version(target_id, "1.0.0", _make_definition(), _make_metadata(), name="target")
        # A second function whose body references the target via functionId.
        consumer_id = str(uuid.uuid4())
        save_new_version(
            consumer_id,
            "1.0.0",
            _make_definition(
                workflow={
                    "nodes": [
                        {
                            "id": "ref",
                            "type": "workflowNode",
                            "data": {"nodeType": "function", "functionId": target_id},
                        }
                    ],
                    "edges": [],
                }
            ),
            _make_metadata(),
            name="consumer",
        )
        deps = _scan_function_dependents(target_id)
        assert any(d["id"] == consumer_id for d in deps)


class TestReferenceValidationEmptyFunctionId:
    """A Shared function node without a functionId pin yields no issues from
    the reference validator (the empty-id case is silently skipped)."""

    def test_shared_node_without_function_id_yields_no_issue(self) -> None:
        from wavecore.api.services.functions._storage import (
            _reference_issues_for_node,
        )

        node = {
            "id": "n",
            "data": {
                "label": "SharedEmpty",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": "",
                "functionVersion": "1.0.0",
            },
        }
        assert _reference_issues_for_node(node, registry={}) == []


# ---------------------------------------------------------------------------
# The stored dependency list
# ---------------------------------------------------------------------------


class TestDependencyListFromTheBody:
    """The stored ``dependencies.functions`` list is derived from the body (REQ-3.1.2.3)."""

    def test_the_stored_list_is_written_from_the_body_at_publish(self) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        first_id, second_id, third_id = sorted(str(uuid.uuid4()) for _ in range(3))
        local_block = {
            "id": "local-1",
            "type": "workflowNode",
            "data": {
                "label": "Local_1",
                "nodeType": "function",
                "elementType": "function",
                "functionLifecycle": "local",
                "localDefinition": _make_definition(
                    name="Local_1",
                    workflow={
                        "nodes": [
                            _library_block("inner-1", first_id),
                            _library_block("inner-2", second_id),
                        ],
                        "edges": [],
                    },
                ),
            },
        }
        nodes = [
            _library_block("top-1", second_id),
            local_block,
            _library_block("top-2", third_id),
            _library_block("top-3", first_id),
        ]
        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id,
            "1.0.0",
            _make_definition(workflow={"nodes": nodes, "edges": []}),
            _make_metadata(),
            name="caller",
        )

        assert _stored_dependency_list(fn_id, "1.0.0") == [second_id, first_id, third_id]

    def test_a_list_sent_by_a_client_or_a_file_is_never_taken(self) -> None:
        from wavecore.api.services.functions import import_export, service
        from wavecore.api.services.functions._storage import save_new_version

        callee_id, sent_id, file_id = (str(uuid.uuid4()) for _ in range(3))
        save_new_version(callee_id, "1.0.0", _make_definition(), _make_metadata(), name="callee")
        sent = {"functions": [sent_id], "plugins": []}
        workflow = {
            "nodes": [_library_block("call-1", callee_id)],
            "edges": [{"source": "start-node", "target": "call-1"}],
        }

        created, _etag = service.create_function(
            {
                "name": "from_client",
                "description": "",
                "tags": [],
                **_make_definition(dependencies=sent, workflow=workflow),
            }
        )
        document = {
            "id": file_id,
            "name": "from_file",
            "version": "1.0.0",
            **_make_definition(dependencies=sent, workflow=workflow),
        }
        result = import_export.import_functions(
            yaml.safe_dump(document, sort_keys=False).encode(), "from_file.yaml"
        )

        assert result["total_imported"] == 1
        assert _stored_dependency_list(created["id"], "1.0.0") == [callee_id]
        assert _stored_dependency_list(file_id, "1.0.0") == [callee_id]

    def test_the_stored_list_is_written_from_the_body_at_import(self) -> None:
        from wavecore.api.services.functions import import_export
        from wavecore.api.services.functions._storage import save_new_version

        callee_id, caller_id = str(uuid.uuid4()), str(uuid.uuid4())
        save_new_version(callee_id, "1.0.0", _make_definition(), _make_metadata(), name="callee")
        document = {
            "id": caller_id,
            "name": "imported_caller",
            "version": "1.0.0",
            **_make_definition(
                workflow={
                    "nodes": [_library_block("call-1", callee_id)],
                    "edges": [{"source": "start-node", "target": "call-1"}],
                }
            ),
        }

        result = import_export.import_functions(
            yaml.safe_dump(document, sort_keys=False).encode(), "imported_caller.yaml"
        )

        assert result["total_imported"] == 1
        assert _stored_dependency_list(caller_id, "1.0.0") == [callee_id]


# ---------------------------------------------------------------------------
# Output and local variable kinds survive storage (REQ-3.1.2.8, REQ-3.1.3.15)
# ---------------------------------------------------------------------------

_COUNT_INPUT = {"name": "count", "type": "integer", "required": False}

_KIND_HOLDERS = [
    pytest.param(
        "outputs",
        {"name": "total", "type": "integer", "isExpression": True, "default": "count * 2"},
        id="expression-output",
    ),
    pytest.param(
        "outputs",
        {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ count }}"},
        id="template-output",
    ),
    pytest.param(
        "variables",
        {"name": "doubled", "type": "integer", "isExpression": True, "value": "count * 2"},
        id="expression-local",
    ),
    pytest.param(
        "variables",
        {"name": "tag", "type": "string", "isTemplate": True, "value": "id-{{ count }}"},
        id="template-local",
    ),
]


class TestKindKeysPassThrough:
    """``isExpression`` / ``isTemplate`` are kept wherever a version body is copied."""

    @pytest.mark.parametrize(("holder", "declared"), _KIND_HOLDERS)
    def test_the_version_body_and_load_keep_the_kind_keys(
        self, holder: str, declared: dict[str, Any]
    ) -> None:
        from wavecore.api.services.functions._storage import load_version, save_new_version

        fn_id = str(uuid.uuid4())
        definition = _make_definition(inputs=[_COUNT_INPUT], **{holder: [declared]})
        save_new_version(fn_id, "1.0.0", definition, _make_metadata(), name="kinds")

        stored = yaml.safe_load((_published_dir() / fn_id / "versions" / "1.0.0.yaml").read_text())
        assert stored["definition"].get(holder) == [declared]
        assert load_version(fn_id, "1.0.0").get(holder) == [declared]

    @pytest.mark.parametrize(("holder", "declared"), _KIND_HOLDERS)
    def test_an_import_keeps_the_kind_keys(self, holder: str, declared: dict[str, Any]) -> None:
        from wavecore.api.services.functions import import_export
        from wavecore.api.services.functions._storage import load_version

        fn_id = str(uuid.uuid4())
        document = {
            "id": fn_id,
            "name": "imported_kinds",
            "version": "1.0.0",
            **_make_definition(inputs=[_COUNT_INPUT], **{holder: [declared]}),
        }

        result = import_export.import_functions(
            yaml.safe_dump(document, sort_keys=False).encode(), "imported_kinds.yaml"
        )

        assert result["total_imported"] == 1
        assert load_version(fn_id, "1.0.0").get(holder) == [declared]


# ---------------------------------------------------------------------------
# Input defaults at save: kept, except a secret input's (REQ-3.1.2.10, REQ-3.1.2.11)
# ---------------------------------------------------------------------------

_INPUTS_KEEPING_THE_DEFAULT = [
    pytest.param(
        {"name": "count", "type": "integer", "required": True, "default": 3},
        id="required",
    ),
    pytest.param(
        {"name": "flag", "type": "boolean", "required": True, "default": False},
        id="required-boolean",
    ),
    pytest.param(
        {
            "name": "level",
            "type": "string",
            "required": True,
            "enumValues": ["low", "high"],
            "default": "high",
        },
        id="enum",
    ),
    pytest.param(
        {"name": "greeting", "type": "string", "required": False, "default": "hi"},
        id="optional",
    ),
]

_SECRET_INPUT = {
    "name": "token",
    "type": "string",
    "required": False,
    "secret": True,
    "default": "s3cr3t",
}


def _library_payload(inputs: list[dict[str, Any]]) -> dict[str, Any]:
    return {"name": "defaults", "description": "", "tags": [], **_make_definition(inputs=inputs)}


def _stored_input_after_library_save(declared: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.functions import service
    from wavecore.api.services.functions._storage import load_version

    created, _etag = service.create_function(_library_payload([declared]))
    return dict(load_version(created["id"], "1.0.0")["inputs"][0])


def _stored_input_after_new_version(declared: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.functions import service
    from wavecore.api.services.functions._storage import load_version

    created, _etag = service.create_function(_library_payload([]))
    service.add_function_version(
        created["id"],
        source_version="1.0.0",
        target_version="2.0.0",
        draft_definition=_library_payload([declared]),
        changelog="input added",
        description="",
        tags=[],
        details="",
    )
    return dict(load_version(created["id"], "2.0.0")["inputs"][0])


_GIVEN_LITERALS: dict[str, Any] = {"integer": 1, "boolean": True, "string": "x"}


def _given_values(definition: dict[str, Any]) -> dict[str, Any]:
    """A literal for each Required input: a Test save refuses a Block that leaves one empty."""
    return {
        item["name"]: (
            item["enumValues"][0] if "enumValues" in item else _GIVEN_LITERALS[item["type"]]
        )
        for item in definition.get("inputs") or []
        if item.get("required")
    }


def _local_function_block(node_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": definition,
            "config": {
                "values": _given_values(definition),
                "profileBindings": [],
                "outputBindings": {},
            },
        },
    }


def _local_body(inputs: list[dict[str, Any]], nodes: list[dict[str, Any]]) -> dict[str, Any]:
    edges = [{"source": "start-node", "target": nodes[0]["id"]}] if nodes else []
    return {
        "name": "local_fn",
        "description": "",
        "tags": [],
        **_make_definition(inputs=inputs, workflow={"nodes": nodes, "edges": edges}),
    }


def _created_test_workflow(node: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.tests import service as test_service

    created = test_service.create_test(
        {
            "name": f"defaults-{uuid.uuid4().hex[:8]}",
            "description": "",
            "variables": {},
            "workflow": {
                "nodes": [node],
                "edges": [{"source": "start-node", "target": node["id"]}],
            },
        }
    )
    stored = test_service._load_test(created["id"])
    assert stored is not None
    workflow: dict[str, Any] = stored["workflow"]
    return workflow


def _stored_input_after_test_save(declared: dict[str, Any]) -> dict[str, Any]:
    block = _local_function_block("fn-1", _local_body([declared], []))

    workflow = _created_test_workflow(block)

    return dict(workflow["nodes"][0]["data"]["localDefinition"]["inputs"][0])


def _stored_input_after_nested_test_save(declared: dict[str, Any]) -> dict[str, Any]:
    inner = _local_function_block("fn-inner", _local_body([declared], []))
    outer = _local_function_block("fn-outer", _local_body([], [inner]))

    workflow = _created_test_workflow(outer)

    outer_def = workflow["nodes"][0]["data"]["localDefinition"]
    return dict(outer_def["workflow"]["nodes"][0]["data"]["localDefinition"]["inputs"][0])


def _stored_input_after_draft_test_save(declared: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.functions import service

    created, _etag = service.create_function(_library_payload([]))
    block = _local_function_block("fn-1", {})
    data = block["data"]
    del data["localDefinition"]
    data.update(
        functionLifecycle="shared",
        functionId=created["id"],
        functionVersion="1.0.0",
        editMode=True,
        upstreamLink={"functionId": created["id"], "sourceVersion": "1.0.0"},
        draft=_local_body([declared], []),
    )
    data["config"]["values"] = _given_values(data["draft"])

    workflow = _created_test_workflow(block)

    return dict(workflow["nodes"][0]["data"]["draft"]["inputs"][0])


_SAVE_PATHS = [
    pytest.param(_stored_input_after_library_save, id="library-save"),
    pytest.param(_stored_input_after_new_version, id="new-version"),
    pytest.param(_stored_input_after_test_save, id="test-save"),
    pytest.param(_stored_input_after_nested_test_save, id="nested-test-save"),
    pytest.param(_stored_input_after_draft_test_save, id="draft-test-save"),
]


class TestInputDefaultsAtSave:
    """A save keeps an input's default, a Required or enum input's included; only a secret
    input's default is dropped."""

    @pytest.mark.parametrize("save", _SAVE_PATHS)
    @pytest.mark.parametrize("declared", _INPUTS_KEEPING_THE_DEFAULT)
    def test_the_default_is_kept(self, save: Any, declared: dict[str, Any]) -> None:
        stored = save(declared)

        assert stored["name"] == declared["name"]
        assert stored.get("default") == declared["default"]

    @pytest.mark.parametrize("save", _SAVE_PATHS)
    def test_a_secret_input_default_is_dropped(self, save: Any) -> None:
        stored = save(_SECRET_INPUT)

        assert stored["name"] == "token"
        assert stored["secret"] is True
        assert "default" not in stored

    @pytest.mark.parametrize("save", _SAVE_PATHS)
    def test_a_required_input_with_no_default_stores_no_default_key(self, save: Any) -> None:
        stored = save({"name": "count", "type": "integer", "required": True})

        assert "default" not in stored

    @pytest.mark.parametrize("save", _SAVE_PATHS)
    def test_an_optional_input_keeps_a_null_default(self, save: Any) -> None:
        stored = save({"name": "greeting", "type": "string", "required": False, "default": None})

        assert "default" in stored
        assert stored["default"] is None


class TestDropSecretInputDefaults:
    """``drop_secret_input_defaults`` drops a secret input's default and nothing else."""

    def test_only_the_secret_input_loses_its_default(self) -> None:
        from wavecore.api.services.functions import _storage

        kept: list[Any] = [param.values[0] for param in _INPUTS_KEEPING_THE_DEFAULT]
        function_def: dict[str, Any] = {
            "inputs": [*(dict(item) for item in kept), dict(_SECRET_INPUT)],
            "outputs": [{"name": "out_tok", "type": "string", "secret": True, "default": "x"}],
        }

        _storage.drop_secret_input_defaults(function_def)

        assert function_def["inputs"][:-1] == kept
        assert "default" not in function_def["inputs"][-1]
        assert function_def["outputs"][0]["default"] == "x"

    @pytest.mark.parametrize(
        "function_def",
        [
            pytest.param({}, id="no-inputs"),
            pytest.param({"inputs": None}, id="null-inputs"),
            pytest.param({"inputs": ["token", 3]}, id="non-mapping-entries"),
        ],
    )
    def test_a_body_without_input_declarations_is_left_as_is(
        self, function_def: dict[str, Any]
    ) -> None:
        import copy

        from wavecore.api.services.functions import _storage

        before = copy.deepcopy(function_def)

        _storage.drop_secret_input_defaults(function_def)

        assert function_def == before

    def test_the_old_helper_name_is_gone(self) -> None:
        from wavecore.api.services.functions import _storage

        assert not hasattr(_storage, "drop_meaningless_input_defaults")


class TestCreateResponseMasksSecrets:
    """A create answers in the read shape: a secret output default reads as the mask (SECUI-11)."""

    def test_a_secret_output_default_reads_masked_in_the_create_response(self) -> None:
        from wavecore.api.services.functions import service
        from wavecore.api.services.functions._storage import load_version
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        output = {"name": "token", "type": "string", "secret": True, "default": "s3cr3t"}
        created, _etag = service.create_function(
            {"name": "masked", "description": "", "tags": [], **_make_definition(outputs=[output])}
        )

        assert created["outputs"][0]["default"] == MASK_PLACEHOLDER
        assert load_version(created["id"], "1.0.0")["outputs"][0]["default"] not in (
            "s3cr3t",
            MASK_PLACEHOLDER,
        )


pytestmark = pytest.mark.usefixtures("temp_storage_path")
