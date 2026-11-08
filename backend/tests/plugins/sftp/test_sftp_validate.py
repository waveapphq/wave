"""SFTP block metadata and validation: rows, outputs and exact refusals (REQ-3.4.1.8)."""

import re
from typing import Any

import pytest

from wavecore.plugins._shared_params import on_error_parameter, output_core, timeout_parameter
from wavecore.plugins.sftp import SFTPPlugin

ABSENT: Any = object()
SESSION = "ssh_session_sftp"
OPERATIONS = ["upload", "download", "list", "stats", "delete", "move", "create_folder"]
TRANSFERS = ["upload", "download", "move"]
PATH_OPERATIONS = ["list", "stats", "delete", "create_folder"]

# Validation fails the block whatever On error says.
ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])


def gate(*values: str) -> dict[str, Any]:
    return {"field": "operation", "values": list(values)}


def varies(**texts: str) -> list[dict[str, Any]]:
    """The per-operation descriptions a row shows in place of its base one, in order."""
    return [{"when": [gate(operation)], "description": text} for operation, text in texts.items()]


SESSION_ID_TEXT = (
    "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, "
    "Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it"
)
OPERATION_TEXT = (
    "What to do. Upload and Download move files between WAVE and the server; List, Stats, "
    "Delete, Move and Create folder work on the server."
)
SOURCE_UPLOAD = (
    "File or folder on WAVE to upload: testdata://, artifact:// or an absolute or relative "
    "path. A folder goes with everything inside it; *, ? and [...] match several files."
)
SOURCE_DOWNLOAD = (
    "File or folder on the server to download. A folder comes with everything inside it; "
    "*, ? and [...] match several files."
)
SOURCE_MOVE = "File or folder on the server to move or rename."
DESTINATION_UPLOAD = (
    "Where it goes on the server. An existing folder or a path ending in / keeps the names; "
    "any other path is the new name, for one file only. Missing folders are created."
)
DESTINATION_DOWNLOAD = (
    "Where it lands on WAVE: artifact:// or an absolute or relative path; testdata:// is "
    "read-only. Empty puts it in the run's artifacts under its own name. An existing folder or "
    "a path ending in / keeps the names; any other path is the new name, for one file only."
)
DESTINATION_MOVE = (
    "The new path on the server. An existing folder or a path ending in / keeps the name."
)
PATH_LIST = (
    "Folder on the server to list, or a pattern: *, ? and [...] list only the matching "
    "entries. No match gives no entries and a Count of 0."
)
PATH_STATS = (
    "File or folder on the server to report on. A missing path is not an error: Exists is " "false."
)
PATH_DELETE = (
    "File or folder on the server to delete; a folder goes with everything inside it, and *, ? "
    "and [...] delete every match. A path that names the account's home or the server root "
    "(empty, ., ~ or /) is refused."
)
PATH_CREATE_FOLDER = (
    "Folder to create on the server, including its name. Missing parent folders are created."
)
IF_EXISTS_TEXT = (
    "What happens when a file is already at the destination: Replace it overwrites it; Fail "
    "the block stops before anything is written."
)
TIMEOUT_TEXT = "Seconds the whole block may take, every file of a folder included."
MAX_SIZE_TEXT = (
    "Largest total a download may bring, in MiB. The block adds up the match before it writes "
    "anything and refuses a larger one. 0 means no limit."
)
MAX_FILES_TEXT = (
    "Most files a download may bring. The block counts the match before it writes anything and "
    "refuses more. 0 means no limit."
)
ON_ERROR_TEXT = (
    "Fail the block on a run-time failure, or record it in Error and Reason and continue."
)
SUCCESS_TEXT = (
    "True when the operation finished. False when the block failed and On error is Record and "
    "continue."
)
REASON_TEXT = (
    "Why the block failed: SessionClosed, SftpUnavailable, NoMatch, NotFound, NotAFolder, "
    "Conflict, Exists, ReadOnly, TooManyFiles, TooLarge, UnsafeEntry, Refused, "
    "PermissionDenied, ConnectionLost, ServerFailure, LocalFailure or Timeout; empty otherwise"
)

