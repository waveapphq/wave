"""K8s Copy plugin tests (REQ-5.1.1, REQ-3.4.1.5).

Copy moves files between a pod and the WAVE side over the same exec channel K8s
Exec uses, and never opens stdin in either direction. Pulling runs
`tar cf -` in the pod and writes each file of its streamed output on the WAVE
side as it arrives, within Max size (MiB) and Max files (K8SEXEC-10); pushing builds
the tar on the WAVE side, base64-encodes it, creates a private staging directory
beside the target, appends the payload to a scratch file in it one argv element
at a time, then runs one exec that decodes, untars and removes the directory.
The only unique output is Summary, one row per file. Error and Reason are
gated on Record and continue; Success never is.

The exec seams are sync and reached through asyncio.to_thread, so both fakes
are plain sync callables - an AsyncMock would be handed to to_thread as a
coroutine and silently never run.
"""

import base64
import io
import posixpath
import re
import subprocess
import tarfile
from contextlib import ExitStack
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    EMPTY_SESSION_MESSAGE,
    GROUPS_WITHOUT_USER_MESSAGE,
    MISSING_SESSION_MESSAGE,
    NAMESPACE,
    ExecCall,
    FakeExecChannel,
    FakeExecStdout,
    block_params,
    exact,
    execute_context,
    patch_exec,
    patch_pull,
)
from wavecore.connectivity.k8s.verbs import cp
from wavecore.connectivity.k8s.ws import (
    ExecOutputTooLarge,
    ExecRejected,
    ExecTimeout,
    ExecTransportError,
)
from wavecore.core.table import Table
from wavecore.plugins.k8s_copy import K8sCopyPlugin

_READ_ONLY_MESSAGE = (
    "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
)

EXPECTED_PARAM_ORDER = [
    "session",
    "timeout",
    "direction",
    "pod",
    "container",
    "source_path",
    "target_path",
    "no_preserve",
    "namespace",
    "impersonate_user",
    "impersonate_groups",
    "max_size_mib",
    "max_files",
    "on_error",
]

EXPECTED_OUTPUT_ORDER = ["summary", "success", "error", "reason"]

SUMMARY_COLUMNS = ["SOURCE", "TARGET", "SIZE"]
SUMMARY_COLUMN_TYPES = ["string", "string", "integer"]

RECORD_GATE = {"field": "on_error", "values": ["record"]}

TIMEOUT_DEFAULT = 60
TIMEOUT_DESCRIPTION = f"Request timeout in seconds. Default: {TIMEOUT_DEFAULT}."

# Linux caps a single argv string at MAX_ARG_STRLEN; 131,071 usable bytes, measured live.
MAX_ARG_STRLEN = 131_072
CHUNK_SIZE = 32_768

STAGE_NAME_PATTERN = r"^wave-cp-[0-9a-f]+$"
SCRATCH_NAME = "payload.b64"
APPEND_SCRIPT = 'printf %s "$1" >> "$2"'
EXTRACT_SCRIPT = 'base64 -d "$1" | tar -xmf - -C "$2"; rc=$?; rm -rf "$3"; exit $rc'
EXTRACT_SCRIPT_NO_PRESERVE = (
    'base64 -d "$1" | tar --no-same-permissions --no-same-owner -xmf - -C "$2"; '
    'rc=$?; rm -rf "$3"; exit $rc'
)
EXTRACT_SCRIPTS = [EXTRACT_SCRIPT, EXTRACT_SCRIPT_NO_PRESERVE]
SHELL = "/bin/sh"

MIB = 1_048_576
PUSH_OUTPUT_CEILING = 256 * MIB
MAX_SIZE_MIB_DEFAULT = 256
MAX_FILES_DEFAULT = 10_000
TOO_LARGE_REASON = "ArchiveTooLarge"
TOO_MANY_REASON = "ArchiveTooManyEntries"
OUTPUT_TOO_LARGE_REASON = "OutputTooLarge"
CEILING_MESSAGE = "Kubernetes exec channel produced more than 256 MiB of output"

MAX_SIZE_DESCRIPTION = (
    "Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes "
    "over and removes what it wrote. 0 means no limit."
)
MAX_FILES_DESCRIPTION = (
    "Most files a copy from the pod may write. The copy stops the moment it goes over and "
    "removes what it wrote. 0 means no limit."
)
FROM_POD_GATE = {"field": "direction", "values": ["from_pod"]}
MAX_SIZE_NOT_INTEGER = "Parameter 'max_size_mib' must be an integer"
MAX_SIZE_BELOW_ZERO = "Max size (MiB) must be 0 or more"
MAX_FILES_NOT_INTEGER = "Parameter 'max_files' must be an integer"
MAX_FILES_BELOW_ZERO = "Max files must be 0 or more"

# Bytes no UTF-8 decoder can represent; a plain .encode() or errors="replace" loses them.
RAW_BYTES = b"\xff\xfe\x80\x9c\x00 tar payload \xc3\x28 \xed\xa0\x80"
EVERY_BYTE = bytes(range(256)) * 8
HALF_MIB = b"h" * (MIB // 2)
THREE_FILES: list[tuple[str, bytes | None]] = [
    ("srv/work/data/a.txt", b"A"),
    ("srv/work/data/sub/b.txt", b"BB"),
    ("srv/work/data/sub/c.txt", b"CCC"),
]

POD = "web-1"
CONTAINER = "app"
POD_FILE = "/srv/work/src.txt"
POD_DIR = "/srv/work/data"
POD_DEST_DIR = "/srv/work/dest"
POD_DEST_FILE = f"{POD_DEST_DIR}/dst.txt"
POD_DEST_TREE = f"{POD_DEST_DIR}/data"
POD_APP_DIR = "/srv/app"
POD_APP_FILE = f"{POD_APP_DIR}/dst.txt"

DIRECTION_DESCRIPTION = (
    "Which way the file moves: out of the pod onto the WAVE side, or from WAVE into the pod."
)
POD_DESCRIPTION = "The pod to copy from or to."
CONTAINER_DESCRIPTION = "Which container in the pod to use. Name it even when the pod has only one."
NO_PRESERVE_DESCRIPTION = (
    "Do not carry the file's permissions and ownership across. "
    "kubectl preserves them by default."
)
SUMMARY_DESCRIPTION = "One row per file: where it came from, where it landed, and its size."

FROM_POD_SOURCE_DESCRIPTION = "The file or directory inside the pod to copy."
FROM_POD_TARGET_DESCRIPTION = (
    "Where to put it on the WAVE side: an artifact path, or an absolute or relative path where "
    "the block runs."
)
TO_POD_SOURCE_DESCRIPTION = (
    "The file or directory on the WAVE side to copy: an artifact path, or an absolute or "
    "relative path where the block runs."
)
TO_POD_TARGET_DESCRIPTION = "Where to put it inside the pod."

TO_POD_GATE = [{"field": "direction", "values": ["to_pod"]}]

EMPTY_SOURCE_MESSAGE = "Parameter 'source_path' cannot be empty"
EMPTY_TARGET_MESSAGE = "Parameter 'target_path' cannot be empty"

_SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)

_CORE_DESCRIPTIONS = {
    "success": (
        "True when the cluster carried out the operation without error; false when "
        "On error is Record and continue and the cluster refused it"
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty otherwise"
    ),
    "reason": (
        "The cluster reason for the failure, like NotFound or Forbidden; empty when the "
        "operation succeeded"
    ),
}

_BOTH_MODES = pytest.mark.parametrize("mode", ["fail", "record"])


def _over_size_detail(max_size_mib: int) -> str:
    return (
        f"the copy is larger than the {max_size_mib} MiB Max size (MiB) allows; "
        "copy a narrower path or raise Max size (MiB)"
    )


def _over_files_detail(max_files: int) -> str:
    return (
        f"the copy holds more files than the {max_files} Max files allows; "
        "copy fewer files or raise Max files"
    )


def _pull_message(detail: str, container: str = CONTAINER) -> str:
    clause = f" (container '{container}')"
    return f"Could not copy from pod '{POD}'{clause} in namespace '{NAMESPACE}': {detail}"


def _push_message(detail: str, container: str = CONTAINER) -> str:
    clause = f" (container '{container}')"
    return f"Could not copy to pod '{POD}'{clause} in namespace '{NAMESPACE}': {detail}"


