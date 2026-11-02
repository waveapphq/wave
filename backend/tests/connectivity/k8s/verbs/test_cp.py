"""K8s Copy verb tests (REQ-5.1.1, REQ-3.4.1.5).

cp.run is the sync core behind the K8s Copy block: it moves a file or a directory
between a pod and the WAVE side over the exec channel, the way kubectl cp does.
Pulling runs `tar cf -` in the pod, reads its standard output as a stream and
writes each vetted file out under the target as it arrives, stopping and taking
back what it wrote the moment Max size (MiB) or Max files is crossed (K8SEXEC-10);
pushing tars the WAVE side, base64-encodes it, appends it one argv element at a
time to a scratch file in a staging directory beside the target, then runs one
exec that decodes, untars and removes that directory. Standard input is never
opened in either direction, and both paths reach the verb absolute: scheme
resolution happens before run is called.
"""

import base64
import inspect
import io
import json
import os
import posixpath
import re
import stat
import tarfile
from contextlib import ExitStack
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.plugins.k8s._k8s_fixtures import (
    NAMESPACE,
    SERVER,
    ExecCall,
    FakeExecChannel,
    FakeExecStdout,
    RecordingLog,
    block_params,
    exact,
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

POD = "web-1"
CONTAINER = "app"
POD_FILE = "/srv/work/src.txt"
POD_DIR = "/srv/work/data"
POD_DEST_DIR = "/srv/work/dest"
POD_DEST_FILE = f"{POD_DEST_DIR}/dst.txt"
POD_DEST_TREE = f"{POD_DEST_DIR}/data"
POD_APP_DIR = "/srv/app"
POD_APP_FILE = f"{POD_APP_DIR}/dst.txt"

TIMEOUT_DEFAULT = 60
CHUNK_SIZE = 32_768
# Linux caps a single argv string at MAX_ARG_STRLEN; 131,071 usable bytes.
MAX_ARG_STRLEN = 131_072
MIB = 1_048_576
PUSH_OUTPUT_CEILING = 256 * MIB
MAX_SIZE_MIB_DEFAULT = 256
MAX_FILES_DEFAULT = 10_000

STAGE_PREFIX = "wave-cp-"
STAGE_NAME_PATTERN = r"^wave-cp-[0-9a-f]+$"
SCRATCH_NAME = "payload.b64"
APPEND_SCRIPT = 'printf %s "$1" >> "$2"'
EXTRACT_SCRIPT = 'base64 -d "$1" | tar -xmf - -C "$2"; rc=$?; rm -rf "$3"; exit $rc'
EXTRACT_SCRIPT_NO_PRESERVE = (
    'base64 -d "$1" | tar --no-same-permissions --no-same-owner -xmf - -C "$2"; '
    'rc=$?; rm -rf "$3"; exit $rc'
)

TOO_LARGE_REASON = "ArchiveTooLarge"
TOO_MANY_REASON = "ArchiveTooManyEntries"
OUTPUT_TOO_LARGE_REASON = "OutputTooLarge"
NON_ZERO_REASON = "NonZeroExitCode"
CEILING_MESSAGE = "Kubernetes exec channel produced more than 256 MiB of output"
CLOSED_EARLY = "Kubernetes exec channel closed before the command finished"

SUMMARY_COLUMNS = [
    {"name": "SOURCE", "type": "string"},
    {"name": "TARGET", "type": "string"},
    {"name": "SIZE", "type": "integer"},
]
EMPTY_SUMMARY = {"__wave_type": "table", "columns": SUMMARY_COLUMNS, "rows": []}

SESSION_MESSAGE = (
    "Parameter 'session' is not a kubeconfig WAVE can read: "
    "use the 'session' output of a K8s Connect block"
)
NOT_FOUND_DETAIL = 'pods "web-1" not found'

# Bytes no UTF-8 decoder can represent; a plain .encode() or errors="replace" loses them.
RAW_BYTES = b"\xff\xfe\x80\x9c\x00 tar payload \xc3\x28 \xed\xa0\x80"
EVERY_BYTE = bytes(range(256)) * 8

# Header attributes a pod-side tar can carry that must never reach the landed file.
HEADER_MODE_WORLD = 0o777
HEADER_MODE_SETUID = 0o4755
HEADER_UID = 4242
HEADER_GID = 4243
HEADER_UNAME = "podroot"
HEADER_GNAME = "podgroup"

BIG_CONTENT = b"Z" * 90_000
BIG_PUSH_CHUNKS = 4
# mkdir, one exec per chunk, extract.
BIG_PUSH_EXECS = BIG_PUSH_CHUNKS + 2
SMALL_PUSH_EXECS = 3

HALF_MIB = b"h" * (MIB // 2)
# Far more bytes than one read hands out, so they arrive over many reads.
LATER_CONTENT = b"L" * 65_536
THREE_FILES: list[tuple[str, bytes | None]] = [
    ("srv/work/data/a.txt", b"A"),
    ("srv/work/data/sub/b.txt", b"BB"),
    ("srv/work/data/sub/c.txt", b"CCC"),
]
# a.txt whole, then b.bin cut short inside its bytes.
CUT_AT = 4096
# A file already at a landing path, under a mode no new file lands under.
EARLIER = b"earlier\n"
EARLIER_MODE = 0o600

_BOTH_MODES = pytest.mark.parametrize("on_error", ["fail", "record"])
_UNSET_ROW = pytest.mark.parametrize(
    "unset", [{}, {"value": None}, {"value": ""}], ids=["absent", "none", "blank"]
)


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


def _copy_message(way: str, detail: str, container: str) -> str:
    where = f"pod '{POD}' (container '{container}') in namespace '{NAMESPACE}'"
    return f"Could not copy {way} {where}: {detail}"


def _pull_message(detail: str, container: str = CONTAINER) -> str:
    return _copy_message("from", detail, container)


def _push_message(detail: str, container: str = CONTAINER) -> str:
    return _copy_message("to", detail, container)


def _params(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "pod": POD,
        "container": CONTAINER,
        "source_path": POD_FILE,
        "target_path": POD_DEST_FILE,
    }
    params.update(overrides)
    return block_params(**params)


def _pull_params(target: str, **overrides: Any) -> dict[str, Any]:
    """A pull whose WAVE-side target is already the absolute path the bridge resolved."""
    pulled: dict[str, Any] = {"direction": "from_pod", "target_path": target}
    pulled.update(overrides)
    return _params(**pulled)


def _push_params(source: str, **overrides: Any) -> dict[str, Any]:
    """A push whose WAVE-side source is already the absolute path the bridge resolved."""
    pushed: dict[str, Any] = {"direction": "to_pod", "source_path": source}
    pushed.update(overrides)
    return _params(**pushed)


def _member(name: str, content: bytes | None, **header: Any) -> tarfile.TarInfo:
    """One member header; a member whose content is None is a directory entry."""
    info = tarfile.TarInfo(name)
    if content is None:
        info.type = tarfile.DIRTYPE
    else:
        info.size = len(content)
    for field, value in header.items():
        setattr(info, field, value)
    return info


def _archive(members: list[tuple[tarfile.TarInfo, bytes | None]]) -> bytes:
    """A tar stream carrying the given member headers, in order."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for info, content in members:
            archive.addfile(info, io.BytesIO(content) if content is not None else None)
    return buffer.getvalue()


def _tar(members: list[tuple[str, bytes | None]]) -> bytes:
    """A tar stream; a member whose content is None is a directory entry."""
    return _archive([(_member(name, content), content) for name, content in members])


def _header_tar(**header: Any) -> bytes:
    """A one-file tar whose member header carries the given attributes."""
    content = b"hello\n"
    return _archive([(_member(POD_FILE.lstrip("/"), content, **header), content)])


def _one_file_tar(content: bytes = b"hello\n") -> bytes:
    return _tar([("srv/work/src.txt", content)])


def _header_only(size: int) -> bytes:
    """A stream that ends right after one regular file's header, which claims size bytes."""
    info = tarfile.TarInfo(POD_FILE.lstrip("/"))
    info.size = size
    return info.tobuf()


def _later_tar() -> bytes:
    """A small first file, then one whose bytes arrive over many reads."""
    return _tar([("srv/work/data/a.txt", b"A"), ("srv/work/data/b.bin", LATER_CONTENT)])


def _pull_stream(archive: bytes, **script: Any) -> FakeExecStdout:
    """The pod's tar on standard output as a stream; exit code 0 unless scripted."""
    return FakeExecStdout(archive, **script)


def _watched(
    archive: bytes, path: Path, **script: Any
) -> tuple[FakeExecStdout, list[tuple[int, bool]]]:
    """A stream that records, at every read, how far it had got and whether path existed."""
    seen: list[tuple[int, bool]] = []
    stream = FakeExecStdout(
        archive, on_read=lambda offset: seen.append((offset, path.exists())), **script
    )
    return stream, seen


def _read_along(archive: bytes, path: Path, **script: Any) -> tuple[FakeExecStdout, list[bytes]]:
    """A stream that records, at every read, the bytes at path."""
    seen: list[bytes] = []
    stream = FakeExecStdout(
        archive, on_read=lambda _offset: seen.append(path.read_bytes()), **script
    )
    return stream, seen


def _earlier_file(path: Path) -> Path:
    """A file that is already at a landing path before the pull starts."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(EARLIER)
    path.chmod(EARLIER_MODE)
    return path


def _state(path: Path) -> tuple[bytes, int]:
    return path.read_bytes(), _mode(path)


def _push_channel(execs: int = SMALL_PUSH_EXECS) -> FakeExecChannel:
    return FakeExecChannel([("", "", 0)] * execs)


def _control_file(directory: Any) -> Any:
    """A file WAVE creates the ordinary way, so a test reads the mode this run lands under."""
    control = directory / "control.txt"
    control.write_bytes(b"control\n")
    return control


def _mode(path: Any) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def _source_file(tmp_path: Any, content: bytes = b"hello\n") -> Any:
    source = tmp_path / "a.txt"
    source.write_bytes(content)
    return source


def _source_tree(tmp_path: Any) -> Any:
    tree = tmp_path / "data"
    (tree / "sub").mkdir(parents=True)
    (tree / "a.txt").write_bytes(b"A")
    (tree / "sub" / "b.txt").write_bytes(b"BB")
    return tree


def _run(
    fake: FakeExecStdout | FakeExecChannel, params: dict[str, Any], log: Any = None
) -> dict[str, Any]:
    """Run the verb against the seam its direction reaches: a pull streams, a push accumulates."""
    with ExitStack() as stack:
        if isinstance(fake, FakeExecStdout):
            stack.enter_context(patch_pull(fake))
        else:
            stack.enter_context(patch_exec(fake))
        envelope: dict[str, Any] = cp.run(params, log if log is not None else RecordingLog())
    return envelope


def _outputs(
    fake: FakeExecStdout | FakeExecChannel, params: dict[str, Any], log: Any = None
) -> dict[str, Any]:
    outputs: dict[str, Any] = _run(fake, params, log)["outputs"]
    return outputs


def _rows(outputs: dict[str, Any]) -> list[list[Any]]:
    rows: list[list[Any]] = outputs["summary"]["rows"]
    return rows


def _stage(channel: FakeExecChannel) -> str:
    """The staging directory the first exec of a push created."""
    return channel.calls[0].command[1]


def _chunk_calls(channel: FakeExecChannel) -> list[ExecCall]:
    """Every append exec: the mkdir leads and the extract exec trails."""
    return channel.calls[1:-1]


def _chunks(channel: FakeExecChannel) -> list[str]:
    return [call.command[4] for call in _chunk_calls(channel)]


def _scratch(channel: FakeExecChannel) -> str:
    return _chunk_calls(channel)[0].command[5]


def _final(channel: FakeExecChannel) -> ExecCall:
    return channel.calls[-1]


def _pushed_tar(channel: FakeExecChannel) -> bytes:
    return base64.b64decode("".join(_chunks(channel)))


def _pushed_names(channel: FakeExecChannel) -> list[str]:
    with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
        return [member.name for member in archive.getmembers() if member.isfile()]


class TestVerbShape:
    """run is a plain sync function returning the JSON-safe result envelope."""

    def test_run_is_not_a_coroutine_function(self) -> None:
        assert inspect.iscoroutinefunction(cp.run) is False

    def test_run_is_a_plain_module_level_function(self) -> None:
        assert inspect.isfunction(cp.run) is True

    def test_run_takes_the_parameters_and_the_log_callable(self) -> None:
        assert list(inspect.signature(cp.run).parameters) == ["params", "log"]

    def test_the_envelope_carries_exactly_the_three_wire_keys(self, tmp_path: Any) -> None:
        envelope = _run(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        assert envelope["__wave_type"] == "result"

    def test_a_happy_pull_returns_exactly_the_declared_outputs(self, tmp_path: Any) -> None:
        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert set(outputs) == {"summary", "success", "error", "reason"}

    def test_a_happy_pull_carries_the_full_output_core(self, tmp_path: Any) -> None:
        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert outputs["success"] is True
        assert outputs["error"] == ""
        assert outputs["reason"] == ""

    def test_a_happy_push_returns_exactly_the_declared_outputs(self, tmp_path: Any) -> None:
        outputs = _outputs(_push_channel(), _push_params(str(_source_file(tmp_path))))

        assert set(outputs) == {"summary", "success", "error", "reason"}
        assert outputs["success"] is True

    def test_a_pull_carries_no_secrets(self, tmp_path: Any) -> None:
        envelope = _run(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert envelope["secrets"] == []

    def test_a_push_carries_no_secrets(self, tmp_path: Any) -> None:
        envelope = _run(_push_channel(), _push_params(str(_source_file(tmp_path))))

        assert envelope["secrets"] == []

    def test_a_pull_envelope_survives_a_json_round_trip_unchanged(self, tmp_path: Any) -> None:
        envelope = _run(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_a_push_envelope_survives_a_json_round_trip_unchanged(self, tmp_path: Any) -> None:
        envelope = _run(_push_channel(), _push_params(str(_source_file(tmp_path))))

        assert json.loads(json.dumps(envelope)) == envelope

    def test_the_pull_reaches_the_stream_through_the_ws_module_attribute(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert len(stream.calls) == 1

    def test_the_push_reaches_the_channel_through_the_ws_module_attribute(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert channel.factory.call_count == SMALL_PUSH_EXECS


class TestDirection:
    """from_pod pulls; the verb validates nothing, so every other value pushes."""

    def test_an_absent_direction_pulls(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        del params["direction"]
        stream = _pull_stream(_one_file_tar())

        _run(stream, params)

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    def test_to_pod_pushes(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert [call.command[0] for call in channel.calls] == ["mkdir", "sh", "sh"]

    def test_any_other_direction_pushes(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), direction="sideways"))

        assert [call.command[0] for call in channel.calls] == ["mkdir", "sh", "sh"]


class TestPullCommand:
    """From Pod: one streamed `tar cf -` exec, argument for argument, and never stdin."""

    def test_a_single_file_pull_runs_exactly_one_exec(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert len(stream.calls) == 1

    def test_the_pull_argv_is_kubectls_own(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    def test_the_pull_never_reaches_the_accumulating_channel(self, tmp_path: Any) -> None:
        """The streamed exec takes no standard input; the accumulating one is push-only."""
        stream = _pull_stream(_one_file_tar())

        with patch_pull(stream) as channel:
            cp.run(_pull_params(str(tmp_path / "out.txt")), RecordingLog())

        assert channel.calls == []
        assert len(stream.calls) == 1

    def test_a_directory_pull_is_one_exec_with_the_same_argv_shape(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data", None), ("srv/work/data/a.txt", b"A")]))

        _run(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR))

        assert len(stream.calls) == 1
        assert stream.last.command == ["tar", "cf", "-", POD_DIR]

    def test_no_preserve_does_not_change_the_pull_argv(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), no_preserve=True))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    def test_the_limit_rows_do_not_change_the_pull_argv(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), max_size_mib=5, max_files=7))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    def test_an_untrimmed_pod_path_reaches_the_argv_stripped(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), source_path=f"  {POD_FILE}  "))

        assert stream.last.command == ["tar", "cf", "-", POD_FILE]

    def test_the_container_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), container="sidecar"))

        assert stream.last.container == "sidecar"

    def test_the_pod_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.pod == POD

    def test_the_session_namespace_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.namespace == NAMESPACE

    def test_an_explicit_namespace_overrides_the_session_namespace(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), namespace="ops"))

        assert stream.last.namespace == "ops"

    def test_an_unset_timeout_reaches_the_seam_as_sixty(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        stream = _pull_stream(_one_file_tar())

        assert "timeout" not in params
        _run(stream, params)

        assert stream.last.timeout == TIMEOUT_DEFAULT

    def test_a_set_timeout_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), timeout=45))

        assert stream.last.timeout == 45

    def test_impersonation_reaches_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())
        params = _pull_params(
            str(tmp_path / "out.txt"), impersonate_user="qa-bot", impersonate_groups="dev, ops"
        )

        _run(stream, params)

        assert stream.last.impersonate_user == "qa-bot"
        assert stream.last.impersonate_groups == ["dev", "ops"]

    def test_no_impersonation_reaches_the_seam_as_none(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.impersonate_user is None
        assert stream.last.impersonate_groups is None

    def test_the_parsed_session_is_the_first_argument_to_the_seam(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.last.context.server == SERVER
        assert stream.last.context.namespace == NAMESPACE


class TestPullExtraction:
    """The tar arrives as bytes on the stream and lands under the absolute target."""

    def test_a_single_file_lands_at_the_target_path(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"

        _run(_pull_stream(_one_file_tar()), _pull_params(str(target)))

        assert target.read_bytes() == b"hello\n"

    def test_a_pulled_directory_lands_as_its_files_under_the_target(self, tmp_path: Any) -> None:
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

        _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "a.txt").read_bytes() == b"A"
        assert (target / "sub" / "b.txt").read_bytes() == b"BB"

    def test_the_pull_creates_missing_parent_directories(self, tmp_path: Any) -> None:
        target = tmp_path / "deep" / "nested" / "out.txt"

        _run(_pull_stream(_one_file_tar()), _pull_params(str(target)))

        assert target.read_bytes() == b"hello\n"

    def test_a_directory_member_lands_no_row(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data", None), ("srv/work/data/a.txt", b"A")]))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR))

        assert len(_rows(outputs)) == 1

    def test_bytes_that_are_not_valid_utf8_survive_the_pull(self, tmp_path: Any) -> None:
        target = tmp_path / "out.bin"

        _run(_pull_stream(_one_file_tar(RAW_BYTES)), _pull_params(str(target)))

        assert target.read_bytes() == RAW_BYTES

    def test_every_byte_value_survives_the_pull(self, tmp_path: Any) -> None:
        target = tmp_path / "out.bin"

        _run(_pull_stream(_one_file_tar(EVERY_BYTE)), _pull_params(str(target)))

        assert target.read_bytes() == EVERY_BYTE

    def test_every_file_of_a_binary_directory_pull_lands_intact(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.bin", RAW_BYTES), ("srv/work/data/sub/b.bin", EVERY_BYTE)])
        )
        target = tmp_path / "out"

        _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "a.bin").read_bytes() == RAW_BYTES
        assert (target / "sub" / "b.bin").read_bytes() == EVERY_BYTE

    def test_a_file_split_across_many_reads_lands_intact(self, tmp_path: Any) -> None:
        target = tmp_path / "out.bin"
        stream = _pull_stream(_one_file_tar(LATER_CONTENT), chunk_size=100)

        _run(stream, _pull_params(str(target)))

        assert target.read_bytes() == LATER_CONTENT

    def test_a_member_that_climbs_out_of_the_source_lands_under_the_target(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_tar([("srv/work/data/../../etc/passwd", b"root\n")]))
        target = tmp_path / "out"

        _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "etc" / "passwd").read_bytes() == b"root\n"

    def test_the_landing_path_is_the_target_cell_of_its_row(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data/sub/b.txt", b"BB")]))
        target = tmp_path / "out"

        outputs = _outputs(stream, _pull_params(str(target), source_path=POD_DIR))

        assert _rows(outputs)[0][1] == str(target / "sub" / "b.txt")
        assert (target / "sub" / "b.txt").read_bytes() == b"BB"

    def test_a_nested_member_lands_with_its_intermediate_directories_created(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_tar([("srv/work/data/a/b/c/deep.txt", b"D")]))
        target = tmp_path / "missing" / "out"

        _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert (target / "a" / "b" / "c" / "deep.txt").read_bytes() == b"D"

    def test_a_tree_without_directory_members_lands_intact_with_its_rows(
        self, tmp_path: Any
    ) -> None:
        members: list[tuple[str, bytes | None]] = [
            ("srv/work/data/one.txt", b"one"),
            ("srv/work/data/deep/two.txt", b"two"),
        ]
        target = tmp_path / "out"

        outputs = _outputs(
            _pull_stream(_tar(members)), _pull_params(str(target), source_path=POD_DIR)
        )

        assert (target / "one.txt").read_bytes() == b"one"
        assert (target / "deep" / "two.txt").read_bytes() == b"two"
        assert _rows(outputs) == [
            [f"{POD_DIR}/one.txt", str(target / "one.txt"), 3],
            [f"{POD_DIR}/deep/two.txt", str(target / "deep" / "two.txt"), 3],
        ]

    def test_the_verb_resolves_no_scheme_of_its_own(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"
        params = _pull_params(str(target), artifacts_dir=str(tmp_path / "runs"))

        _run(_pull_stream(_one_file_tar()), params)

        assert target.read_bytes() == b"hello\n"
        assert not (tmp_path / "runs").exists()


class TestPullFileAttributes:
    """The landed file's mode and ownership are WAVE's own; the tar header carries neither."""

    def test_a_world_writable_header_mode_does_not_reach_the_landed_file(
        self, tmp_path: Any
    ) -> None:
        target = tmp_path / "out.txt"
        control = _control_file(tmp_path)

        _run(_pull_stream(_header_tar(mode=HEADER_MODE_WORLD)), _pull_params(str(target)))

        assert _mode(target) == _mode(control)

    def test_a_setuid_header_mode_does_not_reach_the_landed_file(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"
        control = _control_file(tmp_path)

        _run(_pull_stream(_header_tar(mode=HEADER_MODE_SETUID)), _pull_params(str(target)))

        assert _mode(target) == _mode(control)
        assert target.stat().st_mode & stat.S_ISUID == 0

    def test_the_header_ownership_does_not_reach_the_landed_file(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"
        archive = _header_tar(
            uid=HEADER_UID, gid=HEADER_GID, uname=HEADER_UNAME, gname=HEADER_GNAME
        )

        _run(_pull_stream(archive), _pull_params(str(target)))

        assert target.stat().st_uid == os.getuid()
        assert target.stat().st_gid in {os.getgid(), *os.getgroups()}


class TestStreamedPull:
    """Each file lands as the stream brings it, so memory never grows with the copy (K8SEXEC-10)."""

    def test_a_file_is_on_disk_before_the_files_after_it_have_arrived(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        stream, seen = _watched(_later_tar(), target / "a.txt", chunk_size=1024)

        _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert any(landed for offset, landed in seen if offset < len(LATER_CONTENT))
        assert (target / "b.bin").read_bytes() == LATER_CONTENT

    def test_the_pull_never_asks_the_stream_for_all_of_it_at_once(self, tmp_path: Any) -> None:
        stream = _pull_stream(_later_tar(), chunk_size=1024)

        _run(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR))

        assert stream.requested
        assert min(stream.requested) >= 0

    def test_a_happy_pull_finishes_the_stream_once_to_read_the_exit_code(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.finish_calls == 1
        assert stream.finished is True

    def test_the_stream_is_closed_once_the_pull_is_done(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.closed is True

    def test_the_stream_is_closed_when_a_limit_stops_the_pull(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar(THREE_FILES))
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_files=1)

        with pytest.raises(ValueError):
            _run(stream, params)

        assert stream.closed is True


class TestPullLimitDefaults:
    """The verb keeps its own defaults, since on a remote host nothing fills them in."""

    def test_the_max_size_default_is_the_pinned_number(self) -> None:
        assert cp.MAX_SIZE_MIB_DEFAULT == MAX_SIZE_MIB_DEFAULT

    def test_the_max_files_default_is_the_pinned_number(self) -> None:
        assert cp.MAX_FILES_DEFAULT == MAX_FILES_DEFAULT

    @_UNSET_ROW
    def test_an_unset_max_size_refuses_a_file_over_256_mib(
        self, unset: dict[str, Any], tmp_path: Any
    ) -> None:
        params = _pull_params(str(tmp_path / "out.txt"))
        if unset:
            params["max_size_mib"] = unset["value"]
        stream = _pull_stream(_header_only(MAX_SIZE_MIB_DEFAULT * MIB + 1))

        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(256)))):
            _run(stream, params)

    @_UNSET_ROW
    def test_unset_limit_rows_read_as_the_defaults(self, unset: dict[str, Any]) -> None:
        params: dict[str, Any] = {}
        if unset:
            params = {"max_size_mib": unset["value"], "max_files": unset["value"]}

        assert cp._limits(params) == cp._Limits(max_size_mib=256, max_files=10_000)

    def test_set_limit_rows_are_read_as_given(self) -> None:
        assert cp._limits({"max_size_mib": 3, "max_files": 0}) == cp._Limits(
            max_size_mib=3, max_files=0
        )


class TestPullMaxFiles:
    """Max files stops the pull at the file one past it, before that file is written."""

    def test_a_pull_exactly_at_max_files_lands_every_file(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar([("srv/work/data/a.txt", b"A"), ("srv/work/data/b.txt", b"B")]))
        target = tmp_path / "out"

        _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert (target / "a.txt").read_bytes() == b"A"
        assert (target / "b.txt").read_bytes() == b"B"

    def test_one_file_more_than_max_files_is_refused(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar(THREE_FILES))
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_files=2)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(2)))):
            _run(stream, params)

    def test_the_max_files_refusal_is_recorded_with_its_reason(self, tmp_path: Any) -> None:
        stream = _pull_stream(_tar(THREE_FILES))
        params = _pull_params(
            str(tmp_path / "out"), source_path=POD_DIR, max_files=2, on_error="record"
        )

        outputs = _outputs(stream, params)

        assert outputs["success"] is False
        assert outputs["error"] == _pull_message(_over_files_detail(2))
        assert outputs["reason"] == TOO_MANY_REASON
        assert outputs["summary"] == EMPTY_SUMMARY
        assert outputs["__block_warning"] is True

    def test_directory_members_do_not_count_toward_max_files(self, tmp_path: Any) -> None:
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

        _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert (target / "sub" / "b.txt").read_bytes() == b"B"

    def test_the_file_past_max_files_never_reaches_the_disk(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        stream, seen = _watched(_tar(THREE_FILES), target / "sub" / "c.txt", chunk_size=512)

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert seen
        assert not any(landed for _offset, landed in seen)

    def test_zero_max_files_means_no_limit(self, tmp_path: Any) -> None:
        target = tmp_path / "out"

        outputs = _outputs(
            _pull_stream(_tar(THREE_FILES)),
            _pull_params(str(target), source_path=POD_DIR, max_files=0),
        )

        assert len(_rows(outputs)) == 3
        assert (target / "sub" / "c.txt").read_bytes() == b"CCC"

    def test_max_files_is_checked_before_max_size(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB + b"!")])
        )
        params = _pull_params(
            str(tmp_path / "out"), source_path=POD_DIR, max_files=1, max_size_mib=1
        )

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(1)))):
            _run(stream, params)


class TestPullMaxSize:
    """Max size (MiB) is judged at each file's header: the file that would pass it never lands."""

    def test_a_pull_exactly_at_max_size_lands_every_file(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB)])
        )
        target = tmp_path / "out"

        _run(stream, _pull_params(str(target), source_path=POD_DIR, max_size_mib=1))

        assert (target / "a.bin").read_bytes() == HALF_MIB
        assert (target / "b.bin").read_bytes() == HALF_MIB

    def test_the_header_that_would_pass_max_size_is_refused(self, tmp_path: Any) -> None:
        members: list[tuple[str, bytes | None]] = [
            ("srv/work/data/a.bin", HALF_MIB),
            ("srv/work/data/b.bin", HALF_MIB),
            ("srv/work/data/c.txt", b"!"),
        ]
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_size_mib=1)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(1)))):
            _run(_pull_stream(_tar(members)), params)

    def test_a_file_over_max_size_is_refused_on_its_header_alone(self, tmp_path: Any) -> None:
        """No bytes follow the header, so the refusal cannot wait for them."""
        stream = _pull_stream(_header_only(MIB + 1))

        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(1)))):
            _run(stream, _pull_params(str(tmp_path / "out.txt"), max_size_mib=1))

    def test_the_max_size_refusal_is_recorded_with_its_reason(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), max_size_mib=1, on_error="record")

        outputs = _outputs(_pull_stream(_header_only(MIB + 1)), params)

        assert outputs["success"] is False
        assert outputs["error"] == _pull_message(_over_size_detail(1))
        assert outputs["reason"] == TOO_LARGE_REASON
        assert outputs["summary"] == EMPTY_SUMMARY
        assert outputs["__block_warning"] is True

    def test_the_file_past_max_size_never_reaches_the_disk(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        archive = _tar(
            [("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB + b"!")]
        )
        stream, seen = _watched(archive, target / "b.bin")

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, max_size_mib=1))

        assert seen
        assert not any(landed for _offset, landed in seen)

    def test_zero_max_size_means_no_limit(self, tmp_path: Any) -> None:
        target = tmp_path / "out.bin"

        _run(_pull_stream(_one_file_tar(HALF_MIB)), _pull_params(str(target), max_size_mib=0))

        assert target.read_bytes() == HALF_MIB

    def test_zero_max_size_does_not_fall_back_to_the_default(self, tmp_path: Any) -> None:
        """Past a 256 MiB header the pull reads on, so the pod's own exit decides."""
        stderr = "tar: /srv/work/src.txt: File shrank by 268435457 bytes; padding with zeros"
        stream = _pull_stream(
            _header_only(MAX_SIZE_MIB_DEFAULT * MIB + 1), stderr=stderr, exit_code=1
        )

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(tmp_path / "out.txt"), max_size_mib=0))

    def test_zero_on_one_limit_leaves_the_other_in_force(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), max_size_mib=1, max_files=0)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_size_detail(1)))):
            _run(_pull_stream(_header_only(MIB + 1)), params)