EXPECTED_PARAMETERS: list[dict[str, Any]] = [
    {
        "name": "session_id",
        "type": "string",
        "trim": True,
        "required": True,
        "description": SESSION_ID_TEXT,
    },
    {
        "name": "operation",
        "type": "string",
        "required": True,
        "default": "upload",
        "enum_values": OPERATIONS,
        "description": OPERATION_TEXT,
    },
    {
        "name": "source",
        "type": "string",
        "trim": True,
        "required_when": gate(*TRANSFERS),
        "show_when": gate(*TRANSFERS),
        "description": SOURCE_UPLOAD,
        "description_when": varies(download=SOURCE_DOWNLOAD, move=SOURCE_MOVE),
    },
    {
        "name": "destination",
        "type": "string",
        "trim": True,
        "required_when": gate("upload", "move"),
        "show_when": gate(*TRANSFERS),
        "description": DESTINATION_UPLOAD,
        "description_when": varies(download=DESTINATION_DOWNLOAD, move=DESTINATION_MOVE),
    },
    {
        "name": "path",
        "type": "string",
        "trim": True,
        "required_when": gate(*PATH_OPERATIONS),
        "show_when": gate(*PATH_OPERATIONS),
        "description": PATH_LIST,
        "description_when": varies(
            stats=PATH_STATS, delete=PATH_DELETE, create_folder=PATH_CREATE_FOLDER
        ),
    },
    {
        "name": "if_exists",
        "type": "string",
        "default": "overwrite",
        "enum_values": ["overwrite", "fail"],
        "show_when": gate(*TRANSFERS),
        "description": IF_EXISTS_TEXT,
    },
    {
        "name": "recursive",
        "type": "boolean",
        "default": False,
        "show_when": gate("list"),
        "description": "List the entries inside subfolders too, at every depth.",
    },
    {
        "name": "missing_ok",
        "type": "boolean",
        "default": False,
        "show_when": gate("delete"),
        "description": (
            "Pass when the path or pattern matches nothing, instead of failing the block."
        ),
    },
    {
        "name": "timeout",
        "type": "integer",
        "required": False,
        "default": 300,
        "minimum": 1,
        "description": TIMEOUT_TEXT,
    },
    {
        "name": "max_size_mib",
        "type": "integer",
        "required": False,
        "default": 1024,
        "minimum": 0,
        "show_when": gate("download"),
        "description": MAX_SIZE_TEXT,
    },
    {
        "name": "max_files",
        "type": "integer",
        "required": False,
        "default": 10000,
        "minimum": 0,
        "show_when": gate("download"),
        "description": MAX_FILES_TEXT,
    },
    {
        "name": "on_error",
        "type": "string",
        "required": False,
        "default": "fail",
        "enum_values": ["fail", "record"],
        "description": ON_ERROR_TEXT,
    },
]
PARAM_ORDER = [row["name"] for row in EXPECTED_PARAMETERS]

EXPECTED_OUTPUTS: list[dict[str, Any]] = [
    {
        "name": "summary",
        "type": "table",
        "show_when": gate("upload", "download"),
        "description": "One row per file transferred: source, destination and size.",
    },
    {
        "name": "entries",
        "type": "table",
        "show_when": gate("list"),
        "description": (
            "One row per entry: name, path, type, modified and size. Include subfolders adds "
            "the entries of every subfolder."
        ),
    },
    {
        "name": "count",
        "type": "integer",
        "show_when": gate("list"),
        "description": "Number of entries; 0 when nothing matches.",
    },
    {
        "name": "exists",
        "type": "boolean",
        "show_when": gate("stats"),
        "description": "True when the path is there on the server.",
    },
    {
        "name": "type",
        "type": "string",
        "show_when": gate("stats"),
        "description": "Whether the path is a file or a folder; empty when the path is missing.",
    },
    {
        "name": "size",
        "type": "integer",
        "show_when": gate("stats"),
        "description": "Size in bytes of a file; 0 for a folder or a missing path.",
    },
    {
        "name": "modified",
        "type": "string",
        "show_when": gate("stats"),
        "description": "Last modified, ISO-8601 UTC; empty when the path is missing.",
    },
    *output_core(gated=True, success_description=SUCCESS_TEXT, reason_description=REASON_TEXT),
]
OUTPUT_ORDER = [output["name"] for output in EXPECTED_OUTPUTS]