def _params_by_name(plugin: K8sCopyPlugin) -> dict[str, dict[str, Any]]:
    return {p["name"]: p for p in plugin.metadata["parameters"]}


def _outputs_by_name(plugin: K8sCopyPlugin) -> dict[str, dict[str, Any]]:
    return {o["name"]: o for o in plugin.metadata["output_schema"]}


def _valid_params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "pod": POD,
        "container": CONTAINER,
        "source_path": POD_FILE,
        "target_path": "/wave/out.txt",
    }
    params.update(overrides)
    return block_params(**params)


def _pull_params(target: str, **overrides: Any) -> dict[str, Any]:
    pulled: dict[str, Any] = {"direction": "from_pod", "target_path": target}
    pulled.update(overrides)
    return _valid_params(**pulled)


def _push_params(source: str, **overrides: Any) -> dict[str, Any]:
    pushed: dict[str, Any] = {
        "direction": "to_pod",
        "source_path": source,
        "target_path": POD_DEST_FILE,
    }
    pushed.update(overrides)
    return _valid_params(**pushed)


def _tar(members: list[tuple[str, bytes | None]]) -> bytes:
    """A tar stream; a member whose content is None is a directory entry."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, content in members:
            if content is None:
                info = tarfile.TarInfo(name)
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
                continue
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def _header_only(size: int) -> bytes:
    """A stream that ends right after one regular file's header, which claims size bytes."""
    info = tarfile.TarInfo(POD_FILE.lstrip("/"))
    info.size = size
    return info.tobuf()


def _empty_files(count: int) -> bytes:
    """A tar of count zero-byte files at one path, header by header, cheap to build and read."""
    return tarfile.TarInfo("srv/work/data/f.txt").tobuf() * count + b"\0" * 1024


def _pull_stream(tar_bytes: bytes, **script: Any) -> FakeExecStdout:
    """The pod's tar on standard output as a stream; exit code 0 unless scripted."""
    return FakeExecStdout(tar_bytes, **script)


def _push_channel(execs: int = 16) -> FakeExecChannel:
    return FakeExecChannel([("", "", 0)] * execs)


async def _execute(
    fake: FakeExecStdout | FakeExecChannel,
    params: dict[str, Any],
    logger: Any = None,
    artifacts_dir: str | None = None,
) -> Any:
    """Run the block against the seam its direction reaches: a pull streams, a push accumulates."""
    with ExitStack() as stack:
        if isinstance(fake, FakeExecStdout):
            stack.enter_context(patch_pull(fake))
        else:
            stack.enter_context(patch_exec(fake))
        return await K8sCopyPlugin().execute(
            execute_context(params, logger=logger, artifacts_dir=artifacts_dir)
        )


def _stage(channel: FakeExecChannel) -> str:
    """The staging directory the first exec of a push created."""
    return channel.calls[0].command[1]


def _chunk_calls(channel: FakeExecChannel) -> list[ExecCall]:
    """Every append exec: the mkdir leads and the extract exec trails."""
    return channel.calls[1:-1]


def _chunks(channel: FakeExecChannel) -> list[str]:
    """The base64 payload argument of every chunk exec, in order."""
    return [call.command[4] for call in _chunk_calls(channel)]


def _scratch(channel: FakeExecChannel) -> str:
    """The scratch file every append exec names."""
    return _chunk_calls(channel)[0].command[5]


def _run_extract(script: str, tmp_path: Any, payload: bytes) -> tuple[int, Any, Any]:
    """Run one extract script under a real shell, staged the way a push stages it."""
    into = tmp_path / "dest"
    into.mkdir(parents=True)
    stage = into / "wave-cp-0123456789abcdef"
    stage.mkdir()
    scratch = stage / SCRATCH_NAME
    scratch.write_text(base64.b64encode(payload).decode("ascii"))
    completed = subprocess.run(
        [SHELL, "-c", script, "sh", str(scratch), str(into), str(stage)],
        capture_output=True,
        timeout=60,
        check=False,
    )
    return completed.returncode, into, stage


def _pushed_tar(channel: FakeExecChannel) -> bytes:
    return base64.b64decode("".join(_chunks(channel)))


def _pushed_names(channel: FakeExecChannel) -> list[str]:
    with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
        return [member.name for member in archive.getmembers() if member.isfile()]


def _final(channel: FakeExecChannel) -> ExecCall:
    return channel.calls[-1]


def _rows(result: Any) -> list[list[Any]]:
    table = result["summary"]
    return [list(table.row(index).to_list()) for index in range(table.row_count())]


