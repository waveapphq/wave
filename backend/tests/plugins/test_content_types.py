"""WAVE's own file-type table (REQ-3.4.3.10).

A file's content type comes from its extension in one fixed table, never from the WAVE
host's file-type configuration, so every WAVE host names the same file the same way.
"""

import ast
import inspect
import mimetypes
import sys
from typing import Any

import pytest

from wavecore.plugins import _content_types
from wavecore.plugins._content_types import content_type_for

_OCTET_STREAM = "application/octet-stream"

_TABLE = [
    (".txt", "text/plain"),
    (".csv", "text/csv"),
    (".tsv", "text/tab-separated-values"),
    (".html", "text/html"),
    (".htm", "text/html"),
    (".css", "text/css"),
    (".js", "text/javascript"),
    (".mjs", "text/javascript"),
    (".ts", "text/typescript"),
    (".md", "text/markdown"),
    (".py", "text/x-python"),
    (".xml", "application/xml"),
    (".json", "application/json"),
    (".jsonl", "application/jsonl"),
    (".ndjson", "application/x-ndjson"),
    (".yaml", "application/yaml"),
    (".yml", "application/yaml"),
    (".toml", "application/toml"),
    (".sql", "application/sql"),
    (".sh", "application/x-sh"),
    (".pdf", "application/pdf"),
    (".zip", "application/zip"),
    (".gz", "application/gzip"),
    (".tgz", "application/gzip"),
    (".tar", "application/x-tar"),
    (".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    (".xls", "application/vnd.ms-excel"),
    (".ods", "application/vnd.oasis.opendocument.spreadsheet"),
    (".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    (".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    (".png", "image/png"),
    (".jpg", "image/jpeg"),
    (".jpeg", "image/jpeg"),
    (".gif", "image/gif"),
    (".svg", "image/svg+xml"),
    (".webp", "image/webp"),
    (".bmp", "image/bmp"),
    (".ico", "image/vnd.microsoft.icon"),
    (".mp3", "audio/mpeg"),
    (".wav", "audio/wav"),
    (".mp4", "video/mp4"),
    (".webm", "video/webm"),
    (".wasm", "application/wasm"),
    (".pem", "application/x-pem-file"),
    (".crt", "application/x-x509-ca-cert"),
    (".cer", "application/x-x509-ca-cert"),
    (".bin", _OCTET_STREAM),
]


def _imported_roots(tree: ast.AST) -> set[str]:
    """The top-level package of every module an import in the tree names."""
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            roots.add("<relative>" if node.level else str(node.module).split(".")[0])
    return roots


class TestTableEntries:
    """Every extension of the table maps to its one content type."""

    @pytest.mark.parametrize(("extension", "content_type"), _TABLE)
    def test_an_extension_maps_to_its_type(self, extension: str, content_type: str) -> None:
        assert content_type_for(f"sample{extension}") == content_type


class TestExtensionMatching:
    """The extension is matched ignoring case, and only the last one counts."""

    @pytest.mark.parametrize(("extension", "content_type"), _TABLE)
    def test_an_upper_case_extension_maps_to_the_same_type(
        self, extension: str, content_type: str
    ) -> None:
        assert content_type_for(f"SAMPLE{extension.upper()}") == content_type

    @pytest.mark.parametrize(
        ("file_name", "content_type"),
        [
            ("Report.Ts", "text/typescript"),
            ("values.YaML", "application/yaml"),
            ("Sheet.XlsX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ],
    )
    def test_a_mixed_case_extension_maps_to_the_same_type(
        self, file_name: str, content_type: str
    ) -> None:
        assert content_type_for(file_name) == content_type

    @pytest.mark.parametrize(
        ("file_name", "content_type"),
        [
            ("report.v1.html", "text/html"),
            ("archive.tar.gz", "application/gzip"),
            ("report.json.gz", "application/gzip"),
            ("values.yaml.txt", "text/plain"),
            ("export.unknownext.csv", "text/csv"),
            ("export.csv.unknownext", _OCTET_STREAM),
        ],
    )
    def test_a_name_with_several_dots_uses_the_last_extension(
        self, file_name: str, content_type: str
    ) -> None:
        assert content_type_for(file_name) == content_type


class TestUnknownNames:
    """A name the table does not know is generic binary data."""

    @pytest.mark.parametrize("file_name", ["README", "no_extension_file"])
    def test_a_name_without_an_extension_is_octet_stream(self, file_name: str) -> None:
        assert content_type_for(file_name) == _OCTET_STREAM

    @pytest.mark.parametrize("file_name", ["payload.unknownext", "PAYLOAD.UNKNOWNEXT"])
    def test_an_unknown_extension_is_octet_stream(self, file_name: str) -> None:
        assert content_type_for(file_name) == _OCTET_STREAM


class TestTheTableIsWavesOwn:
    """The module needs nothing but the standard library and never asks the host."""

    def test_it_imports_only_the_standard_library(self) -> None:
        imported = _imported_roots(ast.parse(inspect.getsource(_content_types)))

        assert imported <= sys.stdlib_module_names

    def test_it_never_imports_mimetypes(self) -> None:
        imported = _imported_roots(ast.parse(inspect.getsource(_content_types)))

        assert "mimetypes" not in imported

    def test_a_lookup_never_consults_the_host_table(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: list[str] = []

        def host_answer(*_args: Any, **_kwargs: Any) -> tuple[str, None]:
            seen.append("guess_type")
            return ("application/x-host-table", None)

        monkeypatch.setattr(mimetypes, "guess_type", host_answer)
        monkeypatch.setattr(mimetypes, "init", lambda *_args, **_kwargs: seen.append("init"))

        assert content_type_for("client.ts") == "text/typescript"
        assert content_type_for("payload.unknownext") == _OCTET_STREAM
        assert seen == []