class TestPullTakesBackWhatItWrote:
    """A stopped or failed pull removes the files it wrote and the folders it created."""

    def test_the_files_that_landed_are_removed_when_max_files_refuses(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        stream, seen = _watched(_tar(THREE_FILES), target / "a.txt", chunk_size=512)

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert any(landed for _offset, landed in seen)
        assert not (target / "a.txt").exists()
        assert not (target / "sub" / "b.txt").exists()

    def test_the_files_that_landed_are_removed_when_max_size_refuses(self, tmp_path: Any) -> None:
        target = tmp_path / "out"
        archive = _tar(
            [("srv/work/data/a.bin", HALF_MIB), ("srv/work/data/b.bin", HALF_MIB + b"!")]
        )

        with pytest.raises(ValueError):
            _run(
                _pull_stream(archive),
                _pull_params(str(target), source_path=POD_DIR, max_size_mib=1),
            )

        assert not (target / "a.bin").exists()

    def test_the_folders_the_pull_created_are_removed(self, tmp_path: Any) -> None:
        target = tmp_path / "made" / "out"

        with pytest.raises(ValueError):
            _run(
                _pull_stream(_tar(THREE_FILES)),
                _pull_params(str(target), source_path=POD_DIR, max_files=2),
            )

        assert list(tmp_path.iterdir()) == []

    def test_a_folder_that_was_there_before_the_pull_is_kept(self, tmp_path: Any) -> None:
        target = tmp_path / "existing"
        target.mkdir()
        (target / "keep.txt").write_bytes(b"keep")

        with pytest.raises(ValueError):
            _run(
                _pull_stream(_tar(THREE_FILES)),
                _pull_params(str(target), source_path=POD_DIR, max_files=2),
            )

        assert sorted(entry.name for entry in target.iterdir()) == ["keep.txt"]
        assert (target / "keep.txt").read_bytes() == b"keep"

    def test_a_refused_pull_reads_the_stream_no_further(self, tmp_path: Any) -> None:
        stream = _pull_stream(_later_tar())

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR, max_files=1))

        assert stream.handed_out < len(LATER_CONTENT)
        assert stream.finish_calls == 0

    def test_a_non_zero_exit_after_the_stream_removes_what_landed(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/data/sub/c.txt: file changed as we read it"
        target = tmp_path / "out"
        stream, seen = _watched(
            _tar(THREE_FILES), target / "a.txt", chunk_size=512, stderr=stderr, exit_code=1
        )

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert any(landed for _offset, landed in seen)
        assert list(tmp_path.iterdir()) == []

    def test_a_recorded_non_zero_exit_keeps_no_rows_and_no_files(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/data/sub/c.txt: file changed as we read it"
        target = tmp_path / "out"
        stream = _pull_stream(_tar(THREE_FILES), stderr=stderr, exit_code=1)
        params = _pull_params(str(target), source_path=POD_DIR, on_error="record")

        outputs = _outputs(stream, params)

        assert outputs["error"] == _pull_message(stderr)
        assert outputs["reason"] == NON_ZERO_REASON
        assert outputs["summary"] == EMPTY_SUMMARY
        assert list(tmp_path.iterdir()) == []

    def test_a_file_cut_short_by_the_stream_is_removed_too(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/data/b.bin: Read error at byte 2560"
        target = tmp_path / "out"
        stream = _pull_stream(_later_tar()[:CUT_AT], stderr=stderr, exit_code=2)

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert list(tmp_path.iterdir()) == []

    @_BOTH_MODES
    def test_a_timeout_mid_stream_removes_what_landed(self, on_error: str, tmp_path: Any) -> None:
        target = tmp_path / "out"
        stream = _pull_stream(
            _later_tar(), read_error=ExecTimeout("timed out"), read_error_at=CUT_AT
        )

        with pytest.raises(ValueError, match=exact("File copy timed out after 60 seconds")):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, on_error=on_error))

        assert list(tmp_path.iterdir()) == []

    @_BOTH_MODES
    def test_a_timeout_at_the_end_of_the_stream_removes_what_landed(
        self, on_error: str, tmp_path: Any
    ) -> None:
        target = tmp_path / "out"
        stream = _pull_stream(_tar(THREE_FILES), finish_error=ExecTimeout("timed out"))

        with pytest.raises(ValueError, match=exact("File copy timed out after 60 seconds")):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, on_error=on_error))

        assert list(tmp_path.iterdir()) == []

    @_BOTH_MODES
    def test_a_transport_failure_mid_stream_removes_what_landed(
        self, on_error: str, tmp_path: Any
    ) -> None:
        target = tmp_path / "out"
        stream = _pull_stream(
            _later_tar(), read_error=ExecTransportError(CLOSED_EARLY), read_error_at=CUT_AT
        )

        with pytest.raises(ValueError, match=exact(_pull_message(CLOSED_EARLY))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, on_error=on_error))

        assert list(tmp_path.iterdir()) == []

    def test_a_refusal_at_the_end_of_the_stream_is_recorded_and_removes_what_landed(
        self, tmp_path: Any
    ) -> None:
        detail = 'container "app" in pod "web-1" is terminated'
        target = tmp_path / "out"
        stream = _pull_stream(_tar(THREE_FILES), finish_error=ExecRejected(detail, "InternalError"))
        params = _pull_params(str(target), source_path=POD_DIR, on_error="record")

        outputs = _outputs(stream, params)

        assert outputs["error"] == _pull_message(detail)
        assert outputs["reason"] == "InternalError"
        assert outputs["summary"] == EMPTY_SUMMARY
        assert list(tmp_path.iterdir()) == []

    def test_a_refusal_mid_stream_is_recorded_and_removes_what_landed(self, tmp_path: Any) -> None:
        detail = 'container "app" in pod "web-1" is terminated'
        target = tmp_path / "out"
        stream = _pull_stream(
            _later_tar(), read_error=ExecRejected(detail, "InternalError"), read_error_at=CUT_AT
        )
        params = _pull_params(str(target), source_path=POD_DIR, on_error="record")

        outputs = _outputs(stream, params)

        assert outputs["error"] == _pull_message(detail)
        assert outputs["reason"] == "InternalError"
        assert list(tmp_path.iterdir()) == []


