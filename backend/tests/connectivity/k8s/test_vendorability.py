"""The K8s connectivity package stays copyable into a remote bundle (REQ-3.4.1.5).

Every module under wavecore/connectivity/k8s/ is copied verbatim onto the remote
host, so each one may import the standard library, its own package, the
bundled TLS engine, the stdlib file core, WAVE's trust store with its run
log, the proxy core and the web address parser - nothing else, and nothing
newer than the interpreter floor the runner accepts, keyword arguments
included. The verb package carries the extra rule that it is synchronous and
never reaches back into WAVE's own runtime.
"""

import ast
from pathlib import Path

import pytest

from tests.core.remote_exec._vendorability import (
    FLOOR_NAME,
    PackageWalk,
    import_candidates,
    imported_names,
    matches,
    parses_at_the_floor,
    post_floor_names,
    resolved_module,
)
from wavecore.connectivity import k8s as k8s_package

_PACKAGE_ROOT = Path(str(k8s_package.__file__)).parent
_PACKAGE_NAME = k8s_package.__name__
_VERBS_PACKAGE = f"{_PACKAGE_NAME}.verbs"
_WAVECORE_ROOT = _PACKAGE_ROOT.parents[1]

_ALLOWED_WAVECORE_IMPORTS = {
    "wavecore.plugins.http_tls",
    "wavecore.plugins._file_ops",
    "wavecore.connectivity.tls_capabilities",
    "wavecore.connectivity.trust_store",
    "wavecore.connectivity.run_log",
    "wavecore.connectivity.proxy",
    "wavecore.connectivity.web_address",
}
_WALK = PackageWalk(_PACKAGE_NAME, _PACKAGE_ROOT, tuple(sorted(_ALLOWED_WAVECORE_IMPORTS)))

_FORBIDDEN_THIRD_PARTY = {"websocket", "websockets", "requests", "httpx", "urllib3"}

# Forbidden inside verbs/ by name, so a violation says which rule it broke.
# asyncio needs its own row: it is stdlib, so the allowed-import rule waves it through.
_FORBIDDEN_IN_VERBS = ("yaml", "pydantic", "asyncio", "wavecore.core", "wavecore.api")

_EXPECTED_MODULES = {
    _PACKAGE_NAME,
    f"{_PACKAGE_NAME}.rest",
    f"{_PACKAGE_NAME}.ws",
    _VERBS_PACKAGE,
    f"{_VERBS_PACKAGE}._context",
    f"{_VERBS_PACKAGE}._errors",
    f"{_VERBS_PACKAGE}._resources",
    f"{_VERBS_PACKAGE}._outputs",
    f"{_VERBS_PACKAGE}._manifest",
    f"{_VERBS_PACKAGE}.connect",
    f"{_VERBS_PACKAGE}.get",
    f"{_VERBS_PACKAGE}.events",
    f"{_VERBS_PACKAGE}.logs",
    f"{_VERBS_PACKAGE}.top",
    f"{_VERBS_PACKAGE}.apply",
    f"{_VERBS_PACKAGE}.delete",
    f"{_VERBS_PACKAGE}.scale",
    f"{_VERBS_PACKAGE}.rollout",
    f"{_VERBS_PACKAGE}.exec",
    f"{_VERBS_PACKAGE}.script",
    f"{_VERBS_PACKAGE}.cp",
}
_MINIMUM_MODULE_COUNT = len(_EXPECTED_MODULES)

_MODULES = _WALK.modules
_MODULE_NAMES = _WALK.names
_VERB_MODULES = [(dotted, path) for dotted, path in _MODULES if matches(dotted, _VERBS_PACKAGE)]
_VERB_MODULE_NAMES = [dotted for dotted, _path in _VERB_MODULES]

_BUNDLED_EXTRAS = [
    (dotted, _WAVECORE_ROOT.joinpath(*dotted.split(".")[1:]).with_suffix(".py"))
    for dotted in sorted(_ALLOWED_WAVECORE_IMPORTS)
]
_BUNDLED_MODULES = _MODULES + _BUNDLED_EXTRAS
_BUNDLED_MODULE_NAMES = [dotted for dotted, _path in _BUNDLED_MODULES]

# tarfile's extract filter arrived inside 3.10, so the floor probe cannot promise it.
_EXTRACT_METHODS = frozenset({"extract", "extractall"})


def _filtered_extract_calls(source: str) -> set[str]:
    """The tarfile extract calls one source makes with a filter keyword."""
    called: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in _EXTRACT_METHODS:
            continue
        if any(keyword.arg == "filter" for keyword in node.keywords):
            called.add(node.func.attr)
    return called


