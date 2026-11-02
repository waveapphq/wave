"""The one PEM-or-path reader every TLS consumer shares (REQ-5.1.4, REQ-3.4.1.6).

Certificate material is inline PEM text or a path to a PEM file: a path is `~`-expanded and
a relative one starts from the home folder of the user the process runs as. The HTTP block,
the SSH session, the SQL TLS context and the remote worker all read through this module, so
the rule has one home and rides to a remote host unchanged.
"""

import ast
import inspect
import re
from pathlib import Path
from types import ModuleType

import pytest

from wavecore.core.remote_exec.bundle import _vendored_sources, build_bundle
from wavecore.plugins import _ssh_session, _tls_material, http_client
from wavecore.plugins._tls_material import PEM_MARKER, is_pem, read_pem
from wavecore.plugins.http_client import HTTPClientPlugin

_MODULE = "wavecore.plugins._tls_material"
_PEM = (
    "-----BEGIN CERTIFICATE-----\n"
    "MIIBszCCAVmgAwIBAgIUQ2VydGlmaWNhdGUgZm9yIHRlc3Rz\n"
    "-----END CERTIFICATE-----\n"
)
_OTHER_PEM = "-----BEGIN CERTIFICATE-----\nT3RoZXI=\n-----END CERTIFICATE-----\n"


@pytest.fixture(scope="module")
def bundle_tree() -> ast.Module:
    return ast.parse(build_bundle("http-client").decode("utf-8"))


def _imported(tree: ast.AST, package: str = "") -> set[str]:
    """Every module an import in `tree` names; relative imports resolve from `package`."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.rsplit(".", node.level - 1)[0]
                base = f"{parent}.{base}" if base else parent
            names.add(base)
            names |= {f"{base}.{alias.name}" for alias in node.names}
    return names


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class TestIsPem:
    """Inline material is recognized by the PEM header marker anywhere in the text."""

    def test_the_marker(self) -> None:
        assert PEM_MARKER == "-----BEGIN"

    def test_pem_text_is_inline(self) -> None:
        assert is_pem(_PEM) is True

    def test_the_marker_after_leading_text_is_inline(self) -> None:
        assert is_pem(f"issued by the lab CA\n{_PEM}") is True

    @pytest.mark.parametrize("material", ["/etc/wave/ca.pem", "~/certs/ca.pem", "ca.pem", ""])
    def test_anything_else_is_a_path(self, material: str) -> None:
        assert is_pem(material) is False


class TestReadPem:
    """Inline PEM comes back unchanged; a path is read from the file it names."""

    def test_inline_pem_is_returned_unchanged(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.chdir(tmp_path)

        assert read_pem(_PEM) == _PEM

    def test_an_absolute_path_is_read(self, tmp_path: Path) -> None:
        path = _write(tmp_path / "ca.pem", _PEM)

        assert read_pem(str(path)) == _PEM

    def test_a_tilde_path_is_read_from_the_home_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HOME", str(tmp_path))
        _write(tmp_path / "certs" / "ca.pem", _PEM)

        assert read_pem("~/certs/ca.pem") == _PEM

    def test_a_relative_path_starts_from_the_home_folder_not_the_working_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home, work = tmp_path / "home", tmp_path / "work"
        _write(home / "certs" / "ca.pem", _PEM)
        _write(work / "certs" / "ca.pem", _OTHER_PEM)
        monkeypatch.setenv("HOME", str(home))
        monkeypatch.chdir(work)

        assert read_pem("certs/ca.pem") == _PEM

    def test_a_missing_file_raises_the_open_error(self, tmp_path: Path) -> None:
        missing = tmp_path / "missing.pem"
        message = f"[Errno 2] No such file or directory: '{missing}'"

        with pytest.raises(FileNotFoundError, match=f"^{re.escape(message)}$"):
            read_pem(str(missing))


class TestOneHome:
    """The rule lives only here; its former copies are gone and every reader imports it."""

    def test_the_http_block_has_no_reader_of_its_own(self) -> None:
        assert not hasattr(HTTPClientPlugin, "_resolve_pem")

    def test_the_ssh_session_has_no_marker_of_its_own(self) -> None:
        assert not hasattr(_ssh_session, "_PEM_MARKER")

    def test_the_built_bundle_defines_no_reader_of_its_own(self, bundle_tree: ast.Module) -> None:
        defined = {node.name for node in ast.walk(bundle_tree) if isinstance(node, ast.FunctionDef)}

        assert "_read_pem" not in defined

    def test_the_bundle_carries_the_module_as_its_source_on_disk(self) -> None:
        source = Path(inspect.getfile(_tls_material)).read_text(encoding="utf-8")

        assert _vendored_sources()[_MODULE] == source

    def test_the_worker_imports_the_module(self, bundle_tree: ast.Module) -> None:
        assert _MODULE in _imported(bundle_tree)

    @pytest.mark.parametrize("module", [http_client, _ssh_session], ids=["http", "ssh"])
    def test_each_local_reader_imports_the_module(self, module: ModuleType) -> None:
        tree = ast.parse(inspect.getsource(module))

        assert _MODULE in _imported(tree, package="wavecore.plugins")