class TestPullPutsBackWhatItReplaced:
    """A failed pull leaves every file it replaced as it was; a finished one keeps the new bytes."""

    def test_a_pull_stopped_by_max_files_puts_back_the_file_it_replaced(
        self, tmp_path: Any
    ) -> None:
        target = tmp_path / "out"
        earlier = _earlier_file(target / "a.txt")
        stream, seen = _read_along(_tar(THREE_FILES), earlier, chunk_size=512)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(2)))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert b"A" in seen
        assert _state(earlier) == (EARLIER, EARLIER_MODE)
        assert sorted(entry.name for entry in target.iterdir()) == ["a.txt"]

    def test_a_non_zero_exit_after_the_stream_puts_back_the_file_it_replaced(
        self, tmp_path: Any
    ) -> None:
        stderr = "tar: /srv/work/data/sub/c.txt: file changed as we read it"
        target = tmp_path / "out"
        earlier = _earlier_file(target / "a.txt")
        stream, seen = _read_along(
            _tar(THREE_FILES), earlier, chunk_size=512, stderr=stderr, exit_code=1
        )

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert b"A" in seen
        assert _state(earlier) == (EARLIER, EARLIER_MODE)
        assert sorted(entry.name for entry in target.iterdir()) == ["a.txt"]

    @pytest.mark.parametrize(
        ("error", "message"),
        [
            (ExecTransportError(CLOSED_EARLY), _pull_message(CLOSED_EARLY)),
            (ExecTimeout("timed out"), "File copy timed out after 60 seconds"),
        ],
        ids=["transport", "timeout"],
    )
    def test_a_stream_cut_mid_file_puts_back_every_file_it_replaced(
        self, error: Exception, message: str, tmp_path: Any
    ) -> None:
        target = tmp_path / "out"
        whole = _earlier_file(target / "a.txt")
        cut = _earlier_file(target / "b.bin")
        stream = _pull_stream(_later_tar(), read_error=error, read_error_at=CUT_AT)

        with pytest.raises(ValueError, match=exact(message)):
            _run(stream, _pull_params(str(target), source_path=POD_DIR))

        assert _state(whole) == (EARLIER, EARLIER_MODE)
        assert _state(cut) == (EARLIER, EARLIER_MODE)
        assert sorted(entry.name for entry in target.iterdir()) == ["a.txt", "b.bin"]

    def test_a_finished_pull_over_a_file_keeps_only_the_new_bytes(self, tmp_path: Any) -> None:
        target = _earlier_file(tmp_path / "out.txt")

        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(target)))

        assert target.read_bytes() == b"hello\n"
        assert [entry.name for entry in tmp_path.iterdir()] == ["out.txt"]
        assert _rows(outputs) == [[POD_FILE, str(target), 6]]

    def test_a_path_the_archive_carries_twice_puts_back_the_file_it_first_replaced(
        self, tmp_path: Any
    ) -> None:
        members: list[tuple[str, bytes | None]] = [
            ("srv/work/data/a.txt", b"first"),
            ("srv/work/data/a.txt", b"second"),
            ("srv/work/data/b.txt", b"B"),
        ]
        target = tmp_path / "out"
        earlier = _earlier_file(target / "a.txt")
        stream, seen = _read_along(_tar(members), earlier, chunk_size=512)

        with pytest.raises(ValueError, match=exact(_pull_message(_over_files_detail(2)))):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, max_files=2))

        assert b"second" in seen
        assert _state(earlier) == (EARLIER, EARLIER_MODE)
        assert sorted(entry.name for entry in target.iterdir()) == ["a.txt"]