# A valid block per operation; tests reshape one row at a time.
VALID: dict[str, dict[str, Any]] = {
    "upload": {"source": "testdata://orders.csv", "destination": "/inbound/"},
    "download": {"source": "/outbound/orders.out", "destination": ""},
    "list": {"path": "/outbound"},
    "stats": {"path": "/outbound/orders.out"},
    "delete": {"path": "/outbound/orders.out"},
    "move": {"source": "/inbound/orders.tmp", "destination": "/inbound/orders.csv"},
    "create_folder": {"path": "/inbound/archive"},
}

HOME_OR_ROOT = ["/", "//", "/.", "/..", ".", "./", "a/..", "~", "~/", "..", "../.."]
DELETABLE = ["*", "./*", "~/x", "sub", "../x"]


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def params(operation: str, /, **overrides: Any) -> dict[str, Any]:
    """The valid block for the operation with overrides applied; an ABSENT override removes it."""
    merged = {"session_id": SESSION, "operation": operation, **VALID[operation], **overrides}
    return {key: value for key, value in merged.items() if value is not ABSENT}


async def refuses(message: str, block: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match=exact(message)):
        await SFTPPlugin().validate(block)


def choice_message(name: str, values: str, value: str) -> str:
    return f"Parameter '{name}' must be one of: {values}; Actual value was '{value}'."


def home_or_root_message(path: str) -> str:
    return (
        f"{path} names the account's home, a folder above it or the SFTP server's root folder "
        "and cannot be deleted"
    )


def blank_values() -> list[Any]:
    return [
        pytest.param(ABSENT, id="absent"),
        pytest.param(None, id="none"),
        pytest.param("", id="empty"),
        pytest.param("   ", id="spaces"),
    ]


def without_optional_false(row: dict[str, Any]) -> dict[str, Any]:
    """A row without `required: False`: an optional row may carry the key or leave it out."""
    return {key: value for key, value in row.items() if not (key == "required" and not value)}


def _parameters() -> dict[str, dict[str, Any]]:
    return {row["name"]: row for row in SFTPPlugin().metadata["parameters"]}


def _outputs() -> dict[str, dict[str, Any]]:
    return {output["name"]: output for output in SFTPPlugin().metadata["output_schema"]}


class TestIdentity:
    """SFTP is a 1.0.0 block in the Remote category that runs on WAVE only (SFTP-1, SFTP-10)."""

    def test_identity_fields(self) -> None:
        meta = SFTPPlugin().metadata
        identity = {
            key: meta.get(key)
            for key in ("id", "name", "version", "category", "return_type", "author")
        }

        assert identity == {
            "id": "sftp",
            "name": "SFTP",
            "version": "1.0.0",
            "category": "remote",
            "return_type": "map",
            "author": "WAVE Framework",
        }

    def test_description(self) -> None:
        assert SFTPPlugin().metadata["description"] == (
            "Moves files between WAVE and the server of an open SSH session over SFTP, and "
            "lists, inspects, deletes, moves and creates files and folders on that server."
        )

    def test_tags(self) -> None:
        assert SFTPPlugin().metadata["tags"] == ["sftp", "ssh", "remote", "file", "transfer"]

    def test_the_block_is_not_remotable(self) -> None:
        assert "remotable" not in SFTPPlugin().metadata

    def test_no_secret_mask_fields(self) -> None:
        assert "secret_mask_fields" not in SFTPPlugin().metadata

    def test_metadata_builds_the_plugin_model(self) -> None:
        model = SFTPPlugin().get_plugin_model()

        assert model.id == "sftp"
        assert model.version == "1.0.0"
        assert model.metadata.category == "remote"
        assert [p.name for p in model.parameters] == PARAM_ORDER
        assert [o.name for o in model.outputs] == OUTPUT_ORDER


