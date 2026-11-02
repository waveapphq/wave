"""
Shared plugin path resolution.

One resolver for every plugin that opens a file on WAVE: artifact:// from the
run's artifacts directory, testdata:// through an ordered search of the
configured test-data directories, and a plain path made absolute. A relative
plain path starts from the base a block with a working directory passes, and
otherwise from the home folder of the user the WAVE server runs as. A scheme
reference starts from its own folder, however many slashes follow the scheme,
and a `..` segment is followed wherever it leads. A write target is refused
wherever its real location lands inside the Test Data area: the Test Data
storage zone or a configured test data root. A target that is deleted or moved
away is refused when it is the run's artifacts folder itself.
"""

import fnmatch
import os
from pathlib import Path

from wavecore.api.services.storage_paths import get_testdata_storage_path

_SCHEME_ARTIFACT = "artifact://"
_SCHEME_TESTDATA = "testdata://"
_READ_ONLY_MESSAGE = (
    "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
)
_ARTIFACTS_FOLDER_MESSAGE = (
    "artifact:// is the run's artifacts folder and cannot be deleted or moved"
)


def home_folder() -> Path:
    """The home folder of the operating-system user the WAVE server runs as."""
    return Path.home()


def plain_path(path: str, base: str | None = None) -> Path:
    """A plain path made absolute with `..` collapsed; a relative one starts from base or home."""
    if not os.path.isabs(path):
        path = os.path.join(base or home_folder(), path)
    return Path(os.path.abspath(path))


def has_plugin_scheme(path: str) -> bool:
    """True when the reference names one of the plugin path schemes."""
    return path.startswith((_SCHEME_ARTIFACT, _SCHEME_TESTDATA))


def scheme_basename(path: str) -> str:
    """The file name a reference points at, with any scheme prefix removed."""
    for scheme in (_SCHEME_ARTIFACT, _SCHEME_TESTDATA):
        if path.startswith(scheme):
            path = path[len(scheme) :]
            break
    return os.path.basename(path)


def scheme_relative_path(path: str) -> str:
    """What a scheme reference names inside its folder; leading slashes never leave it."""
    return path.partition("://")[2].lstrip("/")


def _resolve_artifact(path: str, artifacts_dir: str | None, removes: bool) -> Path:
    if not artifacts_dir:
        raise ValueError(
            "artifact:// scheme requires artifacts directory, but none configured in context"
        )
    folder = Path(artifacts_dir).resolve()
    resolved = (folder / scheme_relative_path(path)).resolve()
    if removes and resolved == folder:
        raise ValueError(_ARTIFACTS_FOLDER_MESSAGE)
    return resolved


def _resolve_testdata(path: str, testdata_dirs: list[str] | None, read_only_ok: bool) -> Path:
    if not read_only_ok:
        raise ValueError(_READ_ONLY_MESSAGE)
    if not testdata_dirs:
        raise ValueError(
            "testdata:// scheme requires test data directories, but none configured in context"
        )
    relative = scheme_relative_path(path)
    for directory in testdata_dirs:
        candidate = (Path(directory).resolve() / relative).resolve()
        if candidate.exists():
            return candidate
    searched = [os.path.join(directory, relative) for directory in testdata_dirs]
    raise FileNotFoundError(
        f"testdata file not found: {path}\nSearched paths: {', '.join(searched)}"
    )


def _refuse_testdata_target(resolved: Path, testdata_dirs: list[str] | None) -> None:
    """A write target may not land in the Test Data area, whatever form the reference took."""
    real = resolved.resolve()
    roots = [get_testdata_storage_path(), *(Path(directory) for directory in testdata_dirs or [])]
    if any(real.is_relative_to(root.resolve()) for root in roots):
        raise ValueError(_READ_ONLY_MESSAGE)


def resolve_plugin_path(
    path: str,
    artifacts_dir: str | None,
    testdata_dirs: list[str] | None,
    *,
    read_only_ok: bool,
    removes: bool = False,
    base: str | None = None,
) -> Path:
    """Resolve a plugin file reference to an absolute path.

    Existence is checked only for testdata://, whose ordered search is defined
    by which candidate exists; the caller owns the "not found" message for the
    other forms. The write flavor (``read_only_ok=False``) refuses any target in
    the Test Data area; the removal flavor (``removes=True``), for a target that
    is deleted or moved away, also refuses the run's artifacts folder itself.
    ``base`` is where a relative plain path starts; without it, the home folder.
    """
    if path.startswith(_SCHEME_ARTIFACT):
        resolved = _resolve_artifact(path, artifacts_dir, removes)
    elif path.startswith(_SCHEME_TESTDATA):
        resolved = _resolve_testdata(path, testdata_dirs, read_only_ok)
    else:
        resolved = plain_path(path, base)
    if not read_only_ok:
        _refuse_testdata_target(resolved, testdata_dirs)
    return resolved


def has_wildcard(text: str) -> bool:
    return any(character in text for character in "*?[")


def name_matches(name: str, pattern: str) -> bool:
    """One name against one pattern; a dot name needs a pattern that starts with a dot."""
    if name.startswith(".") and not pattern.startswith("."):
        return False
    return fnmatch.fnmatchcase(name, pattern)


def _matching(folders: list[Path], pattern: str) -> list[Path]:
    return [
        entry
        for folder in folders
        for entry in folder.iterdir()
        if name_matches(entry.name, pattern)
    ]


def resolve_plugin_matches(
    pattern: str, artifacts_dir: str | None, testdata_dirs: list[str] | None
) -> list[Path]:
    """Every existing WAVE path a wildcard reference names, sorted."""
    segments = pattern.split("/")
    first = next(index for index, segment in enumerate(segments) if has_wildcard(segment))
    tail = segments[first:]
    fixed = pattern[: len(pattern) - len("/".join(tail))]
    try:
        folder = resolve_plugin_path(fixed, artifacts_dir, testdata_dirs, read_only_ok=True)
    except FileNotFoundError:
        return []
    folders = [folder] if folder.is_dir() else []
    for segment in tail[:-1]:
        # Links are not followed from one wildcard segment into the next.
        folders = [
            entry
            for entry in _matching(folders, segment)
            if entry.is_dir() and not entry.is_symlink()
        ]
    return sorted(_matching(folders, tail[-1]))