class TestPullUnreadableStream:
    """A stream tarfile cannot read is judged by the pod's exit code."""

    def test_an_empty_stream_with_a_non_zero_exit_carries_the_stderr(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/src.txt: No such file or directory"

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(
                _pull_stream(b"", stderr=stderr, exit_code=2),
                _pull_params(str(tmp_path / "out.txt")),
            )

    def test_an_empty_archive_with_a_non_zero_exit_carries_the_stderr(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/src.txt: Cannot stat: No such file or directory"
        stream = _pull_stream(b"\0" * 10_240, stderr=stderr, exit_code=2)

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(tmp_path / "out.txt")))

    def test_a_cut_stream_with_a_non_zero_exit_records_the_non_zero_exit_reason(
        self, tmp_path: Any
    ) -> None:
        stderr = "tar: /srv/work/data/b.bin: Read error at byte 2560"
        stream = _pull_stream(_later_tar()[:CUT_AT], stderr=stderr, exit_code=2)
        params = _pull_params(str(tmp_path / "out"), source_path=POD_DIR, on_error="record")

        outputs = _outputs(stream, params)

        assert outputs["error"] == _pull_message(stderr)
        assert outputs["reason"] == NON_ZERO_REASON

    @_BOTH_MODES
    def test_a_cut_stream_with_a_zero_exit_raises_the_read_error(
        self, on_error: str, tmp_path: Any
    ) -> None:
        target = tmp_path / "out"
        stream = _pull_stream(_later_tar()[:CUT_AT])

        with pytest.raises(tarfile.ReadError, match=exact("unexpected end of data")):
            _run(stream, _pull_params(str(target), source_path=POD_DIR, on_error=on_error))

        assert list(tmp_path.iterdir()) == []

    @_BOTH_MODES
    def test_an_empty_stream_with_a_zero_exit_raises_the_read_error(
        self, on_error: str, tmp_path: Any
    ) -> None:
        with pytest.raises(tarfile.ReadError, match=exact("empty file")):
            _run(_pull_stream(b""), _pull_params(str(tmp_path / "out.txt"), on_error=on_error))

    def test_the_exit_code_is_read_once_the_read_error_is_met(self, tmp_path: Any) -> None:
        stream = _pull_stream(b"", stderr="tar: not found", exit_code=127)

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(tmp_path / "out.txt")))

        assert stream.finish_calls == 1