class TestParameters:
    """Every row in order with exactly the keys of its wire contract (SFTP-2..SFTP-6, SFTP-8)."""

    def test_parameter_order(self) -> None:
        assert [row["name"] for row in SFTPPlugin().metadata["parameters"]] == PARAM_ORDER

    @pytest.mark.parametrize("expected", EXPECTED_PARAMETERS, ids=PARAM_ORDER)
    def test_row(self, expected: dict[str, Any]) -> None:
        actual = _parameters()[expected["name"]]

        assert without_optional_false(actual) == without_optional_false(expected)

    @pytest.mark.parametrize(
        "name", ["if_exists", "recursive", "missing_ok", "timeout", "max_size_mib", "max_files"]
    )
    def test_optional_rows_are_not_required(self, name: str) -> None:
        assert _parameters()[name].get("required", False) is False

    @pytest.mark.parametrize("name", ["source", "destination", "path"])
    def test_conditionally_required_rows_are_not_required_outright(self, name: str) -> None:
        assert _parameters()[name].get("required", False) is False

    def test_only_the_three_path_rows_carry_operation_dependent_text(self) -> None:
        varying = [name for name, row in _parameters().items() if "description_when" in row]

        assert varying == ["source", "destination", "path"]

    def test_timeout_keeps_the_shared_shape_with_a_floor_of_one(self) -> None:
        assert _parameters()["timeout"] == {**timeout_parameter(300, TIMEOUT_TEXT), "minimum": 1}

    def test_on_error_keeps_the_shared_shape(self) -> None:
        assert _parameters()["on_error"] == on_error_parameter(ON_ERROR_TEXT)

    @pytest.mark.parametrize("name", ["timeout", "max_size_mib", "max_files"])
    def test_numeric_rows_declare_no_maximum(self, name: str) -> None:
        assert "maximum" not in _parameters()[name]


class TestOutputs:
    """Per-operation outputs, then Success always and Error and Reason under Record (SFTP-9)."""

    def test_output_order(self) -> None:
        assert [o["name"] for o in SFTPPlugin().metadata["output_schema"]] == OUTPUT_ORDER

    @pytest.mark.parametrize("expected", EXPECTED_OUTPUTS, ids=OUTPUT_ORDER)
    def test_output(self, expected: dict[str, Any]) -> None:
        assert _outputs()[expected["name"]] == expected

    def test_reason_names_every_failure_code(self) -> None:
        assert _outputs()["reason"]["description"] == REASON_TEXT

    def test_success_is_always_shown(self) -> None:
        assert "show_when" not in _outputs()["success"]


