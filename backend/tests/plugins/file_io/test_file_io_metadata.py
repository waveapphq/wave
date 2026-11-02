"""File I/O plugin metadata: operations, input descriptors and outputs (REQ-3.4.1.10).

REQ-3.4.3.1 and REQ-3.4.3.2: the path-like rows carry no save-time rule of their own; the
remote host refuses a WAVE-side scheme at run time.
"""

from typing import Any

import pytest

from wavecore.plugins.file_io import FileIOPlugin

OPERATIONS = [
    "read",
    "write",
    "copy",
    "move",
    "delete",
    "stats",
    "list",
    "create_folder",
]

EXPECTED_PARAM_ORDER = [
    "operation",
    "path",
    "content",
    "if_exists",
    "source",
    "destination",
    "missing_ok",
    "size",
    "checksum",
    "output_format",
    "pattern",
    "recursive",
]

EXPECTED_OUTPUT_ORDER = [
    "content",
    "exists",
    "type",
    "modified",
    "size",
    "checksum",
    "stats",
    "entries",
    "count",
]

PATH_OPERATIONS = ["read", "write", "delete", "stats", "list", "create_folder"]
SOURCE_OPERATIONS = ["copy", "move"]

STRING_PARAMS = ["operation", "path", "content", "if_exists", "source", "destination"]
STRING_PARAMS += ["checksum", "output_format", "pattern"]
BOOLEAN_PARAMS = ["missing_ok", "size", "recursive"]

STRICT_STRING_PARAMS = ["operation", "path", "source", "destination"]

IF_EXISTS_VALUES = ["overwrite", "append", "fail"]
CHECKSUM_VALUES = ["none", "md5", "sha1", "sha256", "sha512"]
OUTPUT_FORMAT_VALUES = ["individual", "map", "table"]

REMOVED_PARAMETERS = ["overwrite", "mode", "encoding"]
REMOVED_OUTPUTS = [
    "success",
    "path",
    "modified_time",
    "bytes_written",
    "bytes_copied",
    "bytes_moved",
    "source",
    "destination",
    "old_path",
    "new_path",
]


def _parameters() -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in FileIOPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in FileIOPlugin().metadata["output_schema"]}


class TestFileIOIdentity:
    """The block's identity, category and model validity."""

    def test_plugin_instantiates(self) -> None:
        assert FileIOPlugin() is not None

    def test_identity_fields(self) -> None:
        meta = FileIOPlugin().metadata

        assert meta["id"] == "file-io"
        assert meta["name"] == "File I/O"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "system"
        assert meta["description"]

    def test_return_type_is_map(self) -> None:
        assert FileIOPlugin().metadata["return_type"] == "map"

    def test_remotable_is_true(self) -> None:
        assert FileIOPlugin().metadata["remotable"] is True

    def test_metadata_validates_as_a_plugin_model(self) -> None:
        model = FileIOPlugin().get_plugin_model()

        assert model.id == "file-io"
        assert model.version == "1.0.0"
        assert model.metadata.category == "system"
        assert [p.name for p in model.parameters] == EXPECTED_PARAM_ORDER
        assert [o.name for o in model.outputs] == EXPECTED_OUTPUT_ORDER


class TestFileIOOperationParameter:
    """The eight operations, in order, on the one always-present setting."""

    def test_operation_is_required_with_the_read_default(self) -> None:
        operation = _parameters()["operation"]

        assert operation["type"] == "string"
        assert operation["required"] is True
        assert operation["default"] == "read"

    def test_operation_enum_values_in_order(self) -> None:
        assert _parameters()["operation"]["enum_values"] == OPERATIONS

    def test_operation_carries_no_conditional_requirement(self) -> None:
        operation = _parameters()["operation"]

        assert "required_when" not in operation
        assert "required_when_all" not in operation


