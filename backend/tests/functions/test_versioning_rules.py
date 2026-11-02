"""Unit tests for the semver bump-validation matrix (REQ-3.1.2.2).

`compute_allowed_bumps(source_def, draft_def) -> {allowed, blocked}` is a pure
function that classifies a draft definition against its source version per the
matrix:

- PATCH permits body changes, description / changelog / details edits, and
  internal workflow shape. PATCH blocks any I/O mutation and any tag
  add/remove.
- MINOR additionally permits adding OPTIONAL inputs, relaxing an existing input
  from required to optional, adding outputs, adding tags. MINOR blocks removing
  I/O, renaming I/O, type changes, making an optional input required, and
  removing tags.
- MAJOR permits any change EXCEPT the library entry's name (which is locked
  for the lifetime of the entry).

The `allowed` set carries the bump levels that pass; `blocked` is a dict
keyed by the disallowed level mapping to a human-readable explanation that
the FE renders in the `(i)` tooltip.

The function is pure (no IO), so these tests do not need the temp_storage_path
fixture.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Definition builders
# ---------------------------------------------------------------------------


def _base_def(**overrides: Any) -> dict[str, Any]:
    """Build a baseline function-definition shape for the rule comparator.

    Only the fields the comparator examines are needed (name, description,
    tags, inputs, outputs, workflow). Identifier metadata is not relevant
    here.
    """
    return {
        "name": overrides.pop("name", "greet"),
        "description": overrides.pop("description", "say hello"),
        "tags": overrides.pop("tags", ["demo"]),
        "inputs": overrides.pop("inputs", [{"name": "x", "type": "string", "required": True}]),
        "outputs": overrides.pop("outputs", [{"name": "result", "type": "string"}]),
        "workflow": overrides.pop(
            "workflow",
            {"nodes": [{"id": "n1", "label": "step1"}], "edges": []},
        ),
        **overrides,
    }


# ---------------------------------------------------------------------------
# No changes / metadata-only / body-only changes (PATCH allowed)
# ---------------------------------------------------------------------------


class TestPatchAllowedChanges:
    """Changes that are permitted at PATCH level (and therefore MINOR / MAJOR too)."""

    def test_no_changes_allows_all_bump_levels(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def()
        result = compute_allowed_bumps(src, _base_def())
        assert result["allowed"] == {"patch", "minor", "major"}
        assert result["blocked"] == {}

    def test_description_change_only_allows_all(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(_base_def(description="old"), _base_def(description="new"))
        assert result["allowed"] == {"patch", "minor", "major"}

    def test_workflow_body_change_only_allows_all(self) -> None:
        """Internal workflow edits are body-level and PATCH-safe."""
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(
            _base_def(),
            _base_def(workflow={"nodes": [{"id": "n2"}], "edges": []}),
        )
        assert result["allowed"] == {"patch", "minor", "major"}


# ---------------------------------------------------------------------------
# Input changes (PATCH blocked; MINOR allowed only for additive optional inputs)
# ---------------------------------------------------------------------------


class TestInputAdditions:
    """Adding inputs - additive only allowed at MINOR, required-add only at MAJOR."""

    def test_adding_optional_input_allows_minor_and_major(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def()
        draft = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": False},
            ]
        )
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"minor", "major"}
        assert "patch" in result["blocked"]
        # The blocked reason must be human-readable.
        assert isinstance(result["blocked"]["patch"], str)
        assert result["blocked"]["patch"]

    def test_adding_required_input_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def()
        draft = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": True},
            ]
        )
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}
        assert set(result["blocked"]) == {"patch", "minor"}

    def test_blocking_reason_names_the_added_required_input(self) -> None:
        """MINOR-block reason must explain what fails (so the FE tooltip is useful)."""
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def()
        draft = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": True},
            ]
        )
        result = compute_allowed_bumps(src, draft)
        minor_reason = result["blocked"]["minor"]
        # Either name the field or name the rule; do not allow empty strings.
        assert "required" in minor_reason.lower() or "y" in minor_reason


class TestInputRemovals:
    """Removing inputs - only allowed at MAJOR regardless of required flag."""

    def test_removing_required_input_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": True},
            ]
        )
        draft = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}
        assert set(result["blocked"]) == {"patch", "minor"}

    def test_removing_optional_input_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": False},
            ]
        )
        draft = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


class TestInputRenames:
    """Renaming an input - only at MAJOR (changes the binding contract)."""

    def test_renaming_input_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        draft = _base_def(inputs=[{"name": "xs", "type": "string", "required": True}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


class TestInputTypeChanges:
    """Changing an input's type - only at MAJOR."""

    def test_changing_input_type_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        draft = _base_def(inputs=[{"name": "x", "type": "integer", "required": True}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


class TestInputRequiredFlagFlip:
    """Required-flag flips are asymmetric.

    optional -> required tightens the contract (callers that elided the input
    now break) - MAJOR only. required -> optional loosens it (every prior caller
    still works) - MINOR and MAJOR. PATCH blocks either flip (any I/O change).
    """

    def test_optional_becoming_required_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(inputs=[{"name": "x", "type": "string", "required": False}])
        draft = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}

    def test_required_becoming_optional_allows_minor_and_major(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(inputs=[{"name": "x", "type": "string", "required": True}])
        draft = _base_def(inputs=[{"name": "x", "type": "string", "required": False}])
        result = compute_allowed_bumps(src, draft)
        # Loosening required -> optional is backward-compatible: MINOR allowed (PATCH still
        # blocked).
        assert result["allowed"] == {"minor", "major"}


# ---------------------------------------------------------------------------
# Output changes
# ---------------------------------------------------------------------------


class TestOutputAdditions:
    """Adding outputs - allowed at MINOR (purely additive)."""

    def test_adding_output_allows_minor_and_major(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def()
        draft = _base_def(
            outputs=[
                {"name": "result", "type": "string"},
                {"name": "result2", "type": "string"},
            ]
        )
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"minor", "major"}
        assert "patch" in result["blocked"]


class TestOutputRemovals:
    """Removing outputs - only at MAJOR (callers may already be reading them)."""

    def test_removing_output_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(
            outputs=[
                {"name": "result", "type": "string"},
                {"name": "result2", "type": "string"},
            ]
        )
        draft = _base_def(outputs=[{"name": "result", "type": "string"}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


class TestOutputRenamesAndTypeChanges:
    """Renaming an output or changing its type - only at MAJOR."""

    def test_renaming_output_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(outputs=[{"name": "result", "type": "string"}])
        draft = _base_def(outputs=[{"name": "answer", "type": "string"}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}

    def test_changing_output_type_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(outputs=[{"name": "result", "type": "string"}])
        draft = _base_def(outputs=[{"name": "result", "type": "integer"}])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


# ---------------------------------------------------------------------------
# Default, kind, secret and enum changes (REQ-3.1.2.2: minor, never patch)
# ---------------------------------------------------------------------------

_X_INPUT = {"name": "x", "type": "string", "required": True}


def _with_optional_input(**fields: Any) -> dict[str, Any]:
    return _base_def(
        inputs=[_X_INPUT, {"name": "y", "type": "string", "required": False, **fields}]
    )


def _with_output(**fields: Any) -> dict[str, Any]:
    return _base_def(outputs=[{"name": "result", "type": "string", **fields}])


def _enum_level(value_type: str, allowed: list[Any]) -> dict[str, Any]:
    return {
        "name": "level",
        "type": value_type,
        "required": True,
        "enumValues": allowed,
        "default": allowed[0],
    }


def _with_enum_input(value_type: str, allowed: list[Any]) -> dict[str, Any]:
    return _base_def(inputs=[_X_INPUT, _enum_level(value_type, allowed)])


def _assert_suggests_minor(result: dict[str, Any]) -> None:
    assert "patch" not in result["allowed"]
    assert result["allowed"] == {"minor", "major"}
    assert result["blocked"]["patch"]


class TestDefaultAndKindChanges:
    """A changed default, output kind, secret flag or enum list blocks patch."""

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            pytest.param({}, {"default": "a"}, id="added"),
            pytest.param({"default": "a"}, {"default": "b"}, id="changed"),
            pytest.param({"default": "a"}, {}, id="removed"),
        ],
    )
    def test_an_input_default_change_blocks_patch(
        self, before: dict[str, Any], after: dict[str, Any]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(
            _with_optional_input(**before), _with_optional_input(**after)
        )

        _assert_suggests_minor(result)

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            pytest.param({}, {"default": "a"}, id="added"),
            pytest.param({"default": "a"}, {"default": "b"}, id="changed"),
            pytest.param({"default": "a"}, {}, id="removed"),
        ],
    )
    def test_an_output_default_change_blocks_patch(
        self, before: dict[str, Any], after: dict[str, Any]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(_with_output(**before), _with_output(**after))

        _assert_suggests_minor(result)

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            pytest.param({}, {"isExpression": True}, id="literal-to-expression"),
            pytest.param({}, {"isTemplate": True}, id="literal-to-template"),
            pytest.param({"isExpression": True}, {"isTemplate": True}, id="expression-to-template"),
            pytest.param({"isExpression": True}, {}, id="expression-to-literal"),
        ],
    )
    def test_an_output_kind_change_blocks_patch(
        self, before: dict[str, Any], after: dict[str, Any]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        # Same default text on both sides, so only the kind differs.
        result = compute_allowed_bumps(
            _with_output(default="x", **before), _with_output(default="x", **after)
        )

        _assert_suggests_minor(result)

    @pytest.mark.parametrize(
        ("builder", "before", "after"),
        [
            pytest.param(_with_optional_input, {}, {"secret": True}, id="input-made-secret"),
            pytest.param(_with_optional_input, {"secret": True}, {}, id="input-made-plain"),
            pytest.param(_with_output, {}, {"secret": True}, id="output-made-secret"),
            pytest.param(_with_output, {"secret": True}, {}, id="output-made-plain"),
        ],
    )
    def test_a_secret_change_blocks_patch(
        self, builder: Any, before: dict[str, Any], after: dict[str, Any]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(builder(**before), builder(**after))

        _assert_suggests_minor(result)

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            pytest.param(
                ("string", ["low", "high"]), ("string", ["low", "high", "mid"]), id="added"
            ),
            pytest.param(("string", ["low", "high"]), ("string", ["low"]), id="removed"),
        ],
    )
    def test_an_enum_change_blocks_patch(
        self, before: tuple[str, list[Any]], after: tuple[str, list[Any]]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(_with_enum_input(*before), _with_enum_input(*after))

        _assert_suggests_minor(result)

    @pytest.mark.parametrize(
        ("before", "after"),
        [
            pytest.param(("string", ["1", "2"]), ("integer", [1, 2]), id="string-to-integer"),
            pytest.param(("integer", [1, 2]), ("float", [1, 2]), id="integer-to-float"),
        ],
    )
    def test_an_enum_type_change_is_an_input_type_change(
        self, before: tuple[str, list[Any]], after: tuple[str, list[Any]]
    ) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(_with_enum_input(*before), _with_enum_input(*after))

        assert result["allowed"] == {"major"}
        assert result["blocked"] == {
            "patch": "PATCH cannot change input types (changed 'level')",
            "minor": "MINOR cannot change input types (changed 'level')",
        }

    def test_an_enum_value_type_key_takes_no_part_in_the_comparison(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        source = _with_enum_input("string", ["low", "high"])
        draft = copy.deepcopy(source)
        source["inputs"][1]["enumValueType"] = "string"

        result = compute_allowed_bumps(source, draft)

        assert result["allowed"] == {"patch", "minor", "major"}

    def test_unchanged_defaults_kinds_secrets_and_enums_keep_patch(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        source = _with_enum_input("string", ["low", "high"])
        source["inputs"].append(
            {"name": "y", "type": "string", "required": False, "secret": True, "default": "a"}
        )
        source["outputs"] = [
            {"name": "result", "type": "string", "isTemplate": True, "default": "{{ x }}!"}
        ]

        result = compute_allowed_bumps(source, copy.deepcopy(source))

        assert result["allowed"] == {"patch", "minor", "major"}

    def test_a_missing_default_and_a_null_default_are_the_same(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        result = compute_allowed_bumps(_with_optional_input(), _with_optional_input(default=None))

        assert result["allowed"] == {"patch", "minor", "major"}


# ---------------------------------------------------------------------------
# Tag changes
# ---------------------------------------------------------------------------


class TestTagAdditions:
    """Adding tags is a MINOR-class change (PATCH blocks it)."""

    def test_adding_tag_blocks_patch_allows_minor_and_major(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(tags=["demo"])
        draft = _base_def(tags=["demo", "v2"])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"minor", "major"}
        assert "patch" in result["blocked"]


class TestTagRemovals:
    """Removing a tag - only at MAJOR."""

    def test_removing_tag_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(tags=["demo", "legacy"])
        draft = _base_def(tags=["demo"])
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}


# ---------------------------------------------------------------------------
# Name lock (entry-wide; not editable at any level)
# ---------------------------------------------------------------------------


class TestNameLock:
    """The library entry's name is immutable across versions."""

    def test_changing_name_blocks_all_bump_levels(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(name="greet")
        draft = _base_def(name="greet_renamed")
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == set()
        assert set(result["blocked"]) == {"patch", "minor", "major"}
        # Each blocked reason must mention the name lock.
        for reason in result["blocked"].values():
            assert "name" in reason.lower()


# ---------------------------------------------------------------------------
# Multiple violations - the strictest blocking reason wins per level
# ---------------------------------------------------------------------------


class TestMultipleViolations:
    """When a draft violates several rules, the blocking reason for each level
    must reflect at least one violating change so the FE tooltip is useful."""

    def test_added_required_input_and_removed_output_allows_major_only(self) -> None:
        from wavecore.api.services.functions._versioning import compute_allowed_bumps

        src = _base_def(
            outputs=[
                {"name": "result", "type": "string"},
                {"name": "result2", "type": "string"},
            ]
        )
        draft = _base_def(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": True},
            ],
            outputs=[{"name": "result", "type": "string"}],
        )
        result = compute_allowed_bumps(src, draft)
        assert result["allowed"] == {"major"}
        # Each blocked reason must be a non-empty string.
        for reason in result["blocked"].values():
            assert isinstance(reason, str)
            assert reason


class TestVersioningPrivateHelpers:
    """Direct tests for the private helpers that the bump matrix relies on."""

    def test_index_params_returns_empty_for_non_list_input(self) -> None:
        from wavecore.api.services.functions._versioning import _index_params

        assert _index_params(None) == {}
        assert _index_params("not-a-list") == {}

    def test_index_params_skips_non_mapping_entries(self) -> None:
        from wavecore.api.services.functions._versioning import _index_params

        result = _index_params(["bad-entry", {"name": "x", "type": "string"}])
        assert set(result.keys()) == {"x"}

    def test_classify_target_version_returns_minor(self) -> None:
        from wavecore.api.services.functions._versioning import classify_target_version

        assert classify_target_version("1.2.3", "1.3.0") == "minor"

    def test_classify_target_version_returns_none_for_bad_semver(self) -> None:
        from wavecore.api.services.functions._versioning import classify_target_version

        assert classify_target_version("not-a-semver", "1.0.0") is None

    def test_classify_target_version_returns_none_for_downgrade(self) -> None:
        from wavecore.api.services.functions._versioning import classify_target_version

        # 1.2.3 -> 1.2.2 matches none of patch/minor/major.
        assert classify_target_version("1.2.3", "1.2.2") is None

    def test_parse_version_returns_none_for_invalid_string(self) -> None:
        from wavecore.api.services.functions._versioning import parse_version

        assert parse_version("not-a-semver") is None

    def test_parse_version_returns_tuple_for_valid_semver(self) -> None:
        from wavecore.api.services.functions._versioning import parse_version

        assert parse_version("2.3.4") == (2, 3, 4)

    def test_parse_version_returns_none_for_non_string(self) -> None:
        from wavecore.api.services.functions._versioning import parse_version

        assert parse_version(123) is None

    def test_is_valid_version_accepts_full_semver2_prerelease_and_build(self) -> None:
        # Versions are full semver 2.0.0 (pre-release + build metadata),
        # not a strict X.Y.Z subset.
        from wavecore.api.services.functions._versioning import is_valid_version

        assert is_valid_version("2.0.0-dev1") is True
        assert is_valid_version("1.4.3-beta.1") is True
        assert is_valid_version("2.0.0+build.5") is True
        assert is_valid_version("1.0.0-alpha.1+build.2") is True

    def test_is_valid_version_rejects_leading_zero_and_garbage(self) -> None:
        from wavecore.api.services.functions._versioning import is_valid_version

        assert is_valid_version("01.0.0") is False
        assert is_valid_version("1.2") is False
        assert is_valid_version("abc") is False
        assert is_valid_version("1.0.0-") is False

    def test_parse_version_extracts_core_from_prerelease(self) -> None:
        from wavecore.api.services.functions._versioning import parse_version

        # The (major, minor, patch) core still drives bump classification.
        assert parse_version("2.0.0-dev1") == (2, 0, 0)
        assert parse_version("1.4.3-beta.1+build") == (1, 4, 3)

    def test_version_precedence_release_outranks_its_prerelease(self) -> None:
        from wavecore.api.services.functions._versioning import version_precedence_key

        assert version_precedence_key("2.0.0-dev1") < version_precedence_key("2.0.0")

    def test_version_precedence_orders_prerelease_identifiers_per_spec(self) -> None:
        from wavecore.api.services.functions._versioning import version_precedence_key

        ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
        ]
        keys = [version_precedence_key(v) for v in ordered]
        assert keys == sorted(keys)