class TestChoices:
    """Operation, On error and If the file exists hold one of their wire values."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["copy", "", "Upload"])
    async def test_operation_outside_its_choices(self, value: str, on_error: str) -> None:
        block = {"session_id": SESSION, "operation": value, "on_error": on_error}

        await refuses(
            choice_message(
                "operation", "upload, download, list, stats, delete, move, create_folder", value
            ),
            block,
        )

    async def test_an_operation_over_fifty_characters_is_shown_by_its_length(self) -> None:
        await refuses(
            "Parameter 'operation' must be one of: upload, download, list, stats, delete, move, "
            "create_folder; Actual value was a 51-character value.",
            {"session_id": SESSION, "operation": "x" * 51},
        )

    async def test_an_operation_of_fifty_characters_is_shown_quoted(self) -> None:
        value = "y" * 50

        await refuses(
            choice_message(
                "operation", "upload, download, list, stats, delete, move, create_folder", value
            ),
            {"session_id": SESSION, "operation": value},
        )

    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_on_error_outside_its_choices(self, operation: str) -> None:
        await refuses(
            choice_message("on_error", "fail, record", "ignore"),
            params(operation, on_error="ignore"),
        )

    @ON_ERROR
    @pytest.mark.parametrize("operation", TRANSFERS)
    async def test_if_exists_outside_its_choices(self, operation: str, on_error: str) -> None:
        await refuses(
            choice_message("if_exists", "overwrite, fail", "skip"),
            params(operation, if_exists="skip", on_error=on_error),
        )

    @pytest.mark.parametrize("operation", PATH_OPERATIONS)
    async def test_if_exists_is_not_checked_where_it_is_hidden(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, if_exists="skip"))

    async def test_an_absent_operation_is_upload(self) -> None:
        block = params("upload", operation=ABSENT)

        await SFTPPlugin().validate(block)
        await refuses("Missing required parameter: source", {**block, "source": ""})

    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_absent_selects_take_their_defaults(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, if_exists=None, on_error=None))


class TestRequiredRows:
    """Session ID always, and each operation's own rows, are required (SFTP-2)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values())
    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_session_id_missing_or_blank(
        self, operation: str, value: Any, on_error: str
    ) -> None:
        await refuses(
            "Missing required parameter: session_id",
            params(operation, session_id=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values())
    @pytest.mark.parametrize("operation", TRANSFERS)
    async def test_source_missing_or_blank(self, operation: str, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: source",
            params(operation, source=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values())
    @pytest.mark.parametrize("operation", ["upload", "move"])
    async def test_destination_missing_or_blank(
        self, operation: str, value: Any, on_error: str
    ) -> None:
        await refuses(
            "Missing required parameter: destination",
            params(operation, destination=value, on_error=on_error),
        )

    @pytest.mark.parametrize("value", blank_values())
    async def test_download_may_leave_destination_empty(self, value: Any) -> None:
        await SFTPPlugin().validate(params("download", destination=value))

    @ON_ERROR
    @pytest.mark.parametrize("value", blank_values())
    @pytest.mark.parametrize("operation", PATH_OPERATIONS)
    async def test_path_missing_or_blank(self, operation: str, value: Any, on_error: str) -> None:
        await refuses(
            "Missing required parameter: path",
            params(operation, path=value, on_error=on_error),
        )

    @pytest.mark.parametrize("operation", TRANSFERS)
    async def test_path_is_not_required_for_a_transfer(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, path=""))

    @pytest.mark.parametrize("operation", PATH_OPERATIONS)
    async def test_source_and_destination_are_not_required_on_a_path_operation(
        self, operation: str
    ) -> None:
        await SFTPPlugin().validate(params(operation, source="", destination=None))


class TestDeleteRefusesHomeOrRoot:
    """Delete refuses a Path naming the server root, the home or a folder above it (SFTP-5)."""

    @ON_ERROR
    @pytest.mark.parametrize("path", HOME_OR_ROOT)
    async def test_refused(self, path: str, on_error: str) -> None:
        await refuses(home_or_root_message(path), params("delete", path=path, on_error=on_error))

    @pytest.mark.parametrize(("path", "shown"), [(" / ", "/"), ("  ~ ", "~"), ("\t./\n", "./")])
    async def test_the_message_names_the_path_trimmed(self, path: str, shown: str) -> None:
        await refuses(home_or_root_message(shown), params("delete", path=path))

    @pytest.mark.parametrize("path", DELETABLE)
    async def test_wildcards_and_paths_below_the_home_are_allowed(self, path: str) -> None:
        await SFTPPlugin().validate(params("delete", path=path))

    @pytest.mark.parametrize("path", ["", "   "])
    async def test_a_blank_path_is_missing_not_refused(self, path: str) -> None:
        await refuses("Missing required parameter: path", params("delete", path=path))

    @pytest.mark.parametrize("operation", ["list", "stats", "create_folder"])
    async def test_other_path_operations_accept_the_root(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, path="/"))

    @pytest.mark.parametrize(
        ("operation", "rows"),
        [
            ("upload", {"destination": "/"}),
            ("download", {"source": "/"}),
            ("move", {"source": "sub", "destination": "/"}),
        ],
    )
    async def test_transfers_accept_the_root(self, operation: str, rows: dict[str, Any]) -> None:
        await SFTPPlugin().validate(params(operation, **rows))


MOVE_HOME_OR_ROOT = ["/", "//", ".", "./", "..", "a/..", "~", "~/"]
MOVABLE = ["sub", "/data/dir/.", "/data/dir/..", "~/x", "../x"]


def moved_message(source: str) -> str:
    return (
        f"{source} names the account's home, a folder above it or the SFTP server's root folder "
        "and cannot be moved"
    )