class TestTheWalkCoversTheWholePackage:
    """A walk that finds nothing would pass every rule below without reading a line."""

    def test_the_walk_finds_modules(self) -> None:
        assert _MODULE_NAMES

    def test_the_walk_finds_every_module_the_bundle_carries(self) -> None:
        assert _EXPECTED_MODULES <= set(_MODULE_NAMES)

    def test_the_walk_is_at_least_as_wide_as_the_known_package(self) -> None:
        assert len(_MODULE_NAMES) >= _MINIMUM_MODULE_COUNT

    def test_the_walk_reaches_the_verb_package(self) -> None:
        named = {f"{_VERBS_PACKAGE}.get", f"{_VERBS_PACKAGE}._outputs"}

        assert named <= set(_MODULE_NAMES)

    def test_the_verb_walk_is_not_empty(self) -> None:
        assert _VERB_MODULE_NAMES

    def test_the_walk_resolves_a_relative_import_to_its_absolute_name(self) -> None:
        node = ast.parse("from ..rest import K8sClient").body[0]
        assert isinstance(node, ast.ImportFrom)

        resolved = resolved_module(node, f"{_VERBS_PACKAGE}.get", Path("get.py"))

        assert resolved == f"{_PACKAGE_NAME}.rest"

    def test_the_walk_resolves_a_sibling_import_to_its_absolute_name(self) -> None:
        node = ast.parse("from ._errors import map_api_error").body[0]
        assert isinstance(node, ast.ImportFrom)

        resolved = resolved_module(node, f"{_VERBS_PACKAGE}.get", Path("get.py"))

        assert resolved == f"{_VERBS_PACKAGE}._errors"

    def test_a_package_init_resolves_its_own_level_one_imports(self) -> None:
        node = ast.parse("from . import get").body[0]
        assert isinstance(node, ast.ImportFrom)

        resolved = resolved_module(node, _VERBS_PACKAGE, Path("__init__.py"))

        assert resolved == _VERBS_PACKAGE


@pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_MODULE_NAMES)
class TestEveryModuleIsVendorable:
    """Stdlib, the package and the WAVE modules the bundle carries beside it. Nothing else."""

    def test_every_import_is_stdlib_or_an_allowed_wave_module(
        self, dotted: str, path: Path
    ) -> None:
        for names in import_candidates(dotted, path):
            assert _WALK.vendorable(names), f"{dotted} imports {sorted(names)}, not vendorable"

    def test_no_third_party_transport_library_is_imported(self, dotted: str, path: Path) -> None:
        roots = {next(iter(names)).split(".")[0] for names in import_candidates(dotted, path)}

        assert not roots & _FORBIDDEN_THIRD_PARTY

    def test_only_the_tls_engine_and_the_file_core_come_from_the_plugins_package(
        self, dotted: str, path: Path
    ) -> None:
        allowed = {"wavecore.plugins.http_tls", "wavecore.plugins._file_ops"}
        for names in import_candidates(dotted, path):
            if not any(matches(name, "wavecore.plugins") for name in names):
                continue
            assert names & allowed, f"{dotted} imports {sorted(names)}"


@pytest.mark.parametrize(("dotted", "path"), _VERB_MODULES, ids=_VERB_MODULE_NAMES)
@pytest.mark.parametrize("forbidden", _FORBIDDEN_IN_VERBS)
class TestTheVerbPackageIsSyncAndSelfContained:
    """The verbs are synchronous and never reach back into WAVE's own runtime."""

    def test_the_forbidden_import_is_absent(self, forbidden: str, dotted: str, path: Path) -> None:
        hits = {name for name in imported_names(dotted, path) if matches(name, forbidden)}

        assert not hits, f"{dotted} imports {sorted(hits)}"


class TestTheBundleWalkCoversTheVendoredExtras:
    """The floor rules read the vendored WAVE modules too: they are copied onto the same host."""

    def test_the_extras_are_the_wave_modules_the_package_may_import(self) -> None:
        assert {dotted for dotted, _path in _BUNDLED_EXTRAS} == _ALLOWED_WAVECORE_IMPORTS

    def test_every_extra_is_a_file_on_disk(self) -> None:
        missing = [dotted for dotted, path in _BUNDLED_EXTRAS if not path.is_file()]

        assert not missing

    def test_the_bundle_walk_is_the_package_walk_plus_the_extras(self) -> None:
        assert len(_BUNDLED_MODULES) == len(_MODULES) + len(_ALLOWED_WAVECORE_IMPORTS)


