"""The K8s Copy verb (REQ-5.1.1, REQ-3.4.1.5).

Copies a file or a directory between a pod and the WAVE side over the same exec
channel K8s Exec uses, the way kubectl cp does. Pulling runs `tar cf -` in the
pod and writes each vetted file out under the target as the stream brings it,
stopping, removing what it wrote and putting back any file it replaced once
Max size (MiB) or Max files is crossed (K8SEXEC-10); pushing builds the tar
here, base64-encodes it, appends it one argument at a time to a scratch file in
a staging directory it creates beside the target, then runs one exec that
decodes it, untars it and removes the staging directory. Standard input is
never opened in either direction. On WAVE the caller resolves any WAVE-side
scheme before run is called; on the remote host no one does, so a scheme on the
local side is refused before any exec and a plain local path is made absolute
with its `..` collapsed, as WAVE does. The only unique output is Summary, one
row per file; Error and Reason are gated on Record and continue.
"""

import base64
import io
import posixpath
import secrets
import shutil
import tarfile
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, cast

from wavecore.connectivity.block_outputs import block_failure, block_success, summary_table

from .. import ws
from ..rest import seconds
from ..ws import ExecOutputTooLarge, ExecRejected, ExecTimeout, ExecTransportError
from ._resources import PodExec, client_options, pod_exec

TIMEOUT_DEFAULT = 60
MAX_SIZE_MIB_DEFAULT = 256
MAX_FILES_DEFAULT = 10_000
_ACTION = "Copy"
_NON_ZERO_REASON = "NonZeroExitCode"

_MIB = 1_048_576
_PUSH_OUTPUT_CEILING = MAX_SIZE_MIB_DEFAULT * _MIB
_OUTPUT_TOO_LARGE_REASON = "OutputTooLarge"
_TOO_LARGE_REASON = "ArchiveTooLarge"
_TOO_MANY_REASON = "ArchiveTooManyEntries"
_OVER_SIZE_DETAIL = (
    "the copy is larger than the {max_size_mib} MiB Max size (MiB) allows; "
    "copy a narrower path or raise Max size (MiB)"
)
_OVER_FILES_DETAIL = (
    "the copy holds more files than the {max_files} Max files allows; "
    "copy fewer files or raise Max files"
)

# One argv element per chunk, four times under the kernel's 131,071-byte cap on a single argument.
_CHUNK_SIZE = 32_768
_APPEND_SCRIPT = 'printf %s "$1" >> "$2"'
_EXTRACT_SCRIPT = 'base64 -d "$1" | tar -xmf - -C "$2"; rc=$?; rm -rf "$3"; exit $rc'
_EXTRACT_SCRIPT_NO_PRESERVE = (
    'base64 -d "$1" | tar --no-same-permissions --no-same-owner -xmf - -C "$2"; '
    'rc=$?; rm -rf "$3"; exit $rc'
)
_STAGE_PREFIX = "wave-cp-"
_SCRATCH_NAME = "payload.b64"

_SUMMARY_COLUMNS: list[tuple[str, str]] = [
    ("SOURCE", "string"),
    ("TARGET", "string"),
    ("SIZE", "integer"),
]


