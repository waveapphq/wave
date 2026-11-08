"""What rides the bundle as source runs on the oldest host interpreter (REQ-5.1.4, SQL-15).

The SQL drivers carried as source, the SQL package and every plugin core are copied verbatim
onto a remote host that has nothing installed. Each module must parse at the interpreter floor
and read no newer stdlib name. An import that runs whenever its module loads must name the
standard library or something the bundle carries; an import of anything else must sit behind
a guard and be one the package is known to make. The SQL package imports each driver only
inside a function, so a host carrying some drivers still imports the whole package.
"""

from functools import cache
from pathlib import Path

import pytest

import wavecore
from tests.core.remote_exec._vendorability import (
    FLOOR_NAME,
    FUNCTION,
    TRY,
    TYPE_CHECKING,
    VERSION,
    ImportSite,
    PackageWalk,
    import_sites,
    installed_root,
    is_stdlib,
    module_listing,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.core.remote_exec.bundle import _vendored_sources

_WAVECORE_ROOT = Path(str(wavecore.__file__)).parent

THIRD_PARTY = ("pg8000", "scramp", "asn1crypto", "dateutil", "pymysql", "pytds")
SQL_PACKAGE = "wavecore.connectivity.sql"
CORES = (
    "_ping_core",
    "_netcat_core",
    "_file_ops",
    "_plural",
    "_ports",
    "_process_group",
    "_sql_core",
    "_tls_material",
)

# The only imports outside the carried set each unit may make, and only behind a guard.
GUARDED_OUTSIDERS: dict[str, frozenset[str]] = {
    "asn1crypto": frozenset({"cStringIO", "urlparse", "UserDict"}),
    "pymysql": frozenset({"cryptography", "nacl"}),
    "pytds": frozenset(
        {
            "OpenSSL",
            "ntlm_auth",
            "spnego",
            "kerberos",
            "winkerberos",
            "namedlist",
            "recordtype",
            "bitarray",
        }
    ),
    SQL_PACKAGE: frozenset({"oracledb", "OpenSSL", "apsw"}),
}

# The drivers the SQL package reaches for, each only from inside a function body.
SQL_DRIVERS = frozenset({"pg8000", "pymysql", "pytds", "oracledb", "OpenSSL", "apsw"})

EXPECTED_SQL_MODULES = {
    SQL_PACKAGE,
    f"{SQL_PACKAGE}.dialects",
    f"{SQL_PACKAGE}.dialects.postgres",
    f"{SQL_PACKAGE}.dialects.mysql",
    f"{SQL_PACKAGE}.dialects.oracle",
    f"{SQL_PACKAGE}.dialects.mssql",
    f"{SQL_PACKAGE}.dialects.sqlite",
    f"{SQL_PACKAGE}._split",
    f"{SQL_PACKAGE}._params",
    f"{SQL_PACKAGE}._load",
    f"{SQL_PACKAGE}._procedure",
    f"{SQL_PACKAGE}._catalog",
    f"{SQL_PACKAGE}._errors",
    f"{SQL_PACKAGE}._mysql_rsa",
    f"{SQL_PACKAGE}._sqlite_cursor",
}


def _unit_roots() -> dict[str, Path | None]:
    roots: dict[str, Path | None] = {name: installed_root(name) for name in THIRD_PARTY}
    roots[SQL_PACKAGE] = _WAVECORE_ROOT / "connectivity" / "sql"
    for core in CORES:
        roots[f"wavecore.plugins.{core}"] = _WAVECORE_ROOT / "plugins" / f"{core}.py"
    return roots


UNIT_ROOTS = _unit_roots()


def _unit_modules(unit: str, root: Path | None) -> list[tuple[str, str, Path | None]]:
    """(unit, module, path) for each module; a unit with nothing on disk stands as one row."""
    listing = module_listing(unit, root) if root is not None and root.exists() else []
    return [(unit, dotted, path) for dotted, path in listing] or [(unit, unit, None)]


MODULES = [row for unit, root in UNIT_ROOTS.items() for row in _unit_modules(unit, root)]
MODULE_IDS = [dotted for _unit, dotted, _path in MODULES]
SQL_MODULES = [(dotted, path) for unit, dotted, path in MODULES if unit == SQL_PACKAGE]
SQL_MODULE_IDS = [dotted for dotted, _path in SQL_MODULES]


@cache
def _sources() -> dict[str, str]:
    return _vendored_sources()


@cache
def _packages() -> frozenset[str]:
    """Carried names that have carried submodules."""
    names = _sources()
    return frozenset(name for name in names if any(other.startswith(f"{name}.") for other in names))


def _carries(module: str) -> bool:
    """A carried module, or a virtual submodule a carried plain module provides (six.moves)."""
    parts = module.split(".")
    for end in range(len(parts), 0, -1):
        prefix = ".".join(parts[:end])
        if prefix in _sources():
            return end == len(parts) or prefix not in _packages()
    return False


def _carried(site: ImportSite) -> bool:
    if not _carries(site.module):
        return False
    if _sources().get(site.module) == "":
        # An empty carried package serves only the submodules the bundle carries.
        return all(name in _sources() for name in site.names - {site.module})
    return True


def _present(dotted: str, path: Path | None) -> Path:
    assert path is not None and path.is_file(), f"{dotted} is not on disk where the bundle reads it"
    return path


def _sites(dotted: str, path: Path | None) -> list[ImportSite]:
    return import_sites(dotted, _present(dotted, path))


def _outside(site: ImportSite) -> bool:
    """Neither the standard library nor anything the bundle carries."""
    return not (is_stdlib(site.names) or _carried(site))


def _guarded_outsiders(unit: str) -> set[str]:
    return {
        site.root
        for owner, dotted, path in MODULES
        if owner == unit
        for site in _sites(dotted, path)
        if site.guards and _outside(site)
    }


class TestTheWalkCoversEveryCarriedUnit:
    """A walk that finds nothing would pass every rule below without reading a line."""

    @pytest.mark.parametrize("package", THIRD_PARTY)
    def test_the_third_party_package_is_installed_for_the_bundle_to_read(
        self, package: str
    ) -> None:
        root = UNIT_ROOTS[package]

        assert root is not None, f"{package} is not installed in WAVE's environment"
        assert (root / "__init__.py").is_file()

    def test_the_walk_finds_every_module_of_the_sql_package(self) -> None:
        assert EXPECTED_SQL_MODULES <= set(SQL_MODULE_IDS)


@pytest.mark.parametrize(("unit", "dotted", "path"), MODULES, ids=MODULE_IDS)
class TestEveryCarriedModuleRunsOnTheFloorInterpreter:
    """Syntax and stdlib alike: what ships must run on the oldest host the runner accepts."""

    def test_the_module_parses_at_the_floor(
        self, unit: str, dotted: str, path: Path | None
    ) -> None:
        source = _present(dotted, path).read_text(encoding="utf-8")

        assert parses_at_the_floor(source), f"{dotted} needs syntax newer than {FLOOR_NAME}"

    def test_the_module_reads_no_stdlib_name_newer_than_the_floor(
        self, unit: str, dotted: str, path: Path | None
    ) -> None:
        hits = post_floor_names(_present(dotted, path).read_text(encoding="utf-8"))

        assert not hits, f"{dotted} reads {sorted(hits)}, absent from {FLOOR_NAME}"


@pytest.mark.parametrize(("unit", "dotted", "path"), MODULES, ids=MODULE_IDS)
class TestEveryCarriedModuleImportsOnlyWhatTheHostHas:
    """A host supplies nothing beyond its standard library and what the bundle carries."""

    def test_every_unguarded_import_is_stdlib_or_carried(
        self, unit: str, dotted: str, path: Path | None
    ) -> None:
        outsiders = [
            f"line {site.line}: {site.module}"
            for site in _sites(dotted, path)
            if not site.guards and _outside(site)
        ]

        assert outsiders == [], f"{dotted} always imports what no host has: {outsiders}"

    def test_a_guarded_import_outside_the_bundle_is_one_the_unit_is_known_to_make(
        self, unit: str, dotted: str, path: Path | None
    ) -> None:
        allowed = GUARDED_OUTSIDERS.get(unit, frozenset())
        unknown = [
            f"line {site.line}: {site.module}"
            for site in _sites(dotted, path)
            if site.guards and _outside(site) and site.root not in allowed
        ]

        assert unknown == [], f"{dotted} makes guarded imports nobody vetted: {unknown}"


class TestTheAllowListsCarryNoStaleEntry:
    """An entry nothing uses would let a later import through unvetted."""

    @pytest.mark.parametrize("unit", sorted(GUARDED_OUTSIDERS))
    def test_every_allowed_outsider_is_imported_by_the_unit(self, unit: str) -> None:
        assert _guarded_outsiders(unit) == GUARDED_OUTSIDERS[unit]

    def test_every_listed_driver_is_imported_by_the_sql_package(self) -> None:
        imported = {
            site.root
            for dotted, path in SQL_MODULES
            for site in _sites(dotted, path)
            if site.root in SQL_DRIVERS
        }

        assert imported == SQL_DRIVERS


@pytest.mark.parametrize(("dotted", "path"), SQL_MODULES, ids=SQL_MODULE_IDS)
class TestTheSqlPackageImportsDriversOnlyWhenItUsesThem:
    """A host that carries only some drivers still imports every module of the package."""

    def test_every_driver_import_sits_inside_a_function(
        self, dotted: str, path: Path | None
    ) -> None:
        loose = [
            f"line {site.line}: {site.module}"
            for site in _sites(dotted, path)
            if site.root in SQL_DRIVERS and FUNCTION not in site.guards
        ]

        assert loose == [], f"{dotted} imports a driver outside a function: {loose}"


def _sites_of(tmp_path: Path, source: str, ignored: tuple[str, ...] = ()) -> list[ImportSite]:
    path = tmp_path / "probe.py"
    path.write_text(source, encoding="utf-8")
    return [site for site in import_sites("pkg.probe", path) if site.root not in ignored]


class TestTheGuardFinderSeesEachGuard:
    """A finder that misreads a guard would pass a loose import, or refuse a vetted one."""

    @pytest.mark.parametrize(
        ("source", "guard"),
        [
            ("try:\n    import nacl\nexcept ImportError:\n    nacl = None\n", TRY),
            ("try:\n    import nacl\nexcept (OSError, ModuleNotFoundError):\n    pass\n", TRY),
            (
                "try:\n    import kerberos\nexcept ImportError:\n"
                "    import winkerberos as kerberos\n",
                TRY,
            ),
            ("import typing\nif typing.TYPE_CHECKING:\n    import OpenSSL\n", TYPE_CHECKING),
            (
                "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import OpenSSL\n",
                TYPE_CHECKING,
            ),
            (
                "import sys\nif sys.version_info < (3,):\n    from urlparse import urlsplit\n",
                VERSION,
            ),
            (
                "import sys\nif sys.version_info >= (3,):\n    pass\n"
                "else:\n    from UserDict import DictMixin\n",
                VERSION,
            ),
            ("def connect():\n    import oracledb\n", FUNCTION),
            ("class Dialect:\n    async def connect(self):\n        import oracledb\n", FUNCTION),
        ],
    )
    def test_a_guarded_import_names_its_guard(
        self, tmp_path: Path, source: str, guard: str
    ) -> None:
        sites = _sites_of(tmp_path, source, ignored=("typing", "sys"))

        assert sites
        assert all(guard in site.guards for site in sites), sites

    @pytest.mark.parametrize(
        "source",
        [
            "import oracledb\n",
            "try:\n    import nacl\nexcept ValueError:\n    nacl = None\n",
            "try:\n    import os\nexcept ImportError:\n    pass\nelse:\n    import nacl\n",
            "try:\n    import os\nexcept ImportError:\n    pass\nfinally:\n    import nacl\n",
            "import typing\nif typing.TYPE_CHECKING:\n    pass\nelse:\n    import nacl\n",
            "class Dialect:\n    import nacl\n",
            "if DEBUG:\n    import nacl\n",
        ],
    )
    def test_an_import_that_runs_when_its_module_loads_has_no_guard(
        self, tmp_path: Path, source: str
    ) -> None:
        [site] = _sites_of(tmp_path, source, ignored=("typing", "os"))

        assert site.guards == frozenset()

    def test_a_relative_import_resolves_inside_its_package(self, tmp_path: Path) -> None:
        [site] = _sites_of(tmp_path, "from .err import OperationalError\n")

        assert site.module == "pkg.err"
        assert site.names == {"pkg.err", "pkg.err.OperationalError"}


class TestTheCarriedCheckSeesAViolation:
    """The carried set is what the bundle serves, not every name that shares a prefix with it."""

    @pytest.mark.parametrize(
        ("module", "names"),
        [
            ("wavecore.plugins", {"wavecore.plugins", "wavecore.plugins.python"}),
            ("wavecore.core.table", {"wavecore.core.table", "wavecore.core.table.Table"}),
            ("OpenSSL.SSL", {"OpenSSL.SSL"}),
        ],
    )
    def test_a_name_the_bundle_does_not_serve_is_outside(
        self, module: str, names: set[str]
    ) -> None:
        assert _outside(ImportSite(module, frozenset(names), frozenset(), 1))

    @pytest.mark.parametrize(
        ("module", "names"),
        [
            ("wavecore.plugins", {"wavecore.plugins", "wavecore.plugins._ports"}),
            ("six.moves", {"six.moves", "six.moves._thread"}),
            (
                "wavecore.connectivity.k8s.verbs._outputs",
                {
                    "wavecore.connectivity.k8s.verbs._outputs",
                    "wavecore.connectivity.k8s.verbs._outputs.block_success",
                },
            ),
            ("json", {"json"}),
        ],
    )
    def test_stdlib_and_what_the_bundle_serves_are_inside(
        self, module: str, names: set[str]
    ) -> None:
        assert not _outside(ImportSite(module, frozenset(names), frozenset(), 1))


class TestOneAllowedNameDoesNotVouchForAnother:
    """Each name a `from` import brings in is judged on its own."""

    def test_an_allowed_name_beside_an_outside_one_is_still_flagged(self, tmp_path: Path) -> None:
        walk = PackageWalk("pkg", tmp_path, ("wavecore.plugins._process_group",))
        path = tmp_path / "probe.py"
        path.write_text("from wavecore.plugins import _process_group, python\n", encoding="utf-8")

        assert walk.outsiders("pkg.probe", path) == [
            ["wavecore.plugins", "wavecore.plugins.python"]
        ]