@pytest.mark.parametrize(("dotted", "path"), _BUNDLED_MODULES, ids=_BUNDLED_MODULE_NAMES)
class TestEveryBundledModuleRunsOnTheFloorInterpreter:
    """Syntax and stdlib alike: what ships must run on the oldest host the runner accepts."""

    def test_the_module_parses_at_the_remote_floor(self, dotted: str, path: Path) -> None:
        source = path.read_text()

        assert parses_at_the_floor(source), f"{dotted} needs syntax newer than {FLOOR_NAME}"

    def test_the_module_reads_no_stdlib_name_newer_than_the_floor(
        self, dotted: str, path: Path
    ) -> None:
        hits = post_floor_names(path.read_text())

        assert not hits, f"{dotted} reads {sorted(hits)}, absent from {FLOOR_NAME}"


@pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_MODULE_NAMES)
class TestNoExtractCallAsksForAFilter:
    """Unpacking writes each vetted member out itself, so no extract call needs a filter."""

    def test_no_tarfile_extract_call_carries_a_filter_keyword(
        self, dotted: str, path: Path
    ) -> None:
        hits = _filtered_extract_calls(path.read_text())

        assert not hits, f"{dotted} calls {sorted(hits)} with filter=, absent from {FLOOR_NAME}"


class TestTheExtractFilterGuardSeesAViolation:
    """A guard that cannot fail proves nothing, so it is run against sources that break it."""

    @pytest.mark.parametrize(
        "source, name",
        [
            ('archive.extractall(path=root, members=picked, filter="data")\n', "extractall"),
            ('tarfile.open(fileobj=stream).extractall(root, filter="data")\n', "extractall"),
            ('archive.extract(member, path=root, filter="tar")\n', "extract"),
            ("archive.extract(member, root, filter=chosen)\n", "extract"),
        ],
    )
    def test_an_extract_call_that_asks_for_a_filter_is_named(self, source: str, name: str) -> None:
        assert _filtered_extract_calls(source) == {name}

    @pytest.mark.parametrize(
        "source",
        [
            "archive.extractall(path=root, members=picked)\n",
            "archive.extract(member, path=root)\n",
            "handle = archive.extractfile(member)\n",
            'rows = select(values, filter="data")\n',
        ],
    )
    def test_source_the_rule_accepts_names_no_filtered_extract(self, source: str) -> None:
        assert _filtered_extract_calls(source) == set()


class TestTheFloorGuardSeesAViolation:
    """A guard that cannot fail proves nothing, so it is run against sources that break it."""

    @pytest.mark.parametrize(
        "source",
        [
            "type Names = list[str]\n",
            "def first[T](values: list[T]) -> T:\n    return values[0]\n",
            "try:\n    pass\nexcept* ValueError:\n    pass\n",
        ],
    )
    def test_syntax_newer_than_the_floor_is_refused(self, source: str) -> None:
        assert not parses_at_the_floor(source)

    @pytest.mark.parametrize(
        "source",
        [
            "import datetime\n\nSTAMP = datetime.datetime.now(datetime.timezone.utc)\n",
            "from datetime import timezone\n",
            "PAIRS = list(zip([1], [2], strict=True))\n",
            "def read(value: int | None) -> str | None:\n    return None\n",
        ],
    )
    def test_source_the_floor_accepts_passes_both_rules(self, source: str) -> None:
        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()

    @pytest.mark.parametrize(
        "source, name",
        [
            ("import datetime\n\nSTAMP = datetime.datetime.now(datetime.UTC)\n", "datetime.UTC"),
            ("from datetime import UTC\n", "datetime.UTC"),
            ("import tomllib\n", "tomllib"),
            ("from enum import StrEnum\n", "enum.StrEnum"),
            ("import enum\n\nclass Color(enum.StrEnum):\n    RED = 'red'\n", "enum.StrEnum"),
            ("from typing import Self\n", "typing.Self"),
            ("from typing import override\n", "typing.override"),
            ("import itertools\n\nPAGES = itertools.batched([1, 2, 3], 2)\n", "itertools.batched"),
            (
                "import hashlib\n\nD = hashlib.file_digest(handle, 'sha256')\n",
                "hashlib.file_digest",
            ),
            ("import asyncio\n\nT = asyncio.timeout(5)\n", "asyncio.timeout"),
            ("import asyncio\n\nG = asyncio.TaskGroup()\n", "asyncio.TaskGroup"),
        ],
    )
    def test_a_stdlib_name_newer_than_the_floor_is_named(self, source: str, name: str) -> None:
        assert post_floor_names(source) == {name}

    def test_a_relative_import_is_never_read_as_a_stdlib_name(self) -> None:
        assert post_floor_names("from .typing import Self\n") == set()