class TestPushCeiling:
    """To Pod carries no limit rows; each of its execs keeps the fixed output ceiling."""

    def test_the_push_output_ceiling_is_the_pinned_number(self) -> None:
        assert cp._PUSH_OUTPUT_CEILING == PUSH_OUTPUT_CEILING

    def test_a_push_over_the_ceiling_reads_as_a_copy_in(self, tmp_path: Any) -> None:
        channel = FakeExecChannel([ExecOutputTooLarge(CEILING_MESSAGE)])

        with pytest.raises(ValueError, match=exact(_push_message(CEILING_MESSAGE))):
            _run(channel, _push_params(str(_source_file(tmp_path))))

    def test_a_push_over_the_ceiling_records_the_output_too_large_reason(
        self, tmp_path: Any
    ) -> None:
        channel = FakeExecChannel([ExecOutputTooLarge(CEILING_MESSAGE)])
        params = _push_params(str(_source_file(tmp_path)), on_error="record")

        outputs = _outputs(channel, params)

        assert outputs["error"] == _push_message(CEILING_MESSAGE)
        assert outputs["reason"] == OUTPUT_TOO_LARGE_REASON
        assert outputs["summary"] == EMPTY_SUMMARY

    def test_the_limit_rows_do_not_bound_the_push(self, tmp_path: Any) -> None:
        channel = _push_channel()
        params = _push_params(
            str(_source_tree(tmp_path)), target_path=POD_DEST_TREE, max_size_mib=1, max_files=1
        )

        outputs = _outputs(channel, params)

        assert len(_rows(outputs)) == 2
        assert [call.max_output_bytes for call in channel.calls] == [PUSH_OUTPUT_CEILING] * 3


class TestPushStaging:
    """To Pod: a private staging directory beside the target, then a scratch file in it."""

    def test_a_small_push_is_the_staging_exec_one_chunk_and_the_extract_exec(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert len(channel.calls) == SMALL_PUSH_EXECS

    def test_the_push_starts_by_creating_the_staging_directory(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert channel.calls[0].command == ["mkdir", _stage(channel)]

    def test_the_staging_directory_is_created_without_the_parents_flag(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert len(channel.calls[0].command) == 2
        assert "-p" not in channel.calls[0].command

    def test_the_staging_directory_sits_in_the_directory_the_copy_targets(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        stage = _stage(channel)
        assert posixpath.dirname(stage) == POD_DEST_DIR
        assert re.match(STAGE_NAME_PATTERN, posixpath.basename(stage))

    def test_the_staging_name_carries_the_pinned_prefix(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert cp._STAGE_PREFIX == STAGE_PREFIX
        assert posixpath.basename(_stage(channel)).startswith(STAGE_PREFIX)

    def test_a_push_to_another_folder_stages_in_that_folder(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), target_path=POD_APP_FILE))

        stage = _stage(channel)
        assert posixpath.dirname(stage) == POD_APP_DIR

    def test_a_pushed_directory_stages_beside_the_directory_it_lands_in(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_tree(tmp_path)), target_path=POD_DEST_TREE))

        assert posixpath.dirname(_stage(channel)) == POD_DEST_DIR

    def test_two_pushes_stage_in_different_directories(self, tmp_path: Any) -> None:
        source = _source_file(tmp_path)
        first, second = _push_channel(), _push_channel()

        _run(first, _push_params(str(source)))
        _run(second, _push_params(str(source)))

        assert _stage(first) != _stage(second)

    def test_an_untrimmed_target_stages_under_the_stripped_directory(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), target_path=f"  {POD_DEST_FILE} "))

        assert posixpath.dirname(_stage(channel)) == POD_DEST_DIR

    def test_the_scratch_file_sits_inside_the_staging_directory(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert cp._SCRATCH_NAME == SCRATCH_NAME
        assert _scratch(channel) == f"{_stage(channel)}/{SCRATCH_NAME}"

    def test_every_exec_names_the_same_scratch_file(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT))))

        scratch = _scratch(channel)
        assert [call.command[5] for call in _chunk_calls(channel)] == [scratch] * BIG_PUSH_CHUNKS
        assert _final(channel).command[4] == scratch


