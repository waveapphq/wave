"""The OpenSearch REST core stays copyable into a remote bundle (REQ-5.1.2).

Every module under wavecore/connectivity/opensearch/ is copied verbatim onto the remote
host, so each one may import the standard library, its own package, the promoted TLS
context, the held cancel, the typed-table helpers, the proxy core and the web address
parser - nothing else, and nothing newer than the interpreter floor the runner accepts.
No OpenSearch or HTTP client library.
"""

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
)
from wavecore.connectivity import opensearch as opensearch_package

_PACKAGE_ROOT = Path(str(opensearch_package.__file__)).parent
_PACKAGE_NAME = opensearch_package.__name__
_DQL_PACKAGE = f"{_PACKAGE_NAME}.dql"
_WAVECORE_ROOT = _PACKAGE_ROOT.parents[1]

_ALLOWED_WAVECORE_IMPORTS = {
    "wavecore.connectivity.tls_context",
    "wavecore.connectivity.k8s.verbs._outputs",
    "wavecore.plugins._held_run",
    "wavecore.connectivity.proxy",
    "wavecore.connectivity.web_address",
}
_WALK = PackageWalk(_PACKAGE_NAME, _PACKAGE_ROOT, tuple(sorted(_ALLOWED_WAVECORE_IMPORTS)))

_FORBIDDEN_THIRD_PARTY = {"requests", "urllib3", "httpx", "opensearchpy"}

# Named apart so a violation says which rule it broke; the bundled TLS engine is not used.
_FORBIDDEN_BY_NAME = (
    "wavecore.plugins.http_tls",
    "asyncio",
    "yaml",
    "pydantic",
    "wavecore.core",
    "wavecore.api",
)

_EXPECTED_MODULES = {
    _PACKAGE_NAME,
    f"{_PACKAGE_NAME}._url",
    f"{_PACKAGE_NAME}._auth",
    f"{_PACKAGE_NAME}._rest",
    f"{_PACKAGE_NAME}._errors",
    f"{_PACKAGE_NAME}._time",
    f"{_PACKAGE_NAME}._json_text",
    f"{_PACKAGE_NAME}._query",
    f"{_PACKAGE_NAME}._search",
    f"{_PACKAGE_NAME}._results",
    f"{_PACKAGE_NAME}._aggregate",
    f"{_PACKAGE_NAME}._stats_table",
    f"{_PACKAGE_NAME}._fields",
    _DQL_PACKAGE,
    f"{_DQL_PACKAGE}._parser",
    f"{_DQL_PACKAGE}._nodes",
    f"{_DQL_PACKAGE}._translate",
    f"{_DQL_PACKAGE}._cursor",
}

_MODULES = _WALK.modules
_MODULE_NAMES = _WALK.names

_BUNDLED_EXTRAS = [
    (dotted, _WAVECORE_ROOT.joinpath(*dotted.split(".")[1:]).with_suffix(".py"))
    for dotted in sorted(_ALLOWED_WAVECORE_IMPORTS)
]
_BUNDLED_MODULES = _MODULES + _BUNDLED_EXTRAS
_BUNDLED_MODULE_NAMES = [dotted for dotted, _path in _BUNDLED_MODULES]


class TestTheWalkCoversTheWholePackage:
    """A walk that finds nothing would pass every rule below without reading a line."""

    def test_the_walk_finds_modules(self) -> None:
        assert _MODULE_NAMES

    def test_the_walk_finds_every_module_the_bundle_carries(self) -> None:
        assert _EXPECTED_MODULES <= set(_MODULE_NAMES)

    def test_the_walk_reaches_the_dql_package(self) -> None:
        assert {f"{_DQL_PACKAGE}._parser", f"{_DQL_PACKAGE}._cursor"} <= set(_MODULE_NAMES)


@pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_MODULE_NAMES)
class TestEveryModuleIsVendorable:
    """Stdlib, the package itself and the five WAVE modules the bundle carries beside it."""

    def test_every_import_is_stdlib_or_an_allowed_wave_module(
        self, dotted: str, path: Path
    ) -> None:
        outsiders = _WALK.outsiders(dotted, path)

        assert outsiders == [], f"{dotted} reaches outside the bundle: {outsiders}"

    def test_no_third_party_client_library_is_imported(self, dotted: str, path: Path) -> None:
        roots = {next(iter(names)).split(".")[0] for names in import_candidates(dotted, path)}

        assert not roots & _FORBIDDEN_THIRD_PARTY, f"{dotted} imports {sorted(roots)}"

    @pytest.mark.parametrize("forbidden", _FORBIDDEN_BY_NAME)
    def test_the_forbidden_import_is_absent(self, forbidden: str, dotted: str, path: Path) -> None:
        hits = {name for name in imported_names(dotted, path) if matches(name, forbidden)}

        assert not hits, f"{dotted} imports {sorted(hits)}"


class TestTheBundleWalkCoversTheVendoredExtras:
    """The floor rules read the extras too: they are copied onto the same host."""

    def test_the_extras_are_the_wave_modules_the_package_may_import(self) -> None:
        assert {dotted for dotted, _path in _BUNDLED_EXTRAS} == _ALLOWED_WAVECORE_IMPORTS

    def test_every_extra_is_a_file_on_disk(self) -> None:
        missing = [dotted for dotted, path in _BUNDLED_EXTRAS if not path.is_file()]

        assert not missing


@pytest.mark.parametrize(("dotted", "path"), _BUNDLED_MODULES, ids=_BUNDLED_MODULE_NAMES)
class TestEveryBundledModuleRunsOnTheFloorInterpreter:
    """Syntax and stdlib alike: what ships must run on the oldest host the runner accepts."""

    def test_the_module_parses_at_the_remote_floor(self, dotted: str, path: Path) -> None:
        assert parses_at_the_floor(
            path.read_text()
        ), f"{dotted} needs syntax newer than {FLOOR_NAME}"

    def test_the_module_reads_no_stdlib_name_newer_than_the_floor(
        self, dotted: str, path: Path
    ) -> None:
        hits = post_floor_names(path.read_text())

        assert not hits, f"{dotted} reads {sorted(hits)}, absent from {FLOOR_NAME}"


class TestTheImportRulesSeeAViolation:
    """A guard that cannot fail proves nothing, so the walk is shown a module that breaks it."""

    @pytest.mark.parametrize(
        "source",
        [
            "import requests\n",
            "from urllib3 import PoolManager\n",
            "import httpx\n",
            "from opensearchpy import OpenSearch\n",
            "from wavecore.plugins import http_tls\n",
            "from wavecore.core.expressions import evaluator\n",
        ],
    )
    def test_an_outside_import_is_named(self, source: str, tmp_path: Path) -> None:
        module = tmp_path / "_probe.py"
        module.write_text(source)

        assert _WALK.outsiders(f"{_PACKAGE_NAME}._probe", module) != []

    @pytest.mark.parametrize(
        "source",
        [
            "import http.client\nimport ssl\nfrom decimal import Decimal\n",
            "from wavecore.connectivity.tls_context import build_context\n",
            "from wavecore.connectivity.k8s.verbs._outputs import typed_table\n",
            "from wavecore.plugins._held_run import Live\n",
            "from wavecore.connectivity.proxy import connect\n",
            "from wavecore.connectivity import proxy\n",
            "from wavecore.connectivity.web_address import basic_authorization\n",
            "from wavecore.connectivity.web_address import parse_web_address\n",
            "from ._errors import OpenSearchFailure\n",
        ],
    )
    def test_an_allowed_import_passes(self, source: str, tmp_path: Path) -> None:
        module = tmp_path / "_probe.py"
        module.write_text(source)

        assert _WALK.outsiders(f"{_PACKAGE_NAME}._probe", module) == []