class TestFileIOInputDescriptors:
    """Every input descriptor row: name, type, requirement, default and flags."""

    def test_parameter_order(self) -> None:
        assert [p["name"] for p in FileIOPlugin().metadata["parameters"]] == EXPECTED_PARAM_ORDER

    @pytest.mark.parametrize("name", EXPECTED_PARAM_ORDER)
    def test_every_parameter_describes_itself(self, name: str) -> None:
        assert _parameters()[name]["description"]

    @pytest.mark.parametrize("name", STRING_PARAMS)
    def test_string_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "string"

    @pytest.mark.parametrize("name", BOOLEAN_PARAMS)
    def test_boolean_parameter_types(self, name: str) -> None:
        assert _parameters()[name]["type"] == "boolean"

    def test_path_is_required_for_the_six_single_path_operations(self) -> None:
        path = _parameters()["path"]

        assert path["required"] is False
        assert path["required_when"] == {"field": "operation", "values": PATH_OPERATIONS}

    def test_content_is_required_for_write(self) -> None:
        content = _parameters()["content"]

        assert content["required"] is False
        assert content["required_when"] == {"field": "operation", "values": ["write"]}

    @pytest.mark.parametrize("name", ["source", "destination"])
    def test_source_and_destination_are_required_for_copy_and_move(self, name: str) -> None:
        param = _parameters()[name]

        assert param["required"] is False
        assert param["required_when"] == {"field": "operation", "values": SOURCE_OPERATIONS}

    @pytest.mark.parametrize(
        ("name", "default"),
        [
            ("if_exists", "overwrite"),
            ("missing_ok", False),
            ("size", False),
            ("checksum", "none"),
            ("output_format", "individual"),
            ("recursive", False),
        ],
    )
    def test_optional_parameter_defaults(self, name: str, default: Any) -> None:
        param = _parameters()[name]

        assert param["required"] is False
        assert param["default"] == default

    def test_pattern_is_optional_and_empty_by_default(self) -> None:
        pattern = _parameters()["pattern"]

        assert pattern["required"] is False
        assert pattern.get("default") in (None, "")

    @pytest.mark.parametrize(
        ("name", "values"),
        [
            ("if_exists", IF_EXISTS_VALUES),
            ("checksum", CHECKSUM_VALUES),
            ("output_format", OUTPUT_FORMAT_VALUES),
        ],
    )
    def test_enum_values_in_order(self, name: str, values: list[str]) -> None:
        assert _parameters()[name]["enum_values"] == values

    @pytest.mark.parametrize("name", EXPECTED_PARAM_ORDER)
    def test_no_row_carries_a_remote_host_path_flag(self, name: str) -> None:
        assert "remote_host_path_only" not in _parameters()[name]


class TestFileIOWhitespaceHandling:
    """Strict single-line values are trimmed; the payload never is."""

    @pytest.mark.parametrize("name", STRICT_STRING_PARAMS)
    def test_strict_string_params_declare_trim(self, name: str) -> None:
        assert _parameters()[name]["trim"] is True

    def test_content_preserves_whitespace(self) -> None:
        assert not _parameters()["content"].get("trim")


class TestFileIOOutputSchema:
    """The per-operation outputs, their wire names and their types."""

    def test_output_order(self) -> None:
        outputs = FileIOPlugin().metadata["output_schema"]

        assert [o["name"] for o in outputs] == EXPECTED_OUTPUT_ORDER

    @pytest.mark.parametrize("name", EXPECTED_OUTPUT_ORDER)
    def test_every_output_describes_itself(self, name: str) -> None:
        assert _outputs()[name]["description"]

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("content", "string"),
            ("exists", "boolean"),
            ("type", "string"),
            ("modified", "string"),
            ("size", "integer"),
            ("checksum", "string"),
            ("stats", "map"),
            ("entries", "table"),
            ("count", "integer"),
        ],
    )
    def test_output_types(self, name: str, expected: str) -> None:
        assert _outputs()[name]["type"] == expected

    def test_stats_becomes_a_table_when_output_format_is_table(self) -> None:
        assert _outputs()["stats"]["type_when"] == [
            {"when": [{"field": "output_format", "values": ["table"]}], "type": "table"}
        ]

    @pytest.mark.parametrize("name", [n for n in EXPECTED_OUTPUT_ORDER if n != "stats"])
    def test_no_other_output_switches_type(self, name: str) -> None:
        assert "type_when" not in _outputs()[name]


class TestFileIORemovedSchema:
    """The schema has no mode, no encoding, no overwrite and no path output."""

    @pytest.mark.parametrize("name", REMOVED_PARAMETERS)
    def test_removed_parameters_are_absent(self, name: str) -> None:
        assert name not in _parameters()

    @pytest.mark.parametrize("name", REMOVED_OUTPUTS)
    def test_removed_outputs_are_absent(self, name: str) -> None:
        assert name not in _outputs()

    def test_every_output_wire_name_appears_once(self) -> None:
        names = [o["name"] for o in FileIOPlugin().metadata["output_schema"]]

        assert len(names) == len(set(names))

    def test_every_parameter_wire_name_appears_once(self) -> None:
        names = [p["name"] for p in FileIOPlugin().metadata["parameters"]]

        assert len(names) == len(set(names))