class TestMoveRefusesHomeOrRoot:
    """Move refuses a Source naming the server root, the home or a folder above it (SFTP-5)."""

    @ON_ERROR
    @pytest.mark.parametrize("source", MOVE_HOME_OR_ROOT)
    async def test_refused(self, source: str, on_error: str) -> None:
        await refuses(moved_message(source), params("move", source=source, on_error=on_error))

    @pytest.mark.parametrize(("source", "shown"), [(" / ", "/"), ("  ~ ", "~"), ("\t./\n", "./")])
    async def test_the_message_names_the_source_trimmed(self, source: str, shown: str) -> None:
        await refuses(moved_message(shown), params("move", source=source))

    @pytest.mark.parametrize("source", MOVABLE)
    async def test_paths_below_the_home_are_allowed(self, source: str) -> None:
        await SFTPPlugin().validate(params("move", source=source))

    async def test_refused_after_the_blank_checks(self) -> None:
        await refuses(
            "Missing required parameter: destination",
            params("move", source="/", destination=""),
        )

    async def test_refused_before_timeout(self) -> None:
        await refuses(moved_message("~"), params("move", source="~", timeout="x"))

    async def test_the_destination_may_be_the_root(self) -> None:
        await SFTPPlugin().validate(params("move", destination="/"))


