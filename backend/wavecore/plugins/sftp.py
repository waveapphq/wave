"""SFTP Plugin: file transfers and file management on an SSH session's server (REQ-3.4.1.8)."""

from functools import partial
from typing import Any

from wavecore.core.remote_exec.materialize import materialize
from wavecore.plugins import _sftp_ops
from wavecore.plugins._shared_params import (
    blank,
    check_at_least,
    check_boolean,
    check_integer,
    check_limits,
    chosen,
    gate,
    limit_parameters,
    on_error_parameter,
    output_core,
    select_parameter,
    timeout_parameter,
)
from wavecore.plugins._ssh_session import session_id_param
from wavecore.plugins._verb_bridge import log_via
from wavecore.plugins.base import PluginBase

# Each select's wire values in order, then its default.
_CHOICES: dict[str, tuple[list[str], str]] = {
    "operation": (list(_sftp_ops.OPERATIONS), "upload"),
    "if_exists": (["overwrite", "fail"], "overwrite"),
    "on_error": (["fail", "record"], "fail"),
}
_TRANSFERS = ("upload", "download", "move")
_PATH_OPERATIONS = ("list", "stats", "delete", "create_folder")
# The rows each operation cannot run without, in wire order.
_REQUIRED_ROWS: dict[str, tuple[str, ...]] = {
    "upload": ("source", "destination"),
    "download": ("source",),
    "move": ("source", "destination"),
    **{operation: ("path",) for operation in _PATH_OPERATIONS},
}

_select = partial(select_parameter, _CHOICES)
_choice = partial(chosen, _CHOICES)


def _when(**texts: str) -> list[dict[str, Any]]:
    """The description a row shows in place of its base one under each other operation."""
    return [
        {"when": [gate("operation", operation)], "description": text}
        for operation, text in texts.items()
    ]


def _path_row(
    name: str, required_for: tuple[str, ...], shown_for: tuple[str, ...], **extra: Any
) -> dict[str, Any]:
    return {
        "name": name,
        "type": "string",
        "trim": True,
        "required_when": gate("operation", *required_for),
        "show_when": gate("operation", *shown_for),
        **extra,
    }