class TestPushChunking:
    """The base64 payload rides the command line one argv element at a time, never stdin."""

    def test_the_chunk_size_is_the_pinned_number(self) -> None:
        assert cp._CHUNK_SIZE == CHUNK_SIZE

    def test_the_append_script_is_the_pinned_string(self) -> None:
        assert cp._APPEND_SCRIPT == APPEND_SCRIPT

    def test_every_append_exec_is_the_six_element_printf_argv(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        chunk_call = _chunk_calls(channel)[0]
        assert chunk_call.command == [
            "sh",
            "-c",
            APPEND_SCRIPT,
            "sh",
            _chunks(channel)[0],
            _scratch(channel),
        ]

    def test_a_large_push_needs_more_than_one_chunk(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT))))

        assert len(channel.calls) == BIG_PUSH_EXECS
        assert len(_chunks(channel)) == BIG_PUSH_CHUNKS

    def test_every_chunk_but_the_last_is_exactly_the_chunk_size(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT))))

        chunks = _chunks(channel)
        assert [len(chunk) for chunk in chunks[:-1]] == [CHUNK_SIZE] * (len(chunks) - 1)
        assert 0 < len(chunks[-1]) <= CHUNK_SIZE

    def test_no_argv_element_reaches_the_single_argument_cap(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT))))

        for call in channel.calls:
            for argument in call.command:
                assert len(argument.encode()) < MAX_ARG_STRLEN - 1

    def test_the_chunks_reassemble_into_the_tar_of_the_source(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
            extracted = archive.extractfile("dst.txt")
            assert extracted is not None
            assert extracted.read() == b"hello\n"

    def test_no_push_exec_opens_stdin(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT))))

        assert [call.stdin for call in channel.calls] == [None] * BIG_PUSH_EXECS

    def test_the_push_runs_no_preflight_probe(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert [call.command[0] for call in channel.calls] == ["mkdir", "sh", "sh"]

    def test_every_push_exec_carries_the_output_ceiling(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert [call.max_output_bytes for call in channel.calls] == [PUSH_OUTPUT_CEILING] * 3

    def test_every_push_exec_carries_the_same_pod_container_and_timeout(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)

        _run(channel, _push_params(str(_source_file(tmp_path, BIG_CONTENT)), timeout=45))

        for call in channel.calls:
            assert (call.pod, call.container, call.timeout) == (POD, CONTAINER, 45)

    def test_impersonation_reaches_every_push_exec(self, tmp_path: Any) -> None:
        channel = _push_channel(BIG_PUSH_EXECS)
        params = _push_params(
            str(_source_file(tmp_path, BIG_CONTENT)),
            impersonate_user="qa-bot",
            impersonate_groups="dev, ops",
        )

        _run(channel, params)

        for call in channel.calls:
            assert call.impersonate_user == "qa-bot"
            assert call.impersonate_groups == ["dev", "ops"]

    def test_an_empty_source_directory_still_stages_and_extracts(self, tmp_path: Any) -> None:
        empty = tmp_path / "empty"
        empty.mkdir()
        channel = _push_channel()

        outputs = _outputs(channel, _push_params(str(empty), target_path=POD_DEST_TREE))

        assert len(channel.calls) == SMALL_PUSH_EXECS
        assert _rows(outputs) == []


class TestPushArchive:
    """The tar the pod untars is named for the target, GNU format, files only."""

    def test_the_member_is_named_for_the_target_basename(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert _pushed_names(channel) == ["dst.txt"]

    def test_a_pushed_directory_keeps_its_tree_under_the_target_name(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_tree(tmp_path)), target_path=POD_DEST_TREE))

        assert _pushed_names(channel) == ["data/a.txt", "data/sub/b.txt"]

    def test_only_regular_files_are_packed(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_tree(tmp_path)), target_path=POD_DEST_TREE))

        with tarfile.open(fileobj=io.BytesIO(_pushed_tar(channel))) as archive:
            assert [member.isfile() for member in archive.getmembers()] == [True, True]

    def test_a_long_member_name_rides_the_gnu_long_link_header(self, tmp_path: Any) -> None:
        tree = tmp_path / "data"
        deep = tree / ("d" * 60) / ("e" * 60)
        deep.mkdir(parents=True)
        (deep / "a.txt").write_bytes(b"A")
        channel = _push_channel()

        _run(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert b"././@LongLink" in _pushed_tar(channel)


class TestPushExtractExec:
    """One exec decodes, untars into the target directory and removes the staging directory."""

    def test_the_extract_script_is_the_pinned_string(self) -> None:
        assert cp._EXTRACT_SCRIPT == EXTRACT_SCRIPT

    def test_the_no_preserve_extract_script_is_the_pinned_string(self) -> None:
        assert cp._EXTRACT_SCRIPT_NO_PRESERVE == EXTRACT_SCRIPT_NO_PRESERVE

    def test_the_final_exec_is_the_seven_element_extract_argv(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path))))

        assert _final(channel).command == [
            "sh",
            "-c",
            EXTRACT_SCRIPT,
            "sh",
            _scratch(channel),
            POD_DEST_DIR,
            _stage(channel),
        ]

    def test_the_extract_exec_is_handed_the_directory_the_target_sits_in(
        self, tmp_path: Any
    ) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_tree(tmp_path)), target_path=POD_DEST_TREE))

        assert _final(channel).command[5] == POD_DEST_DIR

    def test_no_preserve_selects_kubectls_two_extract_flags(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), no_preserve=True))

        assert _final(channel).command[2] == EXTRACT_SCRIPT_NO_PRESERVE

    def test_no_preserve_unticked_leaves_the_plain_extract(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), no_preserve=False))

        assert _final(channel).command[2] == EXTRACT_SCRIPT

    def test_an_absent_no_preserve_leaves_the_plain_extract(self, tmp_path: Any) -> None:
        params = _push_params(str(_source_file(tmp_path)))
        channel = _push_channel()

        assert "no_preserve" not in params
        _run(channel, params)

        assert _final(channel).command[2] == EXTRACT_SCRIPT

    def test_any_truthy_no_preserve_selects_the_no_preserve_script(self, tmp_path: Any) -> None:
        channel = _push_channel()

        _run(channel, _push_params(str(_source_file(tmp_path)), no_preserve="yes"))

        assert _final(channel).command[2] == EXTRACT_SCRIPT_NO_PRESERVE


UMLAUT_NAME = "Grüße.txt"
POD_UMLAUT_FILE = f"/srv/work/{UMLAUT_NAME}"


def _pod_tar(members: list[tuple[str, bytes]]) -> bytes:
    """A tar as GNU tar writes it in a pod: each name sits in its own header as UTF-8 bytes."""
    buffer = io.BytesIO()
    with tarfile.open(
        fileobj=buffer, mode="w", format=tarfile.GNU_FORMAT, encoding="utf-8"
    ) as archive:
        for name, content in members:
            archive.addfile(_member(name, content), io.BytesIO(content))
    return buffer.getvalue()


def _tar_opens(
    fake: FakeExecStdout | FakeExecChannel, params: dict[str, Any]
) -> list[dict[str, Any]]:
    """The keyword arguments of each tarfile.open the verb makes during one run."""
    with patch.object(tarfile, "open", wraps=tarfile.open) as opened:
        _run(fake, params)
    return [call.kwargs for call in opened.call_args_list]


def _pushed_names_as_utf8(channel: FakeExecChannel) -> list[str]:
    """The pushed member names read strictly as UTF-8, the bytes a pod's tar finds."""
    pushed = io.BytesIO(_pushed_tar(channel))
    with tarfile.open(fileobj=pushed, encoding="utf-8", errors="strict") as archive:
        return archive.getnames()


@pytest.fixture
def host_file_names_are_ascii(monkeypatch: pytest.MonkeyPatch) -> None:
    """tarfile's default name encoding, as a host whose file-name encoding is ASCII has it."""
    monkeypatch.setattr(tarfile.TarFile, "encoding", "ascii")


