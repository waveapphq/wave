"""Compiled drivers travel to a remote host as the prebuilt wheels that fit it (SQL-15, REQ-5.1.4).

WAVE keeps, per compiled package, the builds for Python 3.10 to 3.14 on x86_64 and aarch64
with glibc and musl, listed in a lock beside the wheels. For a SQLite or an Oracle block, or a
SQL Server block with TLS on, the runner picks the one build of each package that fits the
probed host and pushes it to the worker once; a host outside the carried set is refused by
name, and a fitting wheel missing from the cache names the script that fetches it.
"""

import base64
import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import apsw
import pytest

import wavecore
from wavecore.core.remote_exec import runner

BACKEND = Path(str(wavecore.__file__)).parents[1]
PYTHONS = ("3.10", "3.11", "3.12", "3.13", "3.14")
MACHINES = ("x86_64", "aarch64")
LIBCS = ("glibc", "musl")
ORACLE_PACKAGES = ("oracledb", "cryptography", "cffi", "typing_extensions")
MSSQL_PACKAGES = ("pyopenssl", "cryptography", "cffi", "typing_extensions")
SQLITE_PACKAGES = ("apsw",)
PLATFORMS = [
    (python, machine, libc) for python in PYTHONS for machine in MACHINES for libc in LIBCS
]
PROBE: dict[str, Any] = {"python": (3, 12), "machine": "x86_64", "libc": "glibc"}
HOST = "sshd"
LOCK_KEYS = {"file", "sha256", "package", "python", "machine", "libc"}


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def probe(python: tuple[int, int], machine: str = "x86_64", libc: str = "glibc") -> dict[str, Any]:
    return {"python": python, "machine": machine, "libc": libc}


def tiny_wheel(path: Path, package: str = "wave_probe_pkg", body: str = "") -> Path:
    """A minimal wheel: one package and the .dist-info every wheel carries."""
    info = f"{package}-1.0.dist-info"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(f"{package}/__init__.py", body)
        archive.writestr(f"{info}/METADATA", f"Metadata-Version: 2.1\nName: {package}\n")
        archive.writestr(f"{info}/WHEEL", "Wheel-Version: 1.0\nTag: py3-none-any\n")
        archive.writestr(f"{info}/RECORD", "")
    return path


def wheel_entry(
    package: str,
    *,
    python: tuple[str, ...] = PYTHONS,
    machine: str = "x86_64",
    libc: str = "glibc",
) -> dict[str, Any]:
    """One lock row; its file name tells it apart from every other row."""
    tag = f"{python[0]}_{python[-1]}-{machine}-{libc}".replace(".", "")
    return {
        "file": f"{package}-{tag}.whl",
        "package": package,
        "python": list(python),
        "machine": machine,
        "libc": libc,
    }


def any_platform(package: str, python: tuple[str, ...] = PYTHONS) -> dict[str, Any]:
    return wheel_entry(package, python=python, machine="any", libc="any")


