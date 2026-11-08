"""The Helm core stays copyable into a remote bundle (REQ-3.4.1.5).

Every module under wavecore/connectivity/helm/ is copied verbatim onto the
execution host beside the Kubernetes core, so each one may import the standard
library, its own package, the Kubernetes package, the process launcher, the
stdlib file core, the home-relative path join, the proxy core and the run log -
nothing else, and nothing the host's floor interpreter cannot parse.
"""

from pathlib import Path

import pytest

from tests.core.remote_exec._vendorability import (
    FLOOR_NAME,
    PackageWalk,
    imported_names,
    matches,
    parses_at_the_floor,
)
from wavecore.connectivity import helm as helm_package
from wavecore.connectivity import k8s as k8s_package
from wavecore.connectivity import run_log
from wavecore.plugins import _file_ops, _process_group, _tls_material

_ROOT = Path(str(helm_package.__file__)).parent
_PACKAGE = helm_package.__name__
_VERBS = f"{_PACKAGE}.verbs"
_PROXY_CORE = "wavecore.connectivity.proxy"
_WALK = PackageWalk(
    _PACKAGE,
    _ROOT,
    (
        k8s_package.__name__,
        _process_group.__name__,
        _file_ops.__name__,
        _tls_material.__name__,
        _PROXY_CORE,
        run_log.__name__,
    ),
)
_FORBIDDEN = ("yaml", "pydantic", "asyncio", "wavecore.core", "wavecore.api", "requests", "httpx")

_EXPECTED_MODULES = {
    _PACKAGE,
    f"{_PACKAGE}._cli",
    _VERBS,
    f"{_VERBS}.install",
    f"{_VERBS}.upgrade",
    f"{_VERBS}.rollback",
    f"{_VERBS}.uninstall",
    f"{_VERBS}.test",
    f"{_VERBS}.status",
}

_MODULES = _WALK.modules


class TestTheWalkCoversThePackage:
    """A walk that finds nothing would pass every rule below without reading a line."""

    def test_the_walk_finds_modules(self) -> None:
        assert _MODULES

    def test_the_walk_finds_every_module_the_bundle_carries(self) -> None:
        assert _EXPECTED_MODULES <= set(_WALK.names)


class TestOnlyVendoredImports:
    """A host supplies nothing: every import resolves inside the payload."""

    @pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_WALK.names)
    def test_every_import_is_carried_by_the_bundle(self, dotted: str, path: Path) -> None:
        outsiders = _WALK.outsiders(dotted, path)

        assert outsiders == [], f"{dotted} reaches outside the bundle: {outsiders}"

    @pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_WALK.names)
    def test_no_module_reaches_into_waves_own_runtime(self, dotted: str, path: Path) -> None:
        hits = sorted(
            name
            for name in imported_names(dotted, path)
            for forbidden in _FORBIDDEN
            if matches(name, forbidden)
        )

        assert hits == [], f"{dotted} imports {hits}"


class TestTheFloorInterpreterCanRunIt:
    """The remote worker's floor is older than the interpreter WAVE runs on."""

    @pytest.mark.parametrize(("dotted", "path"), _MODULES, ids=_WALK.names)
    def test_every_module_parses_at_the_floor(self, dotted: str, path: Path) -> None:
        source = path.read_text(encoding="utf-8")

        assert parses_at_the_floor(source), f"{dotted} needs syntax newer than {FLOOR_NAME}"