class TestMemberNamesAreUTF8:
    """REQ-4.6.9: archive member names are UTF-8 both ways, whatever the host's own encoding."""

    def test_the_pull_reads_the_archive_with_utf8_names(self, tmp_path: Any) -> None:
        opens = _tar_opens(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert [settings.get("encoding") for settings in opens] == ["utf-8"]

    def test_the_push_writes_the_archive_with_utf8_names(self, tmp_path: Any) -> None:
        opens = _tar_opens(_push_channel(), _push_params(str(_source_file(tmp_path))))

        assert [settings.get("encoding") for settings in opens] == ["utf-8"]

    def test_a_pulled_tree_lands_a_file_under_its_own_name(
        self, tmp_path: Any, host_file_names_are_ascii: None
    ) -> None:
        stream = _pull_stream(_pod_tar([(f"srv/work/data/{UMLAUT_NAME}", b"hello\n")]))
        target = tmp_path / "out"

        outputs = _outputs(stream, _pull_params(str(target), source_path=POD_DIR))

        assert _rows(outputs) == [[f"{POD_DIR}/{UMLAUT_NAME}", str(target / UMLAUT_NAME), 6]]
        assert (target / UMLAUT_NAME).read_bytes() == b"hello\n"

    def test_a_pulled_file_lands_at_the_target_path(
        self, tmp_path: Any, host_file_names_are_ascii: None
    ) -> None:
        stream = _pull_stream(_pod_tar([(POD_UMLAUT_FILE.lstrip("/"), b"hello\n")]))
        target = tmp_path / UMLAUT_NAME

        outputs = _outputs(stream, _pull_params(str(target), source_path=POD_UMLAUT_FILE))

        assert _rows(outputs) == [[POD_UMLAUT_FILE, str(target), 6]]
        assert target.read_bytes() == b"hello\n"

    def test_a_pushed_tree_carries_a_file_under_its_own_name(
        self, tmp_path: Any, host_file_names_are_ascii: None
    ) -> None:
        tree = tmp_path / "data"
        tree.mkdir()
        (tree / UMLAUT_NAME).write_bytes(b"hello\n")
        channel = _push_channel()

        outputs = _outputs(channel, _push_params(str(tree), target_path=POD_DEST_TREE))

        assert _pushed_names_as_utf8(channel) == [f"data/{UMLAUT_NAME}"]
        assert _rows(outputs) == [[str(tree / UMLAUT_NAME), f"{POD_DEST_TREE}/{UMLAUT_NAME}", 6]]

    def test_a_pushed_file_is_named_for_its_target(
        self, tmp_path: Any, host_file_names_are_ascii: None
    ) -> None:
        channel = _push_channel()
        params = _push_params(str(_source_file(tmp_path)), target_path=POD_UMLAUT_FILE)

        _run(channel, params)

        assert _pushed_names_as_utf8(channel) == [UMLAUT_NAME]


class TestSummaryTable:
    """Summary is a three-column table envelope, one row per file, direction-neutral."""

    def test_summary_is_a_table_envelope(self, tmp_path: Any) -> None:
        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert outputs["summary"]["__wave_type"] == "table"
        assert set(outputs["summary"]) == {"__wave_type", "columns", "rows"}

    def test_the_columns_are_the_three_pinned_names_and_types(self, tmp_path: Any) -> None:
        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert outputs["summary"]["columns"] == SUMMARY_COLUMNS

    def test_a_single_file_pull_is_one_row(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"

        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(target)))

        assert _rows(outputs) == [[POD_FILE, str(target), 6]]

    def test_a_pulled_directory_is_one_row_per_file(self, tmp_path: Any) -> None:
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

        outputs = _outputs(stream, _pull_params(str(target), source_path=POD_DIR))

        assert _rows(outputs) == [
            [f"{POD_DIR}/a.txt", str(target / "a.txt"), 1],
            [f"{POD_DIR}/sub/b.txt", str(target / "sub" / "b.txt"), 2],
        ]

    def test_the_rows_of_a_streamed_pull_follow_the_stream_order(self, tmp_path: Any) -> None:
        target = tmp_path / "out"

        outputs = _outputs(
            _pull_stream(_tar(THREE_FILES), chunk_size=512),
            _pull_params(str(target), source_path=POD_DIR),
        )

        assert _rows(outputs) == [
            [f"{POD_DIR}/a.txt", str(target / "a.txt"), 1],
            [f"{POD_DIR}/sub/b.txt", str(target / "sub" / "b.txt"), 2],
            [f"{POD_DIR}/sub/c.txt", str(target / "sub" / "c.txt"), 3],
        ]

    def test_the_pull_size_cell_is_the_size_the_tar_header_carries(self, tmp_path: Any) -> None:
        target = tmp_path / "out.bin"

        outputs = _outputs(_pull_stream(_one_file_tar(EVERY_BYTE)), _pull_params(str(target)))

        assert _rows(outputs) == [[POD_FILE, str(target), len(EVERY_BYTE)]]

    def test_a_single_file_push_is_one_row(self, tmp_path: Any) -> None:
        source = _source_file(tmp_path)

        outputs = _outputs(_push_channel(), _push_params(str(source)))

        assert _rows(outputs) == [[str(source), POD_DEST_FILE, 6]]

    def test_a_pushed_directory_is_one_row_per_file(self, tmp_path: Any) -> None:
        tree = _source_tree(tmp_path)

        outputs = _outputs(_push_channel(), _push_params(str(tree), target_path=POD_DEST_TREE))

        assert _rows(outputs) == [
            [str(tree / "a.txt"), f"{POD_DEST_TREE}/a.txt", 1],
            [str(tree / "sub" / "b.txt"), f"{POD_DEST_TREE}/sub/b.txt", 2],
        ]

    def test_the_push_size_cell_is_the_file_on_the_wave_disk(self, tmp_path: Any) -> None:
        source = _source_file(tmp_path, RAW_BYTES)
        channel = _push_channel()

        outputs = _outputs(channel, _push_params(str(source)))

        assert _rows(outputs) == [[str(source), POD_DEST_FILE, source.stat().st_size]]
        assert _rows(outputs)[0][2] != len(_pushed_tar(channel))

    def test_the_columns_read_the_same_in_both_directions(self, tmp_path: Any) -> None:
        pushed = _outputs(_push_channel(), _push_params(str(_source_file(tmp_path))))
        pulled = _outputs(_pull_stream(_one_file_tar()), _pull_params(str(tmp_path / "out.txt")))

        assert pushed["summary"]["columns"] == pulled["summary"]["columns"]

    def test_a_recorded_failure_keeps_the_columns_and_no_rows(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["summary"] == EMPTY_SUMMARY


class TestFailureDispatch:
    """A recordable failure fires on the literal string 'record' and on nothing else."""

    def test_fail_mode_raises_out_of_the_verb(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))
        params = _pull_params(str(tmp_path / "out.txt"), on_error="fail")

        with pytest.raises(ValueError, match=exact(_pull_message(NOT_FOUND_DETAIL))):
            _run(stream, params)

    def test_an_absent_on_error_raises(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))
        params = _pull_params(str(tmp_path / "out.txt"))

        assert "on_error" not in params
        with pytest.raises(ValueError, match=exact(_pull_message("denied"))):
            _run(stream, params)

    @pytest.mark.parametrize("on_error", ["Record", "RECORD", True, None])
    def test_anything_but_the_literal_record_raises(self, on_error: Any, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))
        params = _pull_params(str(tmp_path / "out.txt"), on_error=on_error)

        with pytest.raises(ValueError, match=exact(_pull_message("denied"))):
            _run(stream, params)

    def test_record_mode_returns_the_failed_core(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["success"] is False
        assert outputs["error"] == _pull_message(NOT_FOUND_DETAIL)
        assert outputs["reason"] == "NotFound"

    def test_a_recorded_failure_carries_the_warning_signal(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["__block_warning"] is True

    def test_a_recorded_failure_returns_the_declared_outputs_plus_the_signal(
        self, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert set(outputs) == {"summary", "success", "error", "reason", "__block_warning"}

    def test_a_success_carries_no_warning_signal(self, tmp_path: Any) -> None:
        params = _pull_params(str(tmp_path / "out.txt"), on_error="record")

        outputs = _outputs(_pull_stream(_one_file_tar()), params)

        assert "__block_warning" not in outputs

    def test_a_recorded_failure_carries_no_secrets_and_survives_a_json_round_trip(
        self, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))

        envelope = _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert envelope["secrets"] == []
        assert json.loads(json.dumps(envelope)) == envelope


class TestFailureMessages:
    """Every recordable detail reads as a copy out of, or into, the pod the row names."""

    def test_a_refusal_on_the_pull_reads_as_a_copy_out(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))

        with pytest.raises(ValueError, match=exact(_pull_message(NOT_FOUND_DETAIL))):
            _run(stream, _pull_params(str(tmp_path / "out.txt")))

    def test_a_refusal_on_the_push_reads_as_a_copy_in(self, tmp_path: Any) -> None:
        channel = FakeExecChannel([ExecRejected(NOT_FOUND_DETAIL, "NotFound")])

        with pytest.raises(ValueError, match=exact(_push_message(NOT_FOUND_DETAIL))):
            _run(channel, _push_params(str(_source_file(tmp_path))))

    def test_a_refusal_on_the_final_push_exec_still_reads_as_a_copy_in(self, tmp_path: Any) -> None:
        detail = "container not found"
        channel = FakeExecChannel([("", "", 0), ("", "", 0), ExecRejected(detail, "BadRequest")])

        with pytest.raises(ValueError, match=exact(_push_message(detail))):
            _run(channel, _push_params(str(_source_file(tmp_path))))

    def test_the_pull_message_names_the_container_the_row_selected(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))
        params = _pull_params(str(tmp_path / "out.txt"), container="sidecar")

        with pytest.raises(
            ValueError, match=exact(_pull_message(NOT_FOUND_DETAIL, container="sidecar"))
        ):
            _run(stream, params)

    def test_the_push_message_names_the_container_the_row_selected(self, tmp_path: Any) -> None:
        channel = FakeExecChannel([ExecRejected("denied", "Forbidden")])
        params = _push_params(str(_source_file(tmp_path)), container="sidecar")

        with pytest.raises(ValueError, match=exact(_push_message("denied", container="sidecar"))):
            _run(channel, params)

    def test_a_denied_exec_records_the_cluster_reason_verbatim(self, tmp_path: Any) -> None:
        detail = 'User "wave" cannot create resource "pods/exec"'
        stream = FakeExecStdout(open_error=ExecRejected(detail, "Forbidden"))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["error"] == _pull_message(detail)
        assert outputs["reason"] == "Forbidden"

    def test_a_refusal_without_a_reason_records_an_empty_reason(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", None))

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["error"] == _pull_message("denied")
        assert outputs["reason"] == ""

    def test_a_non_zero_tar_exit_on_the_pull_carries_the_stderr(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/src.txt: No such file or directory"
        stream = _pull_stream(b"", stderr=stderr, exit_code=1)

        with pytest.raises(ValueError, match=exact(_pull_message(stderr))):
            _run(stream, _pull_params(str(tmp_path / "out.txt")))

    def test_a_non_zero_exit_records_the_non_zero_exit_reason(self, tmp_path: Any) -> None:
        stderr = "tar: /srv/work/src.txt: No such file or directory"
        stream = _pull_stream(b"", stderr=stderr, exit_code=1)

        outputs = _outputs(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"))

        assert outputs["error"] == _pull_message(stderr)
        assert outputs["reason"] == NON_ZERO_REASON

    def test_a_non_zero_exit_on_the_final_push_exec_carries_the_stderr(self, tmp_path: Any) -> None:
        stderr = "tar: can't create directory: Permission denied"
        channel = FakeExecChannel([("", "", 0), ("", "", 0), ("", stderr, 2)])

        with pytest.raises(ValueError, match=exact(_push_message(stderr))):
            _run(channel, _push_params(str(_source_file(tmp_path))))

    def test_a_non_zero_exit_with_no_stderr_ends_the_message_in_a_colon(
        self, tmp_path: Any
    ) -> None:
        stream = _pull_stream(b"", exit_code=3)

        with pytest.raises(ValueError, match=exact(_pull_message(""))):
            _run(stream, _pull_params(str(tmp_path / "out.txt")))


class TestAlwaysHardFail:
    """The carve-outs: a bad session, a transport failure and a timeout raise in both modes."""

    @_BOTH_MODES
    def test_a_bogus_session_raises(self, on_error: str, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())
        params = _pull_params(str(tmp_path / "out.txt"), on_error=on_error, session="nope")

        with pytest.raises(ValueError, match=exact(SESSION_MESSAGE)):
            _run(stream, params)

        assert stream.calls == []

    @_BOTH_MODES
    def test_a_missing_session_raises(self, on_error: str, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())
        params = _pull_params(str(tmp_path / "out.txt"), on_error=on_error)
        del params["session"]

        with pytest.raises(ValueError, match=exact(SESSION_MESSAGE)):
            _run(stream, params)

    @_BOTH_MODES
    def test_a_transport_failure_on_the_pull_raises(self, on_error: str, tmp_path: Any) -> None:
        detail = "[Errno 111] Connection refused"
        stream = FakeExecStdout(open_error=ExecTransportError(detail))

        with pytest.raises(ValueError, match=exact(_pull_message(detail))):
            _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error=on_error))

    @_BOTH_MODES
    def test_a_transport_failure_on_the_push_raises(self, on_error: str, tmp_path: Any) -> None:
        detail = "TLS handshake failed: self-signed certificate"
        channel = FakeExecChannel([ExecTransportError(detail)])

        with pytest.raises(ValueError, match=exact(_push_message(detail))):
            _run(channel, _push_params(str(_source_file(tmp_path)), on_error=on_error))

    @_BOTH_MODES
    def test_a_transport_failure_records_nothing(self, on_error: str, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecTransportError("socket closed"))
        log = RecordingLog()

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error=on_error), log)

        assert log.entries == []

    @_BOTH_MODES
    def test_a_timeout_raises_the_default_timeout_message(
        self, on_error: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))

        with pytest.raises(ValueError, match=exact("File copy timed out after 60 seconds")):
            _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error=on_error))

    @_BOTH_MODES
    def test_the_timeout_message_names_the_configured_timeout(
        self, on_error: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))
        params = _pull_params(str(tmp_path / "out.txt"), on_error=on_error, timeout=45)

        with pytest.raises(ValueError, match=exact("File copy timed out after 45 seconds")):
            _run(stream, params)

    @_BOTH_MODES
    def test_a_timeout_while_reading_the_stream_raises_the_same_message(
        self, on_error: str, tmp_path: Any
    ) -> None:
        stream = _pull_stream(
            _later_tar(), read_error=ExecTimeout("timed out"), read_error_at=CUT_AT
        )
        params = _pull_params(
            str(tmp_path / "out"), source_path=POD_DIR, on_error=on_error, timeout=45
        )

        with pytest.raises(ValueError, match=exact("File copy timed out after 45 seconds")):
            _run(stream, params)

    @_BOTH_MODES
    def test_a_timeout_on_the_push_reads_the_same_way(self, on_error: str, tmp_path: Any) -> None:
        channel = FakeExecChannel([ExecTimeout("deadline exceeded")])

        with pytest.raises(ValueError, match=exact("File copy timed out after 60 seconds")):
            _run(channel, _push_params(str(_source_file(tmp_path)), on_error=on_error))

    @_BOTH_MODES
    def test_a_timeout_is_never_nested_in_the_copy_message(
        self, on_error: str, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecTimeout("deadline exceeded"))

        with pytest.raises(ValueError) as caught:
            _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error=on_error))

        assert "Could not copy" not in str(caught.value)