class TestTimeout:
    """Timeout is a whole number of at least 1; blank runs with the default (SFTP-8)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["300", 1.5, 2.0, True, False, [1]])
    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_not_a_whole_number(self, operation: str, value: Any, on_error: str) -> None:
        await refuses(
            "Parameter 'timeout' must be an integer",
            params(operation, timeout=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", [0, -1, -300])
    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_below_one(self, operation: str, value: int, on_error: str) -> None:
        await refuses(
            "Timeout must be at least 1", params(operation, timeout=value, on_error=on_error)
        )

    @pytest.mark.parametrize("value", [ABSENT, None, "", 1, 300, 86400])
    async def test_accepted(self, value: Any) -> None:
        await SFTPPlugin().validate(params("download", timeout=value))


class TestDownloadLimits:
    """Max size (MiB) and Max files are whole numbers of 0 or more, on Download only (SFTP-6)."""

    @ON_ERROR
    @pytest.mark.parametrize(
        ("rows", "message"),
        [
            ({"max_size_mib": "1024"}, "Parameter 'max_size_mib' must be an integer"),
            ({"max_size_mib": 1.5}, "Parameter 'max_size_mib' must be an integer"),
            ({"max_size_mib": True}, "Parameter 'max_size_mib' must be an integer"),
            ({"max_files": "10"}, "Parameter 'max_files' must be an integer"),
            ({"max_files": 2.0}, "Parameter 'max_files' must be an integer"),
            ({"max_files": False}, "Parameter 'max_files' must be an integer"),
            ({"max_size_mib": -1}, "Max size (MiB) must be 0 or more"),
            ({"max_files": -1}, "Max files must be 0 or more"),
        ],
    )
    async def test_refused(self, rows: dict[str, Any], message: str, on_error: str) -> None:
        await refuses(message, params("download", on_error=on_error, **rows))

    @pytest.mark.parametrize(
        ("rows", "message"),
        [
            pytest.param(
                {"max_size_mib": "x", "max_files": "y"},
                "Parameter 'max_size_mib' must be an integer",
                id="size-type-before-files-type",
            ),
            pytest.param(
                {"max_size_mib": -1, "max_files": "y"},
                "Parameter 'max_files' must be an integer",
                id="both-types-before-any-floor",
            ),
            pytest.param(
                {"max_size_mib": -1, "max_files": -1},
                "Max size (MiB) must be 0 or more",
                id="size-floor-before-files-floor",
            ),
        ],
    )
    async def test_order(self, rows: dict[str, Any], message: str) -> None:
        await refuses(message, params("download", **rows))

    @pytest.mark.parametrize("value", [ABSENT, None, "", 0, 1, 1024, 10**9])
    async def test_accepted(self, value: Any) -> None:
        await SFTPPlugin().validate(params("download", max_size_mib=value, max_files=value))

    @pytest.mark.parametrize("operation", [op for op in OPERATIONS if op != "download"])
    async def test_not_checked_outside_download(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, max_size_mib="x", max_files=-1))


class TestSwitches:
    """Include subfolders (List) and Ignore missing (Delete) are booleans (SFTP-5, SFTP-9)."""

    @ON_ERROR
    @pytest.mark.parametrize("value", ["true", 1, 0, "yes"])
    async def test_include_subfolders_not_a_boolean(self, value: Any, on_error: str) -> None:
        await refuses(
            "Parameter 'recursive' must be a boolean",
            params("list", recursive=value, on_error=on_error),
        )

    @ON_ERROR
    @pytest.mark.parametrize("value", ["false", 1, 0, "no"])
    async def test_ignore_missing_not_a_boolean(self, value: Any, on_error: str) -> None:
        await refuses(
            "Parameter 'missing_ok' must be a boolean",
            params("delete", missing_ok=value, on_error=on_error),
        )

    @pytest.mark.parametrize("value", [ABSENT, None, True, False])
    async def test_accepted(self, value: Any) -> None:
        await SFTPPlugin().validate(params("list", recursive=value))
        await SFTPPlugin().validate(params("delete", missing_ok=value))

    @pytest.mark.parametrize("operation", [op for op in OPERATIONS if op != "list"])
    async def test_include_subfolders_not_checked_outside_list(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, recursive="yes"))

    @pytest.mark.parametrize("operation", [op for op in OPERATIONS if op != "delete"])
    async def test_ignore_missing_not_checked_outside_delete(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation, missing_ok="yes"))


class TestValidationOrder:
    """The first failing check in the documented order is the one reported."""

    @pytest.mark.parametrize(
        ("block", "message"),
        [
            pytest.param(
                {"operation": "copy", "on_error": "ignore", "session_id": ""},
                choice_message(
                    "operation",
                    "upload, download, list, stats, delete, move, create_folder",
                    "copy",
                ),
                id="operation-before-on-error",
            ),
            pytest.param(
                params("upload", on_error="ignore", if_exists="skip"),
                choice_message("on_error", "fail, record", "ignore"),
                id="on-error-before-if-exists",
            ),
            pytest.param(
                params("move", if_exists="skip", session_id=""),
                choice_message("if_exists", "overwrite, fail", "skip"),
                id="if-exists-before-session-id",
            ),
            pytest.param(
                params("upload", on_error="ignore", session_id=ABSENT),
                choice_message("on_error", "fail, record", "ignore"),
                id="choices-before-session-id",
            ),
            pytest.param(
                params("upload", session_id="", source="", destination=""),
                "Missing required parameter: session_id",
                id="session-id-before-source",
            ),
            pytest.param(
                params("move", source="", destination=""),
                "Missing required parameter: source",
                id="source-before-destination",
            ),
            pytest.param(
                params("delete", session_id=" ", path="/"),
                "Missing required parameter: session_id",
                id="session-id-before-home-or-root",
            ),
            pytest.param(
                params("delete", path="/", timeout="x"),
                home_or_root_message("/"),
                id="home-or-root-before-timeout",
            ),
            pytest.param(
                params("delete", path="~", missing_ok="yes"),
                home_or_root_message("~"),
                id="home-or-root-before-ignore-missing",
            ),
            pytest.param(
                params("upload", destination="", timeout="x"),
                "Missing required parameter: destination",
                id="destination-before-timeout",
            ),
            pytest.param(
                params("stats", path="", timeout=0),
                "Missing required parameter: path",
                id="path-before-timeout",
            ),
            pytest.param(
                params("download", timeout=0, max_size_mib="x"),
                "Timeout must be at least 1",
                id="timeout-floor-before-limits",
            ),
            pytest.param(
                params("download", timeout="x", max_files=-1),
                "Parameter 'timeout' must be an integer",
                id="timeout-type-before-limits",
            ),
            pytest.param(
                params("list", timeout=0, recursive="yes"),
                "Timeout must be at least 1",
                id="timeout-before-include-subfolders",
            ),
            pytest.param(
                params("delete", timeout=-1, missing_ok="yes"),
                "Timeout must be at least 1",
                id="timeout-before-ignore-missing",
            ),
        ],
    )
    async def test_first_failure_wins(self, block: dict[str, Any], message: str) -> None:
        await refuses(message, block)


class TestValidBlocks:
    """A complete block passes for every operation, and a Delete of a pattern passes (SFTP-3)."""

    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_minimal_block(self, operation: str) -> None:
        await SFTPPlugin().validate(params(operation))

    @pytest.mark.parametrize("operation", OPERATIONS)
    async def test_every_row_set_to_a_valid_value(self, operation: str) -> None:
        block = params(
            operation,
            if_exists="fail",
            recursive=True,
            missing_ok=True,
            timeout=60,
            max_size_mib=0,
            max_files=0,
            on_error="record",
        )

        await SFTPPlugin().validate(block)