def wheel_cache(
    monkeypatch: pytest.MonkeyPatch,
    folder: Path,
    entries: list[dict[str, Any]],
    *,
    missing: tuple[str, ...] = (),
) -> Path:
    """A wheels folder and lock the runner reads instead of its own; `missing` stay off disk."""
    wheels = folder / "wheels"
    wheels.mkdir(parents=True, exist_ok=True)
    rows = []
    for entry in entries:
        path = wheels / entry["file"]
        if entry["file"] not in missing:
            tiny_wheel(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "0" * 64
        rows.append({**entry, "sha256": digest})
    lock = folder / "wheels.lock"
    lock.write_text(json.dumps({"wheels": rows}), encoding="utf-8")
    monkeypatch.setattr(runner, "WHEELS_DIR", wheels)
    monkeypatch.setattr(runner, "WHEELS_LOCK", lock)
    return wheels


def x86_glibc_cache() -> list[dict[str, Any]]:
    """Every compiled package for every carried Python on x86_64 / glibc."""
    names = ("oracledb", "pyopenssl", "cryptography", "cffi", "apsw")
    return [*[wheel_entry(name) for name in names], any_platform("typing_extensions")]


def two_platform_cache() -> list[dict[str, Any]]:
    """The Oracle packages on x86_64 / glibc and aarch64 / musl only, typing_extensions anywhere."""
    return [
        *[
            wheel_entry(name, machine=machine, libc=libc)
            for machine, libc in (("x86_64", "glibc"), ("aarch64", "musl"))
            for name in ("oracledb", "cryptography", "cffi")
        ],
        any_platform("typing_extensions"),
    ]


def apsw_file(python: str, machine: str, libc: str) -> str:
    """The apsw build carried for one platform, in the version WAVE itself runs."""
    tag = f"cp{python.replace('.', '')}"
    build = "manylinux_2_28" if libc == "glibc" else "musllinux_1_2"
    return f"apsw-{apsw.apswversion()}-{tag}-{tag}-{build}_{machine}.whl"


def unsupported(host: str, name: str, found: str, carried: str) -> str:
    return f"{host} cannot run {name}: it has {found}; WAVE carries {carried}"


def _fake_process() -> MagicMock:
    proc = MagicMock()
    proc.stdin.write = MagicMock()
    proc.stdin.drain = AsyncMock()
    return proc


def _written(proc: MagicMock) -> str:
    return "".join(str(call.args[0]) for call in proc.stdin.write.call_args_list)


class TestTheCarriedSet:
    """Which packages each compiled type needs, and where the cache and its lock live."""

    def test_each_compiled_type_names_its_packages_in_order(self) -> None:
        assert runner.COMPILED_PACKAGES == {
            "oracle": ORACLE_PACKAGES,
            "mssql": MSSQL_PACKAGES,
            "sqlite": SQLITE_PACKAGES,
        }

    def test_the_wheels_live_in_the_backend_vendor_folder(self) -> None:
        assert runner.WHEELS_DIR == BACKEND / "vendor" / "wheels"

    def test_the_lock_lives_beside_the_wheels(self) -> None:
        assert runner.WHEELS_LOCK == BACKEND / "vendor" / "wheels.lock"

    def test_every_lock_row_names_its_file_digest_package_and_platform(self) -> None:
        rows = json.loads(runner.WHEELS_LOCK.read_text(encoding="utf-8"))["wheels"]

        assert rows
        for row in rows:
            assert set(row) == LOCK_KEYS, row
            assert re.fullmatch(r"[0-9a-f]{64}", row["sha256"]), row

    def test_the_lock_holds_one_apsw_build_per_carried_platform(self) -> None:
        rows = json.loads(runner.WHEELS_LOCK.read_text(encoding="utf-8"))["wheels"]

        carried = sorted(
            (row["file"], tuple(row["python"]), row["machine"], row["libc"])
            for row in rows
            if row["package"] == "apsw"
        )

        assert carried == sorted(
            (apsw_file(python, machine, libc), (python,), machine, libc)
            for python, machine, libc in PLATFORMS
        )

    @pytest.mark.parametrize("database_type", ["oracle", "mssql", "sqlite"])
    def test_the_lock_carries_every_host_the_design_promises(self, database_type: str) -> None:
        """Python 3.10 to 3.14, x86_64 and aarch64, glibc and musl (SQL-15)."""
        rows = json.loads(runner.WHEELS_LOCK.read_text(encoding="utf-8"))["wheels"]
        gaps = [
            (package, python, machine, libc)
            for package in runner.COMPILED_PACKAGES[database_type]
            for python in PYTHONS
            for machine in MACHINES
            for libc in LIBCS
            if not any(
                row["package"] == package
                and python in row["python"]
                and row["machine"] in (machine, "any")
                and row["libc"] in (libc, "any")
                for row in rows
            )
        ]

        assert gaps == []


class TestSelectWheels:
    """One fitting build per package, in the type's package order, as paths in the cache."""

    @pytest.mark.parametrize("database_type", ["postgresql", "mysql"])
    def test_a_type_whose_driver_travels_as_source_needs_no_wheel(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, database_type: str
    ) -> None:
        wheel_cache(monkeypatch, tmp_path, x86_glibc_cache())

        assert runner.select_wheels(probe((3, 15), "riscv64", "bionic"), database_type, HOST) == []

    def test_oracle_takes_one_fitting_wheel_per_package_in_package_order(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entries = list(reversed(two_platform_cache()))
        wheels = wheel_cache(monkeypatch, tmp_path, entries)

        picked = runner.select_wheels(PROBE, "oracle", HOST)

        assert picked == [
            wheels / wheel_entry("oracledb")["file"],
            wheels / wheel_entry("cryptography")["file"],
            wheels / wheel_entry("cffi")["file"],
            wheels / any_platform("typing_extensions")["file"],
        ]

    def test_sql_server_takes_its_own_packages(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wheels = wheel_cache(monkeypatch, tmp_path, x86_glibc_cache())

        picked = runner.select_wheels(PROBE, "mssql", HOST)

        assert picked == [
            wheels / wheel_entry("pyopenssl")["file"],
            wheels / wheel_entry("cryptography")["file"],
            wheels / wheel_entry("cffi")["file"],
            wheels / any_platform("typing_extensions")["file"],
        ]

    def test_sqlite_takes_the_one_apsw_wheel(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wheels = wheel_cache(monkeypatch, tmp_path, x86_glibc_cache())

        picked = runner.select_wheels(PROBE, "sqlite", HOST)

        assert picked == [wheels / wheel_entry("apsw")["file"]]

    @pytest.mark.parametrize(("python", "machine", "libc"), PLATFORMS)
    def test_sqlite_takes_the_apsw_build_of_every_carried_platform(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, python: str, machine: str, libc: str
    ) -> None:
        """The real lock decides; a tiny file stands in for the build, so no cache is read."""
        monkeypatch.setattr(runner, "WHEELS_DIR", tmp_path)
        build = tiny_wheel(tmp_path / apsw_file(python, machine, libc))
        major, minor = python.split(".")

        picked = runner.select_wheels(
            probe((int(major), int(minor)), machine, libc), "sqlite", HOST
        )

        assert picked == [build]

    def test_the_machine_and_libc_pick_the_build(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wheels = wheel_cache(monkeypatch, tmp_path, two_platform_cache())

        picked = runner.select_wheels(probe((3, 12), "aarch64", "musl"), "oracle", HOST)

        assert picked == [
            wheels / wheel_entry("oracledb", machine="aarch64", libc="musl")["file"],
            wheels / wheel_entry("cryptography", machine="aarch64", libc="musl")["file"],
            wheels / wheel_entry("cffi", machine="aarch64", libc="musl")["file"],
            wheels / any_platform("typing_extensions")["file"],
        ]

    def test_the_python_version_picks_the_build(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        per_python = [wheel_entry("cffi", python=(version,)) for version in PYTHONS]
        others = [wheel_entry("oracledb"), wheel_entry("cryptography")]
        wheels = wheel_cache(
            monkeypatch, tmp_path, [*per_python, *others, any_platform("typing_extensions")]
        )

        picked = runner.select_wheels(probe((3, 13)), "oracle", HOST)

        assert picked[2] == wheels / wheel_entry("cffi", python=("3.13",))["file"]

    def test_an_any_row_fits_every_machine_and_libc(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entries = [
            any_platform("pyopenssl"),
            *[
                wheel_entry(name, machine="aarch64", libc="musl")
                for name in ("cryptography", "cffi")
            ],
            any_platform("typing_extensions"),
        ]
        wheels = wheel_cache(monkeypatch, tmp_path, entries)

        picked = runner.select_wheels(probe((3, 10), "aarch64", "musl"), "mssql", HOST)

        assert picked[0] == wheels / any_platform("pyopenssl")["file"]
        assert picked[3] == wheels / any_platform("typing_extensions")["file"]

    def test_a_missing_file_that_does_not_fit_is_never_asked_for(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        absent = wheel_entry("oracledb", machine="aarch64", libc="musl")["file"]
        wheel_cache(monkeypatch, tmp_path, two_platform_cache(), missing=(absent,))

        assert len(runner.select_wheels(PROBE, "oracle", HOST)) == 4


class TestAHostOutsideTheCarriedSetIsRefused:
    """The refusal names the host, the type, what the host has and what WAVE carries (SQL-5)."""

    def test_the_refusal_is_a_runtime_error(self) -> None:
        assert issubclass(runner.UnsupportedHost, RuntimeError)

    @pytest.mark.parametrize(
        ("host_probe", "found"),
        [
            pytest.param(probe((3, 15)), "Python 3.15 on x86_64 / glibc", id="python"),
            pytest.param(probe((3, 12), "riscv64"), "Python 3.12 on riscv64 / glibc", id="machine"),
            pytest.param(
                probe((3, 12), libc="bionic"), "Python 3.12 on x86_64 / bionic", id="libc"
            ),
            pytest.param(
                probe((3, 12), "x86_64", "musl"), "Python 3.12 on x86_64 / musl", id="pairing"
            ),
        ],
    )
    def test_a_host_no_build_fits_is_named_with_what_wave_carries(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        host_probe: dict[str, Any],
        found: str,
    ) -> None:
        wheel_cache(monkeypatch, tmp_path, two_platform_cache())
        carried = "Python 3.10-3.14 on aarch64 / musl, x86_64 / glibc"

        with pytest.raises(
            runner.UnsupportedHost, match=exact(unsupported(HOST, "Oracle", found, carried))
        ):
            runner.select_wheels(host_probe, "oracle", HOST)

    def test_sql_server_is_named_as_the_type(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wheel_cache(monkeypatch, tmp_path, x86_glibc_cache())
        message = unsupported(
            "db-runner.example",
            "SQL Server",
            "Python 3.15 on x86_64 / glibc",
            "Python 3.10-3.14 on x86_64 / glibc",
        )

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 15)), "mssql", "db-runner.example")

    def test_sqlite_is_named_as_the_type(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        wheel_cache(monkeypatch, tmp_path, x86_glibc_cache())
        message = unsupported(
            "edge-7",
            "SQLite",
            "Python 3.15 on x86_64 / glibc",
            "Python 3.10-3.14 on x86_64 / glibc",
        )

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 15)), "sqlite", "edge-7")

    def test_the_real_lock_names_every_platform_sqlite_is_carried_for(self) -> None:
        carried = (
            "Python 3.10-3.14 on aarch64 / glibc, aarch64 / musl, x86_64 / glibc, x86_64 / musl"
        )
        message = unsupported(HOST, "SQLite", "Python 3.12 on riscv64 / glibc", carried)

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 12), "riscv64"), "sqlite", HOST)

    def test_a_platform_one_package_lacks_is_not_carried(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entries = [
            entry
            for entry in two_platform_cache()
            if not (entry["package"] == "cffi" and entry["machine"] == "aarch64")
        ]
        wheel_cache(monkeypatch, tmp_path, entries)
        message = unsupported(
            HOST, "Oracle", "Python 3.12 on aarch64 / musl", "Python 3.10-3.14 on x86_64 / glibc"
        )

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 12), "aarch64", "musl"), "oracle", HOST)

    def test_the_range_is_the_versions_every_package_carries(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entries = [
            wheel_entry("oracledb"),
            wheel_entry("cryptography", python=PYTHONS[1:]),
            wheel_entry("cffi", python=PYTHONS[:-1]),
            any_platform("typing_extensions"),
        ]
        wheel_cache(monkeypatch, tmp_path, entries)
        message = unsupported(
            HOST, "Oracle", "Python 3.10 on x86_64 / glibc", "Python 3.11-3.13 on x86_64 / glibc"
        )

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 10)), "oracle", HOST)

    def test_a_single_carried_version_prints_alone(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        only = ("3.12",)
        entries = [wheel_entry(name, python=only) for name in ("oracledb", "cryptography", "cffi")]
        wheel_cache(monkeypatch, tmp_path, [*entries, any_platform("typing_extensions", only)])
        message = unsupported(
            HOST, "Oracle", "Python 3.13 on x86_64 / glibc", "Python 3.12 on x86_64 / glibc"
        )

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 13)), "oracle", HOST)

    def test_the_carried_platforms_are_sorted(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        platforms = [
            ("x86_64", "musl"),
            ("x86_64", "glibc"),
            ("aarch64", "musl"),
            ("aarch64", "glibc"),
        ]
        entries = [
            wheel_entry(name, machine=machine, libc=libc)
            for machine, libc in platforms
            for name in ("oracledb", "cryptography", "cffi")
        ]
        wheel_cache(monkeypatch, tmp_path, [*entries, any_platform("typing_extensions")])
        carried = (
            "Python 3.10-3.14 on aarch64 / glibc, aarch64 / musl, x86_64 / glibc, x86_64 / musl"
        )
        message = unsupported(HOST, "Oracle", "Python 3.12 on riscv64 / glibc", carried)

        with pytest.raises(runner.UnsupportedHost, match=exact(message)):
            runner.select_wheels(probe((3, 12), "riscv64"), "oracle", HOST)


class TestAFittingWheelMissingFromTheCache:
    """The cache is fetched, not committed: a gap names the script that fills it."""

    def test_the_failure_names_the_file_the_folder_and_the_fetch_script(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        absent = wheel_entry("cryptography")["file"]
        wheels = wheel_cache(monkeypatch, tmp_path, x86_glibc_cache(), missing=(absent,))
        message = (
            f"Remote wheel {absent} is missing from {wheels}: run scripts/fetch-remote-wheels.sh"
        )

        with pytest.raises(FileNotFoundError, match=exact(message)):
            runner.select_wheels(PROBE, "oracle", HOST)


class TestTheWheelFrame:
    """One JSON line carries every wheel by name, its bytes in base64."""

    def test_the_frame_is_one_json_line_of_names_and_data(self, tmp_path: Path) -> None:
        first = tiny_wheel(tmp_path / "first-1.0-py3-none-any.whl", body="A = 1\n")
        second = tiny_wheel(tmp_path / "second-1.0-py3-none-any.whl", body="B = 2\n")
        expected = {
            "wheels": [
                {"name": path.name, "data": base64.b64encode(path.read_bytes()).decode("ascii")}
                for path in (first, second)
            ]
        }

        frame = runner.wheel_frame([first, second])

        assert frame == json.dumps(expected) + "\n"

    def test_the_data_decodes_to_the_wheel_bytes(self, tmp_path: Path) -> None:
        wheel = tiny_wheel(tmp_path / "only-1.0-py3-none-any.whl")

        [carried] = json.loads(runner.wheel_frame([wheel]))["wheels"]

        assert base64.b64decode(carried["data"]) == wheel.read_bytes()


class TestPushWheels:
    """A worker gets each wheel once: the first block that needs it pays, the rest reuse it."""

    @pytest.fixture
    def wheels(self, tmp_path: Path) -> list[Path]:
        return [tiny_wheel(tmp_path / f"{name}-1.0-py3-none-any.whl") for name in "abc"]

    @staticmethod
    def _worker() -> runner.WorkerHandle:
        return runner.WorkerHandle(process=_fake_process(), host=HOST, interpreter="python3")

    async def test_the_first_push_writes_one_frame_and_drains(self, wheels: list[Path]) -> None:
        worker = self._worker()

        await runner.push_wheels(worker, wheels[:2])

        assert _written(worker.process) == runner.wheel_frame(wheels[:2])
        worker.process.stdin.drain.assert_awaited()

    async def test_the_worker_records_what_it_holds(self, wheels: list[Path]) -> None:
        worker = self._worker()

        await runner.push_wheels(worker, wheels[:2])

        assert worker.wheels == {wheels[0].name, wheels[1].name}

    async def test_a_wheel_already_on_the_worker_is_never_sent_again(
        self, wheels: list[Path]
    ) -> None:
        worker = self._worker()
        await runner.push_wheels(worker, wheels[:2])
        worker.process.stdin.write.reset_mock()

        await runner.push_wheels(worker, wheels[:2])

        worker.process.stdin.write.assert_not_called()

    async def test_only_the_new_wheels_ride_a_later_push(self, wheels: list[Path]) -> None:
        worker = self._worker()
        await runner.push_wheels(worker, wheels[:2])
        worker.process.stdin.write.reset_mock()

        await runner.push_wheels(worker, [wheels[0], wheels[2]])

        assert _written(worker.process) == runner.wheel_frame([wheels[2]])
        assert worker.wheels == {wheel.name for wheel in wheels}

    async def test_nothing_is_written_for_no_wheels(self) -> None:
        worker = self._worker()

        await runner.push_wheels(worker, [])

        worker.process.stdin.write.assert_not_called()
        assert worker.wheels == set()

    async def test_each_worker_keeps_its_own_record(self, wheels: list[Path]) -> None:
        first, second = self._worker(), self._worker()
        await runner.push_wheels(first, wheels[:1])

        await runner.push_wheels(second, wheels[:1])

        assert _written(second.process) == runner.wheel_frame(wheels[:1])