class TestMetadata:
    """Plugin identity, the fourteen parameters, and the four declared outputs."""

    def test_plugin_instantiates(self) -> None:
        assert K8sCopyPlugin() is not None

    def test_identity(self) -> None:
        meta = K8sCopyPlugin().metadata

        assert meta["id"] == "k8s-copy"
        assert meta["name"] == "K8s Copy"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "kubernetes"
        assert meta["return_type"] == "map"

    def test_authorship_and_tags(self) -> None:
        meta = K8sCopyPlugin().metadata

        assert meta["author"] == "WAVE Framework"
        assert meta["tags"][:2] == ["kubernetes", "k8s"]

    def test_the_block_carries_a_description(self) -> None:
        assert K8sCopyPlugin().metadata["description"]

    def test_remotable_is_true(self) -> None:
        assert K8sCopyPlugin().metadata["remotable"] is True

    def test_proxy_support_is_supported(self) -> None:
        assert K8sCopyPlugin().metadata["proxy_support"] == "supported"

    def test_parameter_names_and_order(self) -> None:
        names = [p["name"] for p in K8sCopyPlugin().metadata["parameters"]]

        assert names == EXPECTED_PARAM_ORDER

    def test_the_parameter_list_is_exactly_fourteen_rows(self) -> None:
        assert len(K8sCopyPlugin().metadata["parameters"]) == 14

    def test_parameter_types(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["session"]["type"] == "string"
        assert params["timeout"]["type"] == "integer"
        assert params["direction"]["type"] == "string"
        assert params["pod"]["type"] == "string"
        assert params["container"]["type"] == "string"
        assert params["source_path"]["type"] == "string"
        assert params["target_path"]["type"] == "string"
        assert params["no_preserve"]["type"] == "boolean"
        assert params["namespace"]["type"] == "string"
        assert params["impersonate_user"]["type"] == "string"
        assert params["impersonate_groups"]["type"] == "string"
        assert params["max_size_mib"]["type"] == "integer"
        assert params["max_files"]["type"] == "integer"
        assert params["on_error"]["type"] == "string"

    def test_required_flags(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        required = [name for name in EXPECTED_PARAM_ORDER if params[name].get("required")]

        assert required == [
            "session",
            "direction",
            "pod",
            "container",
            "source_path",
            "target_path",
        ]

    def test_the_rest_declare_required_false(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        optional = ("timeout", "no_preserve", "namespace")

        limits = ("max_size_mib", "max_files")
        for name in optional + ("impersonate_user", "impersonate_groups", *limits, "on_error"):
            assert params[name].get("required") is False

    def test_defaults(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["timeout"]["default"] == TIMEOUT_DEFAULT
        assert params["direction"]["default"] == "from_pod"
        assert params["no_preserve"]["default"] is False
        assert params["max_size_mib"]["default"] == MAX_SIZE_MIB_DEFAULT
        assert params["max_files"]["default"] == MAX_FILES_DEFAULT
        assert params["on_error"]["default"] == "fail"

    def test_the_timeout_description_states_the_sixty_second_default(self) -> None:
        assert _params_by_name(K8sCopyPlugin())["timeout"]["description"] == TIMEOUT_DESCRIPTION

    def test_the_pod_and_path_rows_carry_no_default(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        for name in ("pod", "container", "source_path", "target_path"):
            assert "default" not in params[name]

    def test_the_path_rows_carry_no_remote_host_path_flag(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        for name in ("source_path", "target_path"):
            assert "remote_host_path_only" not in params[name]

    def test_only_the_session_parameter_is_secret(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["session"]["secret"] is True
        for name in EXPECTED_PARAM_ORDER:
            if name == "session":
                continue
            assert params[name].get("secret") is not True

    def test_identifier_params_declare_trim(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        for name in (
            "session",
            "pod",
            "container",
            "source_path",
            "target_path",
            "namespace",
            "impersonate_user",
            "impersonate_groups",
        ):
            assert params[name]["trim"] is True

    def test_enum_values(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["direction"]["enum_values"] == ["from_pod", "to_pod"]
        assert params["on_error"]["enum_values"] == ["fail", "record"]

    def test_only_direction_and_on_error_are_enums(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        enum_params = {name for name, param in params.items() if "enum_values" in param}

        assert enum_params == {"direction", "on_error"}

    def test_every_parameter_carries_a_description(self) -> None:
        for param in K8sCopyPlugin().metadata["parameters"]:
            assert param.get("description")

    def test_the_copy_group_descriptions(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["direction"]["description"] == DIRECTION_DESCRIPTION
        assert params["pod"]["description"] == POD_DESCRIPTION
        assert params["container"]["description"] == CONTAINER_DESCRIPTION
        assert params["no_preserve"]["description"] == NO_PRESERVE_DESCRIPTION

    def test_the_path_rows_read_as_pod_paths_under_the_default_direction(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["source_path"]["description"] == FROM_POD_SOURCE_DESCRIPTION
        assert params["target_path"]["description"] == FROM_POD_TARGET_DESCRIPTION

    def test_the_path_rows_swap_sides_under_to_pod(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["source_path"]["description_when"] == [
            {"when": TO_POD_GATE, "description": TO_POD_SOURCE_DESCRIPTION}
        ]
        assert params["target_path"]["description_when"] == [
            {"when": TO_POD_GATE, "description": TO_POD_TARGET_DESCRIPTION}
        ]

    def test_only_the_two_path_rows_carry_direction_dependent_text(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        varying = [name for name in EXPECTED_PARAM_ORDER if "description_when" in params[name]]

        assert varying == ["source_path", "target_path"]

    def test_output_schema(self) -> None:
        outputs = K8sCopyPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("summary", "table"),
            ("success", "boolean"),
            ("error", "string"),
            ("reason", "string"),
        ]

    def test_the_output_list_is_exactly_four_rows(self) -> None:
        assert len(K8sCopyPlugin().metadata["output_schema"]) == 4

    def test_the_summary_description(self) -> None:
        assert _outputs_by_name(K8sCopyPlugin())["summary"]["description"] == SUMMARY_DESCRIPTION

    def test_no_output_is_flagged_secret(self) -> None:
        for output in K8sCopyPlugin().metadata["output_schema"]:
            assert output.get("secret") is not True

    def test_every_output_carries_a_description(self) -> None:
        for output in K8sCopyPlugin().metadata["output_schema"]:
            assert output.get("description")

    def test_the_output_core_reads_the_same_for_every_verb(self) -> None:
        outputs = _outputs_by_name(K8sCopyPlugin())

        assert {
            name: outputs[name]["description"] for name in _CORE_DESCRIPTIONS
        } == _CORE_DESCRIPTIONS

    def test_no_output_declares_type_rules(self) -> None:
        for output in K8sCopyPlugin().metadata["output_schema"]:
            assert "type_when" not in output


class TestLimitRows:
    """Max size (MiB) and Max files: shown for From Pod only, 0 = no limit (K8SEXEC-10)."""

    def test_the_max_size_row(self) -> None:
        assert _params_by_name(K8sCopyPlugin())["max_size_mib"] == {
            "name": "max_size_mib",
            "type": "integer",
            "required": False,
            "default": MAX_SIZE_MIB_DEFAULT,
            "minimum": 0,
            "show_when": FROM_POD_GATE,
            "description": MAX_SIZE_DESCRIPTION,
        }

    def test_the_max_files_row(self) -> None:
        assert _params_by_name(K8sCopyPlugin())["max_files"] == {
            "name": "max_files",
            "type": "integer",
            "required": False,
            "default": MAX_FILES_DEFAULT,
            "minimum": 0,
            "show_when": FROM_POD_GATE,
            "description": MAX_FILES_DESCRIPTION,
        }

    def test_the_limit_rows_sit_after_impersonation_and_before_on_error(self) -> None:
        names = [p["name"] for p in K8sCopyPlugin().metadata["parameters"]]

        assert names[-5:] == [
            "impersonate_user",
            "impersonate_groups",
            "max_size_mib",
            "max_files",
            "on_error",
        ]

    def test_the_limit_rows_declare_no_maximum(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        for name in ("max_size_mib", "max_files"):
            assert "maximum" not in params[name]

    def test_only_the_limit_rows_are_gated_on_direction(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        gated = [name for name in EXPECTED_PARAM_ORDER if "show_when" in params[name]]

        assert gated == ["max_size_mib", "max_files"]

    def test_the_limit_defaults_are_the_verbs_own_constants(self) -> None:
        params = _params_by_name(K8sCopyPlugin())

        assert params["max_size_mib"]["default"] == cp.MAX_SIZE_MIB_DEFAULT
        assert params["max_files"]["default"] == cp.MAX_FILES_DEFAULT

    def test_the_limit_defaults_follow_the_verb_constants(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(cp, "MAX_SIZE_MIB_DEFAULT", 64)
        monkeypatch.setattr(cp, "MAX_FILES_DEFAULT", 500)
        params = _params_by_name(K8sCopyPlugin())

        assert params["max_size_mib"]["default"] == 64
        assert params["max_files"]["default"] == 500


class TestDeliberateAbsences:
    """The rows and outputs the sheet deliberately does not carry."""

    def test_no_count_output_is_declared(self) -> None:
        outputs = _outputs_by_name(K8sCopyPlugin())

        for name in ("count", "file_count", "files_copied"):
            assert name not in outputs

    def test_no_list_of_paths_output_is_declared(self) -> None:
        outputs = _outputs_by_name(K8sCopyPlugin())

        for name in ("files", "paths", "copied", "targets", "sources"):
            assert name not in outputs

    def test_summary_is_the_only_output_beyond_the_core(self) -> None:
        names = [o["name"] for o in K8sCopyPlugin().metadata["output_schema"]]

        assert names == EXPECTED_OUTPUT_ORDER

    def test_no_output_is_typed_array_or_integer(self) -> None:
        types = {o["type"] for o in K8sCopyPlugin().metadata["output_schema"]}

        assert types == {"table", "boolean", "string"}

    def test_no_retries_row_is_declared(self) -> None:
        names = [p["name"] for p in K8sCopyPlugin().metadata["parameters"]]

        assert [name for name in names if "retr" in name] == []

    def test_no_stdin_row_is_declared(self) -> None:
        assert "stdin" not in _params_by_name(K8sCopyPlugin())

    def test_the_timeout_and_the_two_limits_are_the_only_integer_rows(self) -> None:
        params = _params_by_name(K8sCopyPlugin())
        integers = [name for name in EXPECTED_PARAM_ORDER if params[name]["type"] == "integer"]

        assert integers == ["timeout", "max_size_mib", "max_files"]

    def test_the_block_declares_no_all_namespaces_row(self) -> None:
        assert "all_namespaces" not in _params_by_name(K8sCopyPlugin())


class TestValidation:
    """validate() - session, impersonation, the direction enum, both paths, the timeout."""

    async def test_default_params_pass(self) -> None:
        await K8sCopyPlugin().validate(_valid_params())

    async def test_full_params_pass(self) -> None:
        await K8sCopyPlugin().validate(
            _valid_params(
                timeout=45,
                direction="to_pod",
                no_preserve=True,
                namespace="ops",
                impersonate_user="qa-bot",
                impersonate_groups="dev, ops",
                on_error="record",
            )
        )

    async def test_an_absent_direction_passes_and_falls_back_to_the_default(self) -> None:
        params = _valid_params()

        assert "direction" not in params
        await K8sCopyPlugin().validate(params)

    async def test_missing_session(self) -> None:
        params = {"pod": POD, "source_path": POD_FILE, "target_path": "/wave/out.txt"}

        with pytest.raises(ValueError, match=exact(MISSING_SESSION_MESSAGE)):
            await K8sCopyPlugin().validate(params)

    async def test_empty_session_reports_the_empty_case(self) -> None:
        params = _valid_params()
        params["session"] = ""

        with pytest.raises(ValueError, match=exact(EMPTY_SESSION_MESSAGE)):
            await K8sCopyPlugin().validate(params)

    async def test_impersonation_groups_without_a_user_are_refused(self) -> None:
        with pytest.raises(ValueError, match=exact(GROUPS_WITHOUT_USER_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(impersonate_groups="qa, ops"))

    async def test_impersonation_groups_with_a_user_pass(self) -> None:
        await K8sCopyPlugin().validate(
            _valid_params(impersonate_user="dev", impersonate_groups="qa, ops")
        )

    async def test_an_invalid_direction_is_rejected(self) -> None:
        message = (
            "Parameter 'direction' must be one of: from_pod, to_pod; Actual value was 'sideways'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sCopyPlugin().validate(_valid_params(direction="sideways"))

    async def test_the_direction_enum_is_case_sensitive(self) -> None:
        message = (
            "Parameter 'direction' must be one of: from_pod, to_pod; Actual value was 'From_Pod'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sCopyPlugin().validate(_valid_params(direction="From_Pod"))

    async def test_kubectl_argument_order_is_not_a_direction(self) -> None:
        message = "Parameter 'direction' must be one of: from_pod, to_pod; Actual value was 'in'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sCopyPlugin().validate(_valid_params(direction="in"))

    async def test_invalid_on_error_is_rejected(self) -> None:
        message = "Parameter 'on_error' must be one of: fail, record; Actual value was 'ignore'."

        with pytest.raises(ValueError, match=exact(message)):
            await K8sCopyPlugin().validate(_valid_params(on_error="ignore"))

    async def test_missing_pod_is_rejected(self) -> None:
        params = _valid_params()
        del params["pod"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sCopyPlugin().validate(params)

    async def test_empty_pod_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: pod$"):
            await K8sCopyPlugin().validate(_valid_params(pod=""))

    async def test_missing_container_is_rejected(self) -> None:
        params = _valid_params()
        del params["container"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sCopyPlugin().validate(params)

    async def test_empty_container_counts_as_missing(self) -> None:
        with pytest.raises(ValueError, match=r"^Missing required parameter: container$"):
            await K8sCopyPlugin().validate(_valid_params(container=""))

    async def test_missing_source_path_is_rejected(self) -> None:
        params = _valid_params()
        del params["source_path"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: source_path$"):
            await K8sCopyPlugin().validate(params)

    async def test_missing_target_path_is_rejected(self) -> None:
        params = _valid_params()
        del params["target_path"]

        with pytest.raises(ValueError, match=r"^Missing required parameter: target_path$"):
            await K8sCopyPlugin().validate(params)

    async def test_an_empty_source_path_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SOURCE_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(source_path=""))

    async def test_a_whitespace_only_source_path_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SOURCE_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(source_path="   "))

    async def test_an_empty_target_path_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_TARGET_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(target_path=""))

    async def test_a_whitespace_only_target_path_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_TARGET_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(target_path="\t "))

    async def test_the_source_path_is_checked_before_the_target_path(self) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SOURCE_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(source_path="", target_path=""))

    async def test_zero_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sCopyPlugin().validate(_valid_params(timeout=0))

    async def test_negative_timeout_is_rejected(self) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sCopyPlugin().validate(_valid_params(timeout=-5))

    async def test_positive_timeout_passes(self) -> None:
        await K8sCopyPlugin().validate(_valid_params(timeout=45))


class TestLimitValidation:
    """validate() checks the two limit rows only while Direction is From Pod."""

    @pytest.mark.parametrize("value", [0, 1, 256, 1_000_000, None, ""])
    async def test_a_whole_max_size_of_zero_or_more_or_a_blank_passes(self, value: Any) -> None:
        await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_size_mib=value))

    @pytest.mark.parametrize("value", [0, 1, 10_000, 1_000_000, None, ""])
    async def test_a_whole_max_files_of_zero_or_more_or_a_blank_passes(self, value: Any) -> None:
        await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_files=value))

    @pytest.mark.parametrize("value", ["many", "5", 1.5, True, [1]])
    async def test_a_max_size_that_is_not_a_whole_number_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact(MAX_SIZE_NOT_INTEGER)):
            await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_size_mib=value))

    @pytest.mark.parametrize("value", [-1, -256])
    async def test_a_max_size_below_zero_is_refused(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact(MAX_SIZE_BELOW_ZERO)):
            await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_size_mib=value))

    @pytest.mark.parametrize("value", ["many", "5", 2.5, False, {"n": 1}])
    async def test_a_max_files_that_is_not_a_whole_number_is_refused(self, value: Any) -> None:
        with pytest.raises(ValueError, match=exact(MAX_FILES_NOT_INTEGER)):
            await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_files=value))

    @pytest.mark.parametrize("value", [-1, -10_000])
    async def test_a_max_files_below_zero_is_refused(self, value: int) -> None:
        with pytest.raises(ValueError, match=exact(MAX_FILES_BELOW_ZERO)):
            await K8sCopyPlugin().validate(_valid_params(direction="from_pod", max_files=value))

    async def test_an_absent_direction_counts_as_from_pod(self) -> None:
        params = _valid_params(max_files=-1)

        assert "direction" not in params
        with pytest.raises(ValueError, match=exact(MAX_FILES_BELOW_ZERO)):
            await K8sCopyPlugin().validate(params)

    async def test_to_pod_ignores_the_limit_rows(self) -> None:
        await K8sCopyPlugin().validate(
            _valid_params(direction="to_pod", max_size_mib="many", max_files=-1)
        )

    async def test_both_whole_number_checks_come_before_either_bound(self) -> None:
        params = _valid_params(direction="from_pod", max_size_mib=-1, max_files="many")

        with pytest.raises(ValueError, match=exact(MAX_FILES_NOT_INTEGER)):
            await K8sCopyPlugin().validate(params)

    async def test_max_size_is_checked_before_max_files(self) -> None:
        params = _valid_params(direction="from_pod", max_size_mib="many", max_files="many")

        with pytest.raises(ValueError, match=exact(MAX_SIZE_NOT_INTEGER)):
            await K8sCopyPlugin().validate(params)

    async def test_the_max_size_bound_is_checked_before_the_max_files_bound(self) -> None:
        params = _valid_params(direction="from_pod", max_size_mib=-1, max_files=-1)

        with pytest.raises(ValueError, match=exact(MAX_SIZE_BELOW_ZERO)):
            await K8sCopyPlugin().validate(params)

    async def test_the_timeout_is_checked_before_the_limits(self) -> None:
        params = _valid_params(direction="from_pod", timeout=0, max_files=-1)

        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sCopyPlugin().validate(params)

    @_BOTH_MODES
    async def test_a_bad_limit_fails_the_block_whatever_on_error_says(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(MAX_SIZE_BELOW_ZERO)):
            await K8sCopyPlugin().validate(_valid_params(max_size_mib=-1, on_error=mode))


class TestPullLeg:
    """From Pod: one streamed `tar cf -` exec, each file written on the WAVE side as it arrives."""

    async def test_a_single_file_pull_runs_exactly_one_exec(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = str(tmp_path / "out.txt")

        await _execute(stream, _pull_params(target))

        assert len(stream.calls) == 1

    async def test_the_pull_argv_is_kubectls_own(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = str(tmp_path / "out.txt")

        await _execute(stream, _pull_params(target))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    async def test_the_pull_never_reaches_the_accumulating_channel(self, tmp_path: Any) -> None:
        """The streamed exec takes no standard input; the accumulating one is push-only."""
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        params = _pull_params(str(tmp_path / "out.txt"))

        with patch_pull(stream) as channel:
            await K8sCopyPlugin().execute(execute_context(params))

        assert channel.calls == []
        assert len(stream.calls) == 1

    async def test_a_single_file_lands_at_the_target_path(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = tmp_path / "out.txt"

        await _execute(stream, _pull_params(str(target)))

        assert target.read_bytes() == b"hello\n"

    async def test_a_pulled_directory_lands_as_its_files_under_the_target(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(
            _tar(
                [
                    ("srv/work/data", None),
                    ("srv/work/data/a.txt", b"A"),
                    ("srv/work/data/sub", None),
                    ("srv/work/data/sub/b.txt", b"BB"),
                ]
            )
        )
        target = tmp_path / "out"

        await _execute(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "a.txt").read_bytes() == b"A"
        assert (target / "sub" / "b.txt").read_bytes() == b"BB"

    async def test_a_directory_pull_still_runs_one_exec(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data", None), ("srv/work/data/a.txt", b"A")]))

        await _execute(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR))

        assert len(stream.calls) == 1
        assert stream.last.command == ["tar", "cf", "-", POD_DIR]

    async def test_the_pull_creates_missing_parent_directories(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = tmp_path / "deep" / "nested" / "out.txt"

        await _execute(stream, _pull_params(str(target)))

        assert target.read_bytes() == b"hello\n"

    async def test_no_preserve_does_not_change_the_pull_argv(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt"), no_preserve=True))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    async def test_the_container_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.container == CONTAINER

    async def test_the_session_namespace_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.namespace == NAMESPACE

    async def test_an_explicit_namespace_overrides_the_session(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt"), namespace="ops"))

        assert stream.last.namespace == "ops"

    async def test_the_pod_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.pod == POD

    async def test_the_unset_timeout_reaches_the_seam_as_sixty(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        assert "timeout" not in params
        await _execute(stream, params)

        assert stream.last.timeout == TIMEOUT_DEFAULT

    async def test_a_set_timeout_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt"), timeout=45))

        assert stream.last.timeout == 45

    async def test_impersonation_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))
        params = _pull_params(
            str(tmp_path / "out.txt"), impersonate_user="qa-bot", impersonate_groups="dev, ops"
        )

        await _execute(stream, params)

        assert stream.last.impersonate_user == "qa-bot"
        assert stream.last.impersonate_groups == ["dev", "ops"]

    async def test_no_impersonation_reaches_the_seam_as_none(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.impersonate_user is None
        assert stream.last.impersonate_groups is None

    async def test_from_pod_is_the_direction_when_none_is_set(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        del params["direction"]
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        await _execute(stream, params)

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]


class TestArchiveRecovery:
    """The tar arrives as bytes on the stream and every file lands byte for byte."""

    async def test_bytes_that_are_not_valid_utf8_survive_the_pull(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", RAW_BYTES)]))
        target = tmp_path / "out.bin"

        await _execute(stream, _pull_params(str(target)))

        assert target.read_bytes() == RAW_BYTES

    async def test_every_byte_value_survives_the_pull(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", EVERY_BYTE)]))
        target = tmp_path / "out.bin"

        await _execute(stream, _pull_params(str(target)))

        assert target.read_bytes() == EVERY_BYTE

    async def test_a_binary_file_reports_its_true_size(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", RAW_BYTES)]))
        target = tmp_path / "out.bin"

        result = await _execute(stream, _pull_params(str(target)))

        assert _rows(result) == [[POD_FILE, str(target), len(RAW_BYTES)]]

    async def test_every_file_of_a_binary_directory_pull_lands_intact(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar(
                [
                    ("srv/work/data", None),
                    ("srv/work/data/a.bin", RAW_BYTES),
                    ("srv/work/data/sub", None),
                    ("srv/work/data/sub/b.bin", EVERY_BYTE),
                ]
            )
        )
        target = tmp_path / "out"

        await _execute(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "a.bin").read_bytes() == RAW_BYTES
        assert (target / "sub" / "b.bin").read_bytes() == EVERY_BYTE


class TestArchiveGuard:
    """The push keeps a fixed output ceiling; the pull stops at Max size (MiB) or Max files."""

    def test_the_push_output_ceiling_is_the_pinned_number(self) -> None:
        assert cp._PUSH_OUTPUT_CEILING == PUSH_OUTPUT_CEILING

    async def test_every_push_exec_carries_the_ceiling(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert [call.max_output_bytes for call in channel.calls] == [PUSH_OUTPUT_CEILING] * 3

    async def test_the_ceiling_reaches_the_push_seam_as_a_keyword_argument(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert channel.factory.call_args.kwargs["max_output_bytes"] == PUSH_OUTPUT_CEILING

    async def test_a_push_over_the_ceiling_reads_as_a_copy_in(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = FakeExecChannel([ExecOutputTooLarge(CEILING_MESSAGE)])

        with pytest.raises(ValueError, match=exact(_push_message(CEILING_MESSAGE))):
            await _execute(channel, _push_params(str(source)))

    async def test_a_push_over_the_ceiling_records_the_output_too_large_reason(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = FakeExecChannel([ExecOutputTooLarge(CEILING_MESSAGE)])

        result = await _execute(channel, _push_params(str(source), on_error="record"))

        assert result["error"] == _push_message(CEILING_MESSAGE)
        assert result["reason"] == OUTPUT_TOO_LARGE_REASON

    async def test_the_limit_rows_do_not_bound_the_push(self, tmp_path: Any) -> None:
        tree = tmp_path / "data"
        (tree / "sub").mkdir(parents=True)
        (tree / "a.txt").write_bytes(b"A")
        (tree / "sub" / "b.txt").write_bytes(b"BB")
        params = _push_params(str(tree), target_path=POD_DEST_TREE, max_size_mib=1, max_files=1)

        result = await _execute(_push_channel(), params)

        assert len(_rows(result)) == 2

    async def test_a_pull_exactly_at_max_files_lands_every_file(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data/a.txt", b"A"), ("srv/work/data/b.txt", b"B")]))
        target = tmp_path / "out"

        await _execute(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert (target / "a.txt").read_bytes() == b"A"
        assert (target / "b.txt").read_bytes() == b"B"

    async def test_one_file_more_than_max_files_fails_the_block(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_files=2)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(2)))):
            await _execute(_pull_stream(_tar(THREE_FILES)), params)

    async def test_a_max_files_refusal_records_its_reason(self, tmp_path: Any) -> None:
        params = _pull_params(
            str(tmp_path / "out"), source_path=POD_DIR, max_files=2, on_error="record"
        )

        result = await _execute(_pull_stream(_tar(THREE_FILES)), params)

        assert result["success"] is False
        assert result["error"] == _pull_message(_over_files_detail(2))
        assert result["reason"] == TOO_MANY_REASON
        assert result["summary"].row_count() == 0

    async def test_nothing_the_pull_wrote_remains_when_max_files_refuses(
        self, tmp_path: Any
    ) -> None:
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_files=2)

        with pytest.raises(ValueError):
            await _execute(_pull_stream(_tar(THREE_FILES)), params)

        assert list(tmp_path.iterdir()) == []

    async def test_directory_members_do_not_count_toward_max_files(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar(
                [
                    ("srv/work/data", None),
                    ("srv/work/data/a.txt", b"A"),
                    ("srv/work/data/sub", None),
                    ("srv/work/data/sub/b.txt", b"B"),
                ]
            )
        )
        target = tmp_path / "out"

        await _execute(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert (target / "sub" / "b.txt").read_bytes() == b"B"

    async def test_a_pull_exactly_at_max_size_lands_every_file(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB)])
        )
        target = tmp_path / "out"

        await _execute(stream, _pull_params(str(target), source_path=POD_DIR, max_size_mib=1))

        assert (target / "a.bin").read_bytes() == HALF_MIB
        assert (target / "b.bin").read_bytes() == HALF_MIB

    async def test_a_file_that_would_pass_max_size_fails_the_block(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB + b"!")])
        )
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_size_mib=1)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(1)))):
            await _execute(stream, params)

        assert list(tmp_path.iterdir()) == []

    async def test_a_max_size_refusal_records_its_reason(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), max_size_mib=1, on_error="record")

        result = await _execute(_pull_stream(_header_only(MIB + 1)), params)

        assert result["success"] is False
        assert result["error"] == _pull_message(_over_size_detail(1))
        assert result["reason"] == TOO_LARGE_REASON
        assert result["summary"].row_count() == 0

    async def test_zero_lifts_both_limits(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        params = _pull_params(str(target), source_path=POD_DIR, max_size_mib=0, max_files=0)

        result = await _execute(_pull_stream(_tar(THREE_FILES)), params)

        assert len(_rows(result)) == 3
        assert (target / "sub" / "c.txt").read_bytes() == b"CCC"

    async def test_the_shipped_max_size_refuses_a_file_over_256_mib(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        stream = _pull_stream(_header_only(MAX_SIZE_MIB_DEFAULT * MIB + 1))

        assert "max_size_mib" not in params
        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(256)))):
            await _execute(stream, params)

    async def test_the_shipped_max_files_refuses_the_first_file_over_it(
        self, tmp_path: Any
    ) -> None:
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR)
        stream = _pull_stream(_empty_files(MAX_FILES_DEFAULT + 1), chunk_size=65_536)

        assert "max_files" not in params
        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(10_000)))):
            await _execute(stream, params)

        assert list(tmp_path.iterdir()) == []

    async def test_an_artifact_pull_stopped_by_a_limit_leaves_the_artifacts_as_they_were(
        self, tmp_path: Any
    ) -> None:
        (tmp_path / "earlier.txt").write_bytes(b"earlier")
        params = _pull_params("artifact://reports/out", source_path=POD_DIR, max_files=2)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(2)))):
            await _execute(_pull_stream(_tar(THREE_FILES)), params, artifacts_dir=str(tmp_path))

        assert sorted(entry.name for entry in tmp_path.iterdir()) == ["earlier.txt"]