class _CopyRefused(Exception):
    """A cluster refusal or a non-zero exit that the on_error dispatch can record."""

    def __init__(self, detail: str, reason: str | None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.reason = reason


@dataclass(frozen=True)
class _Limits:
    """How much one pull may write; 0 means no limit."""

    max_size_mib: int
    max_files: int


@dataclass
class _Landing:
    """What one pull wrote and what it replaced, so a failed pull can put it all back."""

    files: set[Path] = field(default_factory=set)
    folders: list[Path] = field(default_factory=list)
    kept: list[tuple[Path, Path]] = field(default_factory=list)

    def land(self, archive: tarfile.TarFile, member: tarfile.TarInfo, landed: Path) -> None:
        """Write the member's bytes only: its header mode and ownership never reach the disk."""
        missing: list[Path] = []
        folder = landed.parent
        while not folder.exists():
            missing.append(folder)
            folder = folder.parent
        for folder in reversed(missing):
            folder.mkdir()
            self.folders.append(folder)
        if landed not in self.files and landed.is_file():
            # A rename in the same folder, so putting it back is atomic and keeps content and mode.
            aside = landed.with_name(f".{landed.name}.{secrets.token_hex(4)}.keep")
            landed.replace(aside)
            self.kept.append((landed, aside))
        # extractfile answers None only for a member that is not a regular file; none is sent here.
        stream = cast(IO[bytes], archive.extractfile(member))
        with stream, landed.open("wb") as handle:
            # Recorded before its bytes, so a stream cut mid-file takes the partial file too.
            self.files.add(landed)
            shutil.copyfileobj(stream, handle)

    def undo(self) -> None:
        """Remove every file this pull wrote, put back each one it replaced, drop empty folders."""
        for landed in self.files:
            with suppress(OSError):
                landed.unlink()
        for landed, aside in self.kept:
            with suppress(OSError):
                aside.replace(landed)
        for folder in sorted(self.folders, key=lambda path: len(path.parts), reverse=True):
            with suppress(OSError):
                folder.rmdir()

    def commit(self) -> None:
        """Drop the files this pull replaced, once it has finished cleanly."""
        for _landed, aside in self.kept:
            with suppress(OSError):
                aside.unlink()


@dataclass(frozen=True)
class _Plan:
    """Everything one copy needs to reach the pod, plus which way it is going."""

    target: PodExec
    options: dict[str, Any]
    pulling: bool


def _empty_outputs() -> dict[str, Any]:
    return {"summary": summary_table(_SUMMARY_COLUMNS, [])}


def _result(outputs: dict[str, Any]) -> dict[str, Any]:
    """The result envelope; Copy carries no Secret data, so secrets is always empty."""
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _plan(params: dict[str, Any]) -> _Plan:
    return _Plan(
        target=pod_exec(params, TIMEOUT_DEFAULT),
        options=client_options(params),
        pulling=params.get("direction", "from_pod") == "from_pod",
    )


def _setting(params: dict[str, Any], name: str, default: int) -> int:
    value = params.get(name)
    return default if value is None or value == "" else int(value)


def _limits(params: dict[str, Any]) -> _Limits:
    """Each limit row as given, or the verb's own default when it is unset."""
    return _Limits(
        max_size_mib=_setting(params, "max_size_mib", MAX_SIZE_MIB_DEFAULT),
        max_files=_setting(params, "max_files", MAX_FILES_DEFAULT),
    )


def _copy_message(plan: _Plan, detail: str) -> str:
    way = "from" if plan.pulling else "to"
    return f"Could not copy {way} {plan.target.where()}: {detail}"


def _joined(base: str, relative: str) -> str:
    return posixpath.join(base, relative) if relative else base


def _contained(tail: str) -> str:
    """A member path is rooted before it is normalized, so no '..' can survive it."""
    return posixpath.normpath(posixpath.join("/", tail)).lstrip("/")


def _exec(plan: _Plan, command: list[str]) -> None:
    """One push exec; a refusal, an output over the ceiling or a non-zero exit is recordable."""
    try:
        _stdout, stderr, code = ws.exec_in_pod(
            plan.target.context,
            plan.target.namespace,
            plan.target.pod,
            plan.target.container,
            command,
            None,
            plan.target.timeout,
            max_output_bytes=_PUSH_OUTPUT_CEILING,
            **plan.options,
        )
    except ExecRejected as exc:
        raise _CopyRefused(exc.message, exc.reason) from exc
    except ExecOutputTooLarge as exc:
        raise _CopyRefused(str(exc), _OUTPUT_TOO_LARGE_REASON) from exc
    if code:
        raise _CopyRefused(stderr, _NON_ZERO_REASON)


def _judged(outcome: tuple[str, int]) -> None:
    """A non-zero exit fails the pull with the pod's standard error."""
    stderr, code = outcome
    if code:
        raise _CopyRefused(stderr, _NON_ZERO_REASON)


def _landed(
    stdout: ws.ExecStdout, source: str, target: Path, limits: _Limits, landing: _Landing
) -> list[list[Any]]:
    """Land each regular file of the tar as it arrives, one Summary row per file."""
    prefix = source.lstrip("/")
    rows: list[list[Any]] = []
    total = 0
    with tarfile.open(fileobj=cast(IO[bytes], stdout), mode="r|", encoding="utf-8") as archive:
        for member in archive:
            if not member.isfile():
                continue
            if limits.max_files and len(rows) >= limits.max_files:
                detail = _OVER_FILES_DETAIL.format(max_files=limits.max_files)
                raise _CopyRefused(detail, _TOO_MANY_REASON)
            total += member.size
            if limits.max_size_mib and total > limits.max_size_mib * _MIB:
                detail = _OVER_SIZE_DETAIL.format(max_size_mib=limits.max_size_mib)
                raise _CopyRefused(detail, _TOO_LARGE_REASON)
            relative = _contained(member.name[len(prefix) :])
            landed = target / relative if relative else target
            landing.land(archive, member, landed)
            rows.append([_joined(source, relative), str(landed), member.size])
    return rows


def _streamed(
    plan: _Plan, source: str, target: Path, limits: _Limits, landing: _Landing
) -> list[list[Any]]:
    """Tar the pod path to a stream, land it, then let the exit code judge the pull."""
    try:
        with ws.exec_stdout(
            plan.target.context,
            plan.target.namespace,
            plan.target.pod,
            plan.target.container,
            ["tar", "cf", "-", source],
            plan.target.timeout,
            **plan.options,
        ) as stdout:
            try:
                rows = _landed(stdout, source, target, limits, landing)
            except tarfile.ReadError:
                _judged(stdout.finish())
                raise
            _judged(stdout.finish())
    except ExecRejected as exc:
        raise _CopyRefused(exc.message, exc.reason) from exc
    return rows


def _pull(plan: _Plan, source: str, target: Path, limits: _Limits) -> list[list[Any]]:
    """A streamed pull that puts the target back as it was when it fails in any way."""
    landing = _Landing()
    try:
        rows = _streamed(plan, source, target, limits, landing)
    except BaseException:
        landing.undo()
        raise
    landing.commit()
    return rows


def _entries(source: Path) -> list[tuple[Path, str]]:
    """Every file to send, with its path relative to the source root."""
    if source.is_dir():
        return [
            (path, path.relative_to(source).as_posix())
            for path in sorted(source.rglob("*"))
            if path.is_file()
        ]
    return [(source, "")]


def _pack(entries: list[tuple[Path, str]], target: str) -> bytes:
    """The tar the pod untars, named for the target so it lands where kubectl cp lands it."""
    root = posixpath.basename(target)
    buffer = io.BytesIO()
    with tarfile.open(
        fileobj=buffer, mode="w", format=tarfile.GNU_FORMAT, encoding="utf-8"
    ) as archive:
        for path, relative in entries:
            archive.add(str(path), arcname=_joined(root, relative), recursive=False)
    return buffer.getvalue()


def _push(plan: _Plan, source: Path, target: str, *, no_preserve: bool) -> list[list[Any]]:
    """Stage the base64 archive beside the target one argument at a time, then unpack it."""
    entries = _entries(source)
    payload = base64.b64encode(_pack(entries, target)).decode("ascii")
    into = posixpath.dirname(target)
    stage = posixpath.join(into, f"{_STAGE_PREFIX}{secrets.token_hex(8)}")
    scratch = posixpath.join(stage, _SCRATCH_NAME)
    # No -p: mkdir refuses a path anything already occupies, so nothing can be pre-placed there.
    _exec(plan, ["mkdir", stage])
    for start in range(0, len(payload), _CHUNK_SIZE):
        chunk = payload[start : start + _CHUNK_SIZE]
        _exec(plan, ["sh", "-c", _APPEND_SCRIPT, "sh", chunk, scratch])
    script = _EXTRACT_SCRIPT_NO_PRESERVE if no_preserve else _EXTRACT_SCRIPT
    _exec(plan, ["sh", "-c", script, "sh", scratch, into, stage])
    return [
        [str(path), _joined(target, relative), path.stat().st_size] for path, relative in entries
    ]


def run(params: dict[str, Any], log: Callable[[str, str], None]) -> dict[str, Any]:
    """Move the file the direction asks for and return one Summary row per file."""
    # Imported on use: a top-level plugins import cycles back here via K8s Copy.
    from wavecore.plugins._file_ops import local_path

    plan = _plan(params)
    source = str(params["source_path"]).strip()
    target = str(params["target_path"]).strip()
    if plan.pulling:
        target = local_path(target)
    else:
        source = local_path(source)
    try:
        if plan.pulling:
            rows = _pull(plan, source, Path(target), _limits(params))
        else:
            rows = _push(plan, Path(source), target, no_preserve=bool(params.get("no_preserve")))
    except ExecTimeout as exc:
        raise ValueError(f"File copy timed out after {seconds(plan.target.timeout)}") from exc
    except ExecTransportError as exc:
        raise ValueError(_copy_message(plan, str(exc))) from exc
    except _CopyRefused as exc:
        outputs = block_failure(
            params,
            _empty_outputs(),
            _copy_message(plan, exc.detail),
            exc.reason,
            log,
            action=_ACTION,
        )
        return _result(outputs)

    log("INFO", f"Copied {source} to {target}")
    return _result(block_success({"summary": summary_table(_SUMMARY_COLUMNS, rows)}))