class SFTPPlugin(PluginBase):
    """Uploads, downloads, lists, inspects, deletes, moves and creates files over SFTP."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "sftp",
            "name": "SFTP",
            "version": "1.0.0",
            "category": "remote",
            "description": (
                "Moves files between WAVE and the server of an open SSH session over SFTP, and "
                "lists, inspects, deletes, moves and creates files and folders on that server."
            ),
            "parameters": [
                session_id_param(),
                _select(
                    "operation",
                    "What to do. Upload and Download move files between WAVE and the server; "
                    "List, Stats, Delete, Move and Create folder work on the server.",
                    required=True,
                ),
                _path_row(
                    "source",
                    _TRANSFERS,
                    _TRANSFERS,
                    description=(
                        "File or folder on WAVE to upload: testdata://, artifact:// or an "
                        "absolute or relative path. A folder goes with everything inside it; *, ? "
                        "and [...] match several files."
                    ),
                    description_when=_when(
                        download=(
                            "File or folder on the server to download. A folder comes with "
                            "everything inside it; *, ? and [...] match several files."
                        ),
                        move="File or folder on the server to move or rename.",
                    ),
                ),
                _path_row(
                    "destination",
                    ("upload", "move"),
                    _TRANSFERS,
                    description=(
                        "Where it goes on the server. An existing folder or a path ending in / "
                        "keeps the names; any other path is the new name, for one file only. "
                        "Missing folders are created."
                    ),
                    description_when=_when(
                        download=(
                            "Where it lands on WAVE: artifact:// or an absolute or relative path; "
                            "testdata:// is read-only. Empty puts it in the run's artifacts under "
                            "its own name. An existing folder or a path ending in / keeps the "
                            "names; any other path is the new name, for one file only."
                        ),
                        move=(
                            "The new path on the server. An existing folder or a path ending in "
                            "/ keeps the name."
                        ),
                    ),
                ),
                _path_row(
                    "path",
                    _PATH_OPERATIONS,
                    _PATH_OPERATIONS,
                    description=(
                        "Folder on the server to list, or a pattern: *, ? and [...] list only the "
                        "matching entries. No match gives no entries and a Count of 0."
                    ),
                    description_when=_when(
                        stats=(
                            "File or folder on the server to report on. A missing path is not an "
                            "error: Exists is false."
                        ),
                        delete=(
                            "File or folder on the server to delete; a folder goes with "
                            "everything inside it, and *, ? and [...] delete every match. A path "
                            "that names the account's home or the server root (empty, ., ~ or /) "
                            "is refused."
                        ),
                        create_folder=(
                            "Folder to create on the server, including its name. Missing parent "
                            "folders are created."
                        ),
                    ),
                ),
                _select(
                    "if_exists",
                    "What happens when a file is already at the destination: Replace it "
                    "overwrites it; Fail the block stops before anything is written.",
                    show_when=gate("operation", *_TRANSFERS),
                ),
                {
                    "name": "recursive",
                    "type": "boolean",
                    "default": False,
                    "show_when": gate("operation", "list"),
                    "description": "List the entries inside subfolders too, at every depth.",
                },
                {
                    "name": "missing_ok",
                    "type": "boolean",
                    "default": False,
                    "show_when": gate("operation", "delete"),
                    "description": (
                        "Pass when the path or pattern matches nothing, instead of failing the "
                        "block."
                    ),
                },
                timeout_parameter(
                    _sftp_ops.TIMEOUT_DEFAULT,
                    "Seconds the whole block may take, every file of a folder included.",
                ),
                *limit_parameters(
                    max_size_mib=_sftp_ops.MAX_SIZE_MIB_DEFAULT,
                    max_files=_sftp_ops.MAX_FILES_DEFAULT,
                    show_when=gate("operation", "download"),
                    size_description=(
                        "Largest total a download may bring, in MiB. The block adds up the match "
                        "before it writes anything and refuses a larger one. 0 means no limit."
                    ),
                    files_description=(
                        "Most files a download may bring. The block counts the match before it "
                        "writes anything and refuses more. 0 means no limit."
                    ),
                ),
                on_error_parameter(
                    "Fail the block on a run-time failure, or record it in Error and Reason and "
                    "continue."
                ),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "summary",
                    "type": "table",
                    "show_when": gate("operation", "upload", "download"),
                    "description": "One row per file transferred: source, destination and size.",
                },
                {
                    "name": "entries",
                    "type": "table",
                    "show_when": gate("operation", "list"),
                    "description": (
                        "One row per entry: name, path, type, modified and size. Include "
                        "subfolders adds the entries of every subfolder."
                    ),
                },
                {
                    "name": "count",
                    "type": "integer",
                    "show_when": gate("operation", "list"),
                    "description": "Number of entries; 0 when nothing matches.",
                },
                {
                    "name": "exists",
                    "type": "boolean",
                    "show_when": gate("operation", "stats"),
                    "description": "True when the path is there on the server.",
                },
                {
                    "name": "type",
                    "type": "string",
                    "show_when": gate("operation", "stats"),
                    "description": (
                        "Whether the path is a file or a folder; empty when the path is missing."
                    ),
                },
                {
                    "name": "size",
                    "type": "integer",
                    "show_when": gate("operation", "stats"),
                    "description": "Size in bytes of a file; 0 for a folder or a missing path.",
                },
                {
                    "name": "modified",
                    "type": "string",
                    "show_when": gate("operation", "stats"),
                    "description": "Last modified, ISO-8601 UTC; empty when the path is missing.",
                },
                *output_core(
                    gated=True,
                    success_description=(
                        "True when the operation finished. False when the block failed and On "
                        "error is Record and continue."
                    ),
                    reason_description=_sftp_ops.REASONS,
                ),
            ],
            "author": "WAVE Framework",
            "tags": ["sftp", "ssh", "remote", "file", "transfer"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Refuse a misconfigured block, checking only the rows the operation uses."""
        operation = _choice(params, "operation")
        _choice(params, "on_error")
        if operation in _TRANSFERS:
            _choice(params, "if_exists")
        for name in ("session_id", *_REQUIRED_ROWS[operation]):
            if blank(params.get(name)):
                raise ValueError(f"Missing required parameter: {name}")
        path = str(params.get("path") or "").strip()
        if operation == "delete" and _sftp_ops.names_home_or_root(path):
            raise ValueError(_sftp_ops.home_or_root_message(path, "deleted"))
        source = str(params.get("source") or "").strip()
        if operation == "move" and _sftp_ops.names_home_or_root(source):
            raise ValueError(_sftp_ops.home_or_root_message(source, "moved"))
        check_integer(params, "timeout")
        check_at_least(params, "timeout", 1, "Timeout must be at least 1")
        if operation == "download":
            check_limits(params)
        if operation == "list":
            check_boolean(params, "recursive")
        if operation == "delete":
            check_boolean(params, "missing_ok")

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the block on WAVE over one SFTP channel of the session it names."""
        envelope = await _sftp_ops.run(
            context["parameters"],
            log_via(context["logger"]),
            registry=context.get("ssh_session_registry"),
            wave=_sftp_ops.WaveSide(context.get("artifacts_dir"), context.get("testdata_dirs")),
        )
        outputs: dict[str, Any] = materialize(envelope, context.get("register_secret"))
        return outputs