class TestPushLeg:
    """To Pod: one exec per base64 chunk, then one decode-untar-cleanup exec. Never stdin."""

    async def test_a_small_push_is_the_staging_exec_one_chunk_and_the_final_exec(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert len(channel.calls) == 3

    async def test_every_chunk_exec_appends_one_argv_element_to_the_scratch_file(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        chunk_call = _chunk_calls(channel)[0]
        assert chunk_call.command[:4] == ["sh", "-c", APPEND_SCRIPT, "sh"]
        assert len(chunk_call.command) == 6

    async def test_the_push_starts_by_creating_a_staging_directory(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert channel.calls[0].command == ["mkdir", _stage(channel)]

    async def test_the_staging_directory_is_created_without_the_parents_flag(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert "-p" not in channel.calls[0].command
        assert len(channel.calls[0].command) == 2

    async def test_the_staging_directory_sits_in_the_directory_the_copy_targets(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        stage = _stage(channel)
        assert posixpath.dirname(stage) == POD_DEST_DIR
        assert re.match(STAGE_NAME_PATTERN, posixpath.basename(stage))

    async def test_a_push_to_another_folder_stages_in_that_folder(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source), target_path=POD_APP_FILE))

        stage = _stage(channel)
        assert posixpath.dirname(stage) == POD_APP_DIR

    async def test_a_pushed_directory_stages_beside_the_directory_it_lands_in(
        self, tmp_path: Any
    ) -> None:
        tree = tmp_path / "data"
        tree.mkdir()
        (tree / "a.txt").write_bytes(b"A")
        channel = _push_channel()

        await _execute(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert posixpath.dirname(_stage(channel)) == POD_DEST_DIR

    async def test_two_pushes_stage_in_different_directories(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        first, second = _push_channel(), _push_channel()

        await _execute(first, _push_params(str(source)))
        await _execute(second, _push_params(str(source)))

        assert _stage(first) != _stage(second)

    async def test_the_scratch_file_sits_inside_the_staging_directory(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert _scratch(channel) == f"{_stage(channel)}/{SCRATCH_NAME}"

    async def test_every_exec_names_the_same_scratch_file(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        chunk_calls = _chunk_calls(channel)
        scratch = _scratch(channel)
        assert [call.command[5] for call in chunk_calls] == [scratch] * len(chunk_calls)
        assert _final(channel).command[4] == scratch

    async def test_a_large_push_needs_more_than_one_chunk(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert len(_chunks(channel)) > 1

    async def test_every_chunk_but_the_last_is_exactly_the_chunk_size(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        chunks = _chunks(channel)
        assert [len(chunk) for chunk in chunks[:-1]] == [CHUNK_SIZE] * (len(chunks) - 1)
        assert 0 < len(chunks[-1]) <= CHUNK_SIZE

    async def test_every_chunk_sits_well_below_the_single_argument_cap(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        for chunk in _chunks(channel):
            assert len(chunk.encode()) < MAX_ARG_STRLEN // 2

    async def test_no_single_argv_element_reaches_the_cap(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        for call in channel.calls:
            for argument in call.command:
                assert len(argument.encode()) < MAX_ARG_STRLEN - 1

    async def test_the_chunks_reassemble_into_the_tar_of_the_source(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
            member = archive.getmember("dst.txt")
            extracted = archive.extractfile(member)
            assert extracted is not None
            assert extracted.read() == b"hello\n"

    async def test_the_tar_member_is_named_for_the_target_basename(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert _pushed_names(channel) == ["dst.txt"]

    async def test_a_pushed_directory_keeps_its_tree_under_the_target_name(
        self, tmp_path: Any
    ) -> None:
        tree = tmp_path / "data"
        (tree / "sub").mkdir(parents=True)
        (tree / "a.txt").write_bytes(b"A")
        (tree / "sub" / "b.txt").write_bytes(b"BB")
        channel = _push_channel()

        await _execute(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert sorted(_pushed_names(channel)) == ["data/a.txt", "data/sub/b.txt"]

    async def test_the_final_exec_decodes_untars_and_cleans_up(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        final = _final(channel)
        assert final.command[:2] == ["sh", "-c"]
        assert final.command[2] == EXTRACT_SCRIPT
        assert final.command[3] == "sh"
        assert final.command[5] == POD_DEST_DIR

    async def test_the_final_exec_is_handed_the_staging_directory_to_remove(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert _final(channel).command[6] == _stage(channel)
        assert len(_final(channel).command) == 7

    async def test_the_final_exec_extracts_into_the_target_directory(self, tmp_path: Any) -> None:
        tree = tmp_path / "data"
        tree.mkdir()
        (tree / "a.txt").write_bytes(b"A")
        channel = _push_channel()

        await _execute(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert _final(channel).command[5] == POD_DEST_DIR

    async def test_no_preserve_adds_kubectls_two_extract_flags(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source), no_preserve=True))

        assert _final(channel).command[2] == EXTRACT_SCRIPT_NO_PRESERVE

    async def test_no_preserve_unticked_leaves_the_plain_extract(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source), no_preserve=False))

        assert _final(channel).command[2] == EXTRACT_SCRIPT

    async def test_the_push_never_opens_stdin(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert len(channel.calls) > 2
        assert [call.stdin for call in channel.calls] == [None] * len(channel.calls)

    async def test_every_push_exec_carries_the_same_pod_container_and_timeout(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()

        await _execute(channel, _push_params(str(source), timeout=45))

        for call in channel.calls:
            assert (call.pod, call.container, call.timeout) == (POD, CONTAINER, 45)

    async def test_impersonation_reaches_every_push_exec(self, tmp_path: Any) -> None:
        source = tmp_path / "big.bin"
        source.write_bytes(b"Z" * 90_000)
        channel = _push_channel()
        params = _push_params(str(source), impersonate_user="qa-bot", impersonate_groups="dev, ops")

        await _execute(channel, params)

        for call in channel.calls:
            assert call.impersonate_user == "qa-bot"
            assert call.impersonate_groups == ["dev", "ops"]

    async def test_the_push_runs_no_preflight_probe(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)))

        assert [call.command[0] for call in channel.calls] == ["mkdir", "sh", "sh"]


class TestStagingCleanup:
    """The extract script under a real shell: the staging directory goes, tar's code stays."""

    @pytest.mark.parametrize("script", EXTRACT_SCRIPTS)
    def test_a_good_archive_lands_and_the_staging_directory_is_gone(
        self, script: str, tmp_path: Any
    ) -> None:
        code, into, stage = _run_extract(script, tmp_path, _tar([("dst.txt", b"hello\n")]))

        assert code == 0
        assert (into / "dst.txt").read_bytes() == b"hello\n"
        assert not stage.exists()

    @pytest.mark.parametrize("script", EXTRACT_SCRIPTS)
    def test_a_failed_extraction_still_removes_the_staging_directory(
        self, script: str, tmp_path: Any
    ) -> None:
        code, _into, stage = _run_extract(script, tmp_path, b"not a tar archive at all")

        assert code != 0
        assert not stage.exists()

    @pytest.mark.parametrize("script", EXTRACT_SCRIPTS)
    def test_the_cleanup_does_not_overwrite_the_exit_code_tar_returned(
        self, script: str, tmp_path: Any
    ) -> None:
        failed, _into, _stage = _run_extract(script, tmp_path, b"not a tar archive at all")
        passed, _good_into, _good_stage = _run_extract(
            script, tmp_path / "second", _tar([("dst.txt", b"hi")])
        )

        assert failed != 0
        assert passed == 0


class TestPathResolution:
    """The WAVE side resolves through the shared plugin path resolver."""

    async def test_an_artifact_pull_target_lands_in_the_run_artifact_directory(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        await _execute(stream, _pull_params("artifact://out.txt"), artifacts_dir=str(tmp_path))

        assert (tmp_path / "out.txt").read_bytes() == b"hello\n"

    async def test_a_nested_artifact_pull_target_creates_its_directories(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        await _execute(
            stream, _pull_params("artifact://reports/out.txt"), artifacts_dir=str(tmp_path)
        )

        assert (tmp_path / "reports" / "out.txt").read_bytes() == b"hello\n"

    async def test_an_absolute_pull_target_is_used_as_given(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = tmp_path / "elsewhere" / "out.txt"

        await _execute(stream, _pull_params(str(target)), artifacts_dir=str(tmp_path / "runs"))

        assert target.read_bytes() == b"hello\n"

    async def test_an_artifact_push_source_is_read_from_the_artifact_directory(
        self, tmp_path: Any
    ) -> None:
        (tmp_path / "in.txt").write_bytes(b"payload\n")
        channel = _push_channel()

        await _execute(channel, _push_params("artifact://in.txt"), artifacts_dir=str(tmp_path))

        with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
            extracted = archive.extractfile("dst.txt")
            assert extracted is not None
            assert extracted.read() == b"payload\n"

    async def test_an_absolute_push_source_is_used_as_given(self, tmp_path: Any) -> None:
        source = tmp_path / "outside" / "in.txt"
        source.parent.mkdir()
        source.write_bytes(b"payload\n")
        channel = _push_channel()

        await _execute(channel, _push_params(str(source)), artifacts_dir=str(tmp_path / "runs"))

        assert _pushed_names(channel) == ["dst.txt"]

    async def test_a_relative_pull_target_lands_under_the_server_users_home(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch, server_home: Any
    ) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        monkeypatch.chdir(tmp_path)

        await _execute(stream, _pull_params("pulled/out.txt"), artifacts_dir=str(tmp_path / "runs"))

        assert (server_home / "pulled" / "out.txt").read_bytes() == b"hello\n"
        assert not (tmp_path / "pulled").exists()

    async def test_a_relative_push_source_is_read_from_the_server_users_home(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch, server_home: Any
    ) -> None:
        (server_home / "in.txt").write_bytes(b"from-home\n")
        (tmp_path / "in.txt").write_bytes(b"decoy\n")
        monkeypatch.chdir(tmp_path)
        channel = _push_channel()

        await _execute(channel, _push_params("in.txt"), artifacts_dir=str(tmp_path / "runs"))

        with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
            extracted = archive.extractfile("dst.txt")
            assert extracted is not None
            assert extracted.read() == b"from-home\n"


class TestTestDataIsReadOnly:
    """A pull target that lands in the test's own files is refused before any exec."""

    async def test_an_absolute_pull_target_inside_test_data_is_refused(self, tmp_path: Any) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        params = _pull_params(str(testdata / "out.txt"))

        with patch_pull(stream):
            with pytest.raises(ValueError, match=exact(_READ_ONLY_MESSAGE)):
                await K8sCopyPlugin().execute(
                    execute_context(params, testdata_dirs=[str(testdata)])
                )

        assert stream.calls == []

    async def test_a_testdata_pull_target_is_refused(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        params = _pull_params("testdata://out.txt")

        with patch_pull(stream):
            with pytest.raises(ValueError, match=exact(_READ_ONLY_MESSAGE)):
                await K8sCopyPlugin().execute(
                    execute_context(params, testdata_dirs=[str(tmp_path)])
                )

        assert stream.calls == []

    async def test_a_push_source_inside_test_data_is_still_read(self, tmp_path: Any) -> None:
        """The read leg is untouched: a fixture is exactly what Copy pushes into a pod."""
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "in.txt").write_bytes(b"payload\n")
        channel = _push_channel()
        params = _push_params(str(testdata / "in.txt"))

        with patch_exec(channel):
            await K8sCopyPlugin().execute(execute_context(params, testdata_dirs=[str(testdata)]))

        assert _pushed_names(channel) == ["dst.txt"]


class TestSummaryTable:
    """Summary is a three-column table, one row per file, direction-neutral."""

    async def test_summary_is_a_wave_table(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert isinstance(result["summary"], Table)

    async def test_the_columns_are_the_three_pinned_names(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert result["summary"].col_names() == SUMMARY_COLUMNS

    async def test_the_size_column_is_typed_integer(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert result["summary"].col_types() == SUMMARY_COLUMN_TYPES

    async def test_a_single_file_pull_is_one_row(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        target = tmp_path / "out.txt"

        result = await _execute(stream, _pull_params(str(target)))

        assert _rows(result) == [[POD_FILE, str(target), 6]]

    async def test_a_pulled_directory_is_one_row_per_file(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar(
                [
                    ("srv/work/data", None),
                    ("srv/work/data/a.txt", b"A"),
                    ("srv/work/data/sub", None),
                    ("srv/work/data/sub/b.txt", b"BB"),
                ]
            )
        )
        target = tmp_path / "out"

        result = await _execute(stream, _pull_params(str(target), source_path=POD_DIR))

        assert _rows(result) == [
            [f"{POD_DIR}/a.txt", str(target / "a.txt"), 1],
            [f"{POD_DIR}/sub/b.txt", str(target / "sub" / "b.txt"), 2],
        ]

    async def test_directory_entries_are_not_rows(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data", None), ("srv/work/data/a.txt", b"A")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR))

        assert result["summary"].row_count() == 1

    async def test_a_single_file_push_is_one_row(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        channel = _push_channel()

        result = await _execute(channel, _push_params(str(source)))

        assert _rows(result) == [[str(source), POD_DEST_FILE, 6]]

    async def test_a_pushed_directory_is_one_row_per_file(self, tmp_path: Any) -> None:
        tree = tmp_path / "data"
        (tree / "sub").mkdir(parents=True)
        (tree / "a.txt").write_bytes(b"A")
        (tree / "sub" / "b.txt").write_bytes(b"BB")
        channel = _push_channel()

        result = await _execute(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert _rows(result) == [
            [str(tree / "a.txt"), f"{POD_DEST_TREE}/a.txt", 1],
            [str(tree / "sub" / "b.txt"), f"{POD_DEST_TREE}/sub/b.txt", 2],
        ]

    async def test_the_columns_read_the_same_in_both_directions(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")

        pushed = await _execute(_push_channel(), _push_params(str(source)))
        pulled = await _execute(
            _pull_stream(_tar([("srv/work/src.txt", b"hi")])),
            _pull_params(str(tmp_path / "out.txt")),
        )

        assert pushed["summary"].col_names() == pulled["summary"].col_names()


class TestOutputCore:
    """The output core and the empties a recorded failure leaves behind."""

    async def test_a_happy_pull_returns_exactly_the_declared_outputs(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert set(result) == {"summary", "success", "error", "reason"}

    async def test_a_happy_pull_carries_the_full_core(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    async def test_a_happy_push_carries_the_full_core(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")

        result = await _execute(_push_channel(), _push_params(str(source)))

        assert result["success"] is True
        assert set(result) == {"summary", "success", "error", "reason"}

    async def test_record_mode_leaves_summary_as_an_empty_table(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected('pods "web-1" not found', "NotFound"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert isinstance(result["summary"], Table)
        assert result["summary"].row_count() == 0

    async def test_the_empty_table_still_carries_the_three_columns(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected('pods "web-1" not found', "NotFound"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert result["summary"].col_names() == SUMMARY_COLUMNS

    async def test_record_mode_returns_no_counts_of_its_own(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected('pods "web-1" not found', "NotFound"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert set(result) == {"summary", "success", "error", "reason", "__block_warning"}


class TestErrorReasonGate:
    """Asserted the same way on every K8s block."""

    def test_error_and_reason_declare_the_record_gate(self) -> None:
        outputs = _outputs_by_name(K8sCopyPlugin())

        assert outputs["error"]["show_when"] == RECORD_GATE
        assert outputs["reason"]["show_when"] == RECORD_GATE

    def test_success_is_never_gated(self) -> None:
        assert "show_when" not in _outputs_by_name(K8sCopyPlugin())["success"]

    def test_summary_is_never_gated_on_direction(self) -> None:
        assert "show_when" not in _outputs_by_name(K8sCopyPlugin())["summary"]

    def test_only_error_and_reason_are_gated(self) -> None:
        outputs = _outputs_by_name(K8sCopyPlugin())
        gated = [name for name in EXPECTED_OUTPUT_ORDER if "show_when" in outputs[name]]

        assert gated == ["error", "reason"]

    async def test_fail_mode_raises_out_of_the_block(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected('pods "web-1" not found', "NotFound"))

        with pytest.raises(ValueError, match=exact(_pull_message('pods "web-1" not found'))):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

    async def test_fail_is_the_default_on_error_mode(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))
        params = _pull_params(str(tmp_path / "out.txt"))

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact(_pull_message("denied"))):
            await _execute(stream, params)

    async def test_record_mode_returns_normally_with_all_three_filled(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected('pods "web-1" not found', "NotFound"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert result["success"] is False
        assert result["error"] == _pull_message('pods "web-1" not found')
        assert result["reason"] == "NotFound"


class TestFailureHandling:
    """Cluster refusals read as a copy, and a recorded one asks for amber."""

    async def test_a_missing_pod_on_the_pull_reads_as_a_copy_out(self, tmp_path: Any) -> None:
        detail = 'pods "web-1" not found'
        stream = FakeExecStdout(open_error=ExecRejected(detail, "NotFound"))

        with pytest.raises(ValueError, match=exact(_pull_message(detail))):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

    async def test_a_missing_pod_on_the_push_reads_as_a_copy_in(self, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        detail = 'pods "web-1" not found'
        channel = FakeExecChannel([ExecRejected(detail, "NotFound")])

        with pytest.raises(ValueError, match=exact(_push_message(detail))):
            await _execute(channel, _push_params(str(source)))

    async def test_a_failure_on_the_final_push_exec_still_reads_as_a_copy_in(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        detail = "container not found"
        channel = FakeExecChannel([("", "", 0), ("", "", 0), ExecRejected(detail, "BadRequest")])

        with pytest.raises(ValueError, match=exact(_push_message(detail))):
            await _execute(channel, _push_params(str(source)))

    async def test_the_pull_message_names_the_container_the_row_selected(
        self, tmp_path: Any
    ) -> None:
        detail = 'pods "web-1" not found'
        stream = FakeExecStdout(open_error=ExecRejected(detail, "NotFound"))

        with pytest.raises(ValueError, match=exact(_pull_message(detail, container="sidecar"))):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), container="sidecar"))

    async def test_the_push_message_names_the_container_the_row_selected(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        detail = "denied"
        channel = FakeExecChannel([ExecRejected(detail, "Forbidden")])

        with pytest.raises(ValueError, match=exact(_push_message(detail, container="sidecar"))):
            await _execute(channel, _push_params(str(source), container="sidecar"))

    async def test_a_recorded_refusal_logs_the_copy_shaped_warn_line(self, tmp_path: Any) -> None:
        detail = 'pods "web-1" not found'
        stream = FakeExecStdout(open_error=ExecRejected(detail, "NotFound"))
        logger = MagicMock()

        await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"), logger)

        logger.warn.assert_called_once_with(f"Copy failed (NotFound): {_pull_message(detail)}")

    async def test_a_recorded_failure_carries_the_warning_signal(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert result["__block_warning"] is True

    async def test_a_denied_exec_records_the_cluster_reason(self, tmp_path: Any) -> None:
        detail = 'User "wave" cannot create resource "pods/exec"'
        stream = FakeExecStdout(open_error=ExecRejected(detail, "Forbidden"))

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert result["error"] == _pull_message(detail)
        assert result["reason"] == "Forbidden"

    async def test_a_non_zero_tar_exit_on_the_pull_is_a_copy_failure(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/src.txt: No such file or directory"
        stream = _pull_stream(b"", stderr=stderr, exit_code=1)

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt")))

    async def test_a_non_zero_tar_exit_records_the_non_zero_exit_reason(
        self, tmp_path: Any
    ) -> None:
        stderr = "tar: /srv/work/src.txt: No such file or directory"
        stream = _pull_stream(b"", stderr=stderr, exit_code=1)

        result = await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert result["error"] == _pull_message(stderr)
        assert result["reason"] == "NonZeroExitCode"

    async def test_a_non_zero_exit_on_the_final_push_exec_is_a_copy_failure(
        self, tmp_path: Any
    ) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        stderr = "tar: can't create directory: Permission denied"
        channel = FakeExecChannel([("", "", 0), ("", "", 0), ("", stderr, 2)])

        with pytest.raises(ValueError, match=exact(_push_message(stderr))):
            await _execute(channel, _push_params(str(source)))

    async def test_a_happy_copy_logs_info_and_asks_for_nothing(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/src.txt", b"hello\n")]))
        logger = MagicMock()

        result = await _execute(
            stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"), logger
        )

        assert "__block_warning" not in result
        assert logger.warn.call_count == 0
        assert logger.info.call_count == 1

    async def test_fail_mode_logs_no_warn_line(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt")), logger)

        assert logger.warn.call_count == 0


class TestAlwaysHardFail:
    """Dependency errors raise in both on_error modes."""

    @_BOTH_MODES
    async def test_a_bogus_session_raises(self, mode: str, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), on_error=mode)
        params["session"] = "not-a-kubeconfig"
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(stream, params)

    @_BOTH_MODES
    async def test_a_missing_session_raises(self, mode: str, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), on_error=mode)
        del params["session"]
        stream = _pull_stream(_tar([("srv/work/src.txt", b"x")]))

        with pytest.raises(ValueError, match=exact(_SESSION_MESSAGE)):
            await _execute(stream, params)

    @_BOTH_MODES
    async def test_a_transport_failure_on_the_pull_raises(self, mode: str, tmp_path: Any) -> None:
        detail = "[Errno 111] Connection refused"
        stream = FakeExecStdout(open_error=ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_pull_message(detail))):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error=mode))

    @_BOTH_MODES
    async def test_a_transport_failure_on_the_push_raises(self, mode: str, tmp_path: Any) -> None:
        source = tmp_path / "a.txt"
        source.write_bytes(b"hello\n")
        detail = "TLS handshake failed: self-signed certificate"
        channel = FakeExecChannel([ExecTransportError(detail)])

        with pytest.raises(ValueError, match=exact(_push_message(detail))):
            await _execute(channel, _push_params(str(source), on_error=mode))

    @_BOTH_MODES
    async def test_a_transport_failure_records_nothing(self, mode: str, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecTransportError("socket closed"))
        logger = MagicMock()

        with pytest.raises(ValueError):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error=mode), logger)

        assert logger.warn.call_count == 0

    @_BOTH_MODES
    async def test_a_timeout_raises_its_own_message(self, mode: str, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))

        with pytest.raises(ValueError, match=r"^File copy timed out after \d+ seconds$"):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error=mode))

    @_BOTH_MODES
    async def test_the_timeout_message_names_the_configured_timeout(
        self, mode: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))
        params = _pull_params(str(tmp_path / "out.txt"), on_error=mode, timeout=45)

        with pytest.raises(ValueError, match=r"^File copy timed out after 45 seconds$"):
            await _execute(stream, params)

    @_BOTH_MODES
    async def test_the_timeout_message_names_the_default_when_none_is_set(
        self, mode: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))

        with pytest.raises(ValueError, match=r"^File copy timed out after 60 seconds$"):
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error=mode))

    @_BOTH_MODES
    async def test_a_timeout_is_never_nested_in_the_transport_message(
        self, mode: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))

        with pytest.raises(ValueError) as caught:
            await _execute(stream, _pull_params(str(tmp_path / "out.txt"), on_error=mode))

        assert "Could not copy" not in str(caught.value)

    @_BOTH_MODES
    async def test_an_invalid_direction_raises(self, mode: str) -> None:
        message = (
            "Parameter 'direction' must be one of: from_pod, to_pod; Actual value was 'sideways'."
        )

        with pytest.raises(ValueError, match=exact(message)):
            await K8sCopyPlugin().validate(_valid_params(direction="sideways", on_error=mode))

    @_BOTH_MODES
    async def test_an_empty_source_path_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_SOURCE_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(source_path="", on_error=mode))

    @_BOTH_MODES
    async def test_an_empty_target_path_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=exact(EMPTY_TARGET_MESSAGE)):
            await K8sCopyPlugin().validate(_valid_params(target_path="", on_error=mode))

    @_BOTH_MODES
    async def test_a_non_positive_timeout_raises(self, mode: str) -> None:
        with pytest.raises(ValueError, match=r"^Parameter 'timeout' must be positive$"):
            await K8sCopyPlugin().validate(_valid_params(timeout=0, on_error=mode))