class TestLogging:
    """The exact console lines, in order, through the log callable."""

    def test_a_happy_pull_logs_the_pod_path_then_the_local_path(self, tmp_path: Any) -> None:
        target = tmp_path / "out.txt"
        log = RecordingLog()

        _run(_pull_stream(_one_file_tar()), _pull_params(str(target)), log)

        assert log.entries == [("INFO", f"Copied {POD_FILE} to {target}")]

    def test_a_happy_push_logs_the_local_path_then_the_pod_path(self, tmp_path: Any) -> None:
        source = _source_file(tmp_path)
        log = RecordingLog()

        _run(_push_channel(), _push_params(str(source)), log)

        assert log.entries == [("INFO", f"Copied {source} to {POD_DEST_FILE}")]

    def test_a_directory_pull_still_logs_exactly_one_line(self, tmp_path: Any) -> None:
        stream = _pull_stream(
            _tar([("srv/work/data/a.txt", b"A"), ("srv/work/data/sub/b.txt", b"BB")])
        )
        log = RecordingLog()

        _run(stream, _pull_params(str(tmp_path / "out"), source_path=POD_DIR), log)

        assert len(log.entries) == 1

    def test_a_recorded_failure_logs_the_copy_shaped_warn_line(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected(NOT_FOUND_DETAIL, "NotFound"))
        log = RecordingLog()

        _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"), log)

        line = f"Copy failed (NotFound): {_pull_message(NOT_FOUND_DETAIL)}"
        assert log.entries == [("WARN", line)]

    def test_a_recorded_limit_refusal_logs_the_copy_shaped_warn_line(self, tmp_path: Any) -> None:
        params = _pull_params(
            str(tmp_path / "out"), source_path=POD_DIR, max_files=2, on_error="record"
        )
        log = RecordingLog()

        _run(_pull_stream(_tar(THREE_FILES)), params, log)

        line = f"Copy failed ({TOO_MANY_REASON}): {_pull_message(_over_files_detail(2))}"
        assert log.entries == [("WARN", line)]

    def test_a_recorded_failure_without_a_reason_drops_the_parenthesized_clause(
        self, tmp_path: Any
    ) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", None))
        log = RecordingLog()

        _run(stream, _pull_params(str(tmp_path / "out.txt"), on_error="record"), log)

        assert log.entries == [("WARN", f"Copy failed: {_pull_message('denied')}")]

    def test_fail_mode_logs_nothing_before_raising(self, tmp_path: Any) -> None:
        stream = FakeExecStdout(open_error=ExecRejected("denied", "Forbidden"))
        log = RecordingLog()

        with pytest.raises(ValueError):
            _run(stream, _pull_params(str(tmp_path / "out.txt")), log)

        assert log.entries == []


def _remote_host_refusal(scheme: str) -> str:
    return (
        f"{scheme} paths are not available on the remote host - "
        "use an absolute or relative path on the remote host"
    )


class TestWaveSideSchemesOnTheRemoteHost:
    """On the remote host no bridge resolves a scheme, so the verb refuses it before any exec."""

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_a_pull_into_a_scheme_target_is_refused(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        monkeypatch.chdir(tmp_path)
        stream = _pull_stream(_one_file_tar())

        with pytest.raises(ValueError, match=exact(_remote_host_refusal(scheme))):
            _run(stream, _pull_params(f"{scheme}pulled/dst.txt"))

        assert stream.calls == []
        assert list(tmp_path.iterdir()) == []

    @pytest.mark.parametrize("scheme", ["testdata://", "artifact://"])
    def test_a_push_from_a_scheme_source_is_refused(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch, scheme: str
    ) -> None:
        monkeypatch.chdir(tmp_path)
        channel = _push_channel()

        with pytest.raises(ValueError, match=exact(_remote_host_refusal(scheme))):
            _run(channel, _push_params(f"{scheme}a.txt"))

        assert channel.calls == []

    def test_the_refusal_ignores_on_error_record(self, tmp_path: Any) -> None:
        channel = _push_channel()

        with pytest.raises(ValueError, match=exact(_remote_host_refusal("testdata://"))):
            _run(channel, _push_params("testdata://a.txt", on_error="record"))

    def test_a_pod_side_path_is_never_read_as_a_scheme(self, tmp_path: Any) -> None:
        """Only the side on this machine is a local path; the pod side is the pod's business."""
        source = _source_file(tmp_path)
        channel = _push_channel()

        outputs = _outputs(channel, _push_params(str(source), target_path="testdata://x"))

        assert outputs["summary"]["rows"]

    def test_a_relative_push_source_is_read_from_the_starting_folder(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _source_file(tmp_path)
        monkeypatch.chdir(tmp_path)
        channel = _push_channel()

        outputs = _outputs(channel, _push_params("a.txt"))

        assert _rows(outputs) == [[str(tmp_path / "a.txt"), POD_DEST_FILE, len(b"hello\n")]]


class TestTheLocalSideIsNormalizedFirst:
    """On the remote host the local path is made absolute and its `..` collapsed, as on WAVE."""

    def test_a_push_source_through_a_missing_folder_is_read(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _source_file(tmp_path)
        monkeypatch.chdir(tmp_path)
        channel = _push_channel()

        outputs = _outputs(channel, _push_params("missing/../a.txt"))

        assert _rows(outputs) == [[str(tmp_path / "a.txt"), POD_DEST_FILE, len(b"hello\n")]]

    def test_a_pull_target_through_a_missing_folder_creates_no_stray_folder(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        log = RecordingLog()

        outputs = _outputs(_pull_stream(_one_file_tar()), _pull_params("made/../out.txt"), log)

        assert (tmp_path / "out.txt").read_bytes() == b"hello\n"
        assert sorted(entry.name for entry in tmp_path.iterdir()) == ["out.txt"]
        assert _rows(outputs) == [[POD_FILE, str(tmp_path / "out.txt"), len(b"hello\n")]]
        assert log.entries == [("INFO", f"Copied {POD_FILE} to {tmp_path / 'out.txt'}")]

    def test_the_pod_side_is_left_as_written(self, tmp_path: Any) -> None:
        stream = _pull_stream(_one_file_tar())

        _run(stream, _pull_params(str(tmp_path / "out.txt"), source_path="/srv/work/x/../src.txt"))

        assert stream.last.command == ["tar", "cf", "-", "/srv/work/x/../src.txt"]
