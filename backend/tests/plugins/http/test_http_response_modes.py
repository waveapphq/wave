"""HTTP response modes: body capture vs file download (REQ-3.4.1.4).

`response_mode` is an Assert-style single/split enum (`body` default / `file`).
File mode streams the response into the execution's artifacts via the
streaming writer; the `body` output carries the resulting path (an artifact
reference on WAVE), `sha256` carries the hex digest of what landed on disk,
`size` the bytes received/written. Both modes honor `max_size`: empty means
1 MB in body mode and unlimited in file mode; exceeding the cap truncates
what is kept and logs a WARN (`Response size exceeded <cap> - truncated`),
the node still succeeds, and there is no truncated-flag output. A response
of exactly the cap is NOT truncated.

Naming: an explicit `file_path` is the full WAVE-side target, resolved through
the write flavor of the shared plugin path resolver and written as given - an
existing file is replaced, never uniquified. An empty `file_path` keeps the
derived naming (Content-Disposition filename > URL path basename > `response`),
lands in the run's artifacts, invents no extension, and uniquifies a collision
with a numeric suffix before the extension (`report-2.pdf`).
"""

import base64
import hashlib
import re
from typing import Any
from unittest.mock import Mock, call, patch

import pytest

from tests.plugins.http.httpx_fakes import make_mock_client, patch_async_client

_CAP_1MB = 1048576
_READ_ONLY_MESSAGE = (
    "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
)


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


def _context(parameters: dict[str, Any], **extra: Any) -> dict[str, Any]:
    context: dict[str, Any] = {"parameters": parameters, "logger": Mock(), "variables": {}}
    context.update(extra)
    return context


def _warnings(logger: Mock) -> list[str]:
    return [str(call.args[0]) for call in logger.warning.call_args_list if call.args]


class TestResponseModeMetadata:
    """New response parameters and outputs."""

    def test_response_mode_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        response_mode = params["response_mode"]
        assert response_mode["type"] == "string"
        assert response_mode["required"] is True
        assert response_mode["default"] == "body"
        assert response_mode["enum_values"] == ["body", "file"]

    def test_file_path_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        file_path = params["file_path"]
        assert file_path["type"] == "string"
        assert file_path["required"] is False
        assert file_path["trim"] is True

    def test_the_file_name_parameter_is_gone(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        names = {p["name"] for p in HTTPClientPlugin().metadata["parameters"]}

        assert "file_name" not in names

    def test_the_request_config_carries_file_path_and_not_file_name(self):
        from dataclasses import fields

        from wavecore.plugins.http_client import HTTPRequestConfig

        names = {field.name for field in fields(HTTPRequestConfig)}

        assert "file_path" in names
        assert "file_name" not in names

    def test_max_size_parameter_definition(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        params = {p["name"]: p for p in HTTPClientPlugin().metadata["parameters"]}

        max_size = params["max_size"]
        assert max_size["type"] == "integer"
        assert max_size["required"] is False
        # Empty default: 1 MB in body mode / unlimited in file mode.
        assert max_size.get("default") is None

    def test_output_schema_gains_size_sha256_trace(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        outputs = {o["name"]: o for o in HTTPClientPlugin().metadata["output_schema"]}

        assert outputs["size"]["type"] == "integer"
        assert outputs["sha256"]["type"] == "string"
        assert outputs["trace"]["type"] == "map"
        # Existing outputs keep name and type.
        assert outputs["body"]["type"] == "string"
        assert outputs["status_code"]["type"] == "integer"


class TestResponseModeValidation:
    @pytest.mark.asyncio
    async def test_invalid_response_mode_rejected_with_enum_message(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'response_mode' must be one of: "
                r"body, file; "
                r"Actual value was 'stream'\.$"
            ),
        ):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "response_mode": "stream"}
            )

    @pytest.mark.asyncio
    async def test_max_size_must_be_positive(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(ValueError, match="^Parameter 'max_size' must be positive$"):
            await plugin.validate({"method": "GET", "url": "http://example.com", "max_size": 0})

    @pytest.mark.asyncio
    async def test_max_size_must_be_a_number(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()

        with pytest.raises(TypeError, match="^Parameter 'max_size' must be a number$"):
            await plugin.validate(
                {"method": "GET", "url": "http://example.com", "max_size": "1024"}
            )


class TestBodyModeOutputs:
    """Default mode: body carries the response text, sha256 empty, size in bytes."""

    @pytest.mark.asyncio
    async def test_body_mode_populates_size_and_empty_sha256(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"hello response")

        result = await plugin.execute(
            _context({"method": "GET", "url": f"{http_server.base_url}/data"})
        )

        assert result["body"] == "hello response"
        assert result["size"] == len(b"hello response")
        assert result["sha256"] == ""

    @pytest.mark.asyncio
    async def test_explicit_body_mode_matches_default(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"explicit")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/data",
                    "response_mode": "body",
                }
            )
        )

        assert result["body"] == "explicit"
        assert result["sha256"] == ""


class TestBodyModeCap:
    """Cap in body mode: default 1 MB, WARN + truncate, node succeeds."""

    @pytest.mark.asyncio
    async def test_default_cap_truncates_at_one_megabyte_with_warn(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"x" * (_CAP_1MB + 1))

        context = _context({"method": "GET", "url": f"{http_server.base_url}/big"})
        context["logger"] = logger
        result = await plugin.execute(context)

        assert result["status_code"] == 200
        assert len(result["body"]) == _CAP_1MB
        assert result["size"] == _CAP_1MB
        assert "Response size exceeded 1.0 MB - truncated" in _warnings(logger)
        assert "truncated" not in result, "no truncated-flag output (noise)"

    @pytest.mark.asyncio
    async def test_explicit_cap_truncates_with_warn(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"y" * 2048)

        context = _context(
            {"method": "GET", "url": f"{http_server.base_url}/big", "max_size": 1024}
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        assert result["status_code"] == 200
        assert len(result["body"]) == 1024
        assert "Response size exceeded 1.0 KB - truncated" in _warnings(logger)

    @pytest.mark.asyncio
    async def test_sub_kilobyte_cap_renders_the_warn_in_bytes(self, http_server):
        """The cap in the WARN humanizes as plain bytes below 1 KB."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"b" * 600)

        context = _context({"method": "GET", "url": f"{http_server.base_url}/big", "max_size": 512})
        context["logger"] = logger
        result = await plugin.execute(context)

        assert result["status_code"] == 200
        assert len(result["body"]) == 512
        assert "Response size exceeded 512 B - truncated" in _warnings(logger)

    @pytest.mark.asyncio
    async def test_response_of_exactly_the_cap_is_not_truncated(self, http_server):
        """Cap boundary: exactly-at-cap keeps everything and stays silent."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"z" * 1024)

        context = _context(
            {"method": "GET", "url": f"{http_server.base_url}/exact", "max_size": 1024}
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        assert len(result["body"]) == 1024
        assert result["size"] == 1024
        assert not any("Response size exceeded" in msg for msg in _warnings(logger))

    @pytest.mark.asyncio
    async def test_response_under_the_cap_is_untouched(self, http_server):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"small")

        context = _context(
            {"method": "GET", "url": f"{http_server.base_url}/small", "max_size": 1024}
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        assert result["body"] == "small"
        assert not any("Response size exceeded" in msg for msg in _warnings(logger))


class TestFileModeDownload:
    """File mode streams to the execution artifacts; body output = the path."""

    @pytest.mark.asyncio
    async def test_download_lands_in_artifacts_with_url_basename(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        payload = b"%PDF-1.7 fake-pdf-bytes"
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=payload, content_type="application/pdf")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/files/report.pdf",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        landed = tmp_path / "report.pdf"
        assert landed.read_bytes() == payload
        assert result["body"] == "artifact://report.pdf"
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()
        assert result["size"] == len(payload)
        assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_content_disposition_filename_beats_url_basename(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(
            body=b"a,b\n",
            headers=[("Content-Disposition", 'attachment; filename="export.csv"')],
        )

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "export.csv").read_bytes() == b"a,b\n"
        assert result["body"] == "artifact://export.csv"

    @pytest.mark.asyncio
    async def test_explicit_file_path_beats_content_disposition(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(
            body=b"bytes",
            headers=[("Content-Disposition", 'attachment; filename="export.csv"')],
        )

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": "artifact://custom.bin",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "custom.bin").read_bytes() == b"bytes"
        assert result["body"] == "artifact://custom.bin"

    @pytest.mark.asyncio
    async def test_no_basename_and_no_disposition_falls_back_to_response(
        self, http_server, tmp_path
    ):
        """Last resort name is `response`; no extension is invented."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"root-body")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "response").read_bytes() == b"root-body"
        assert result["body"] == "artifact://response"

    @pytest.mark.asyncio
    async def test_empty_response_lands_as_an_empty_artifact(self, http_server, tmp_path):
        """An empty download still produces the artifact file (zero bytes)."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/files/empty.bin",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "empty.bin").read_bytes() == b""
        assert result["body"] == "artifact://empty.bin"
        assert result["size"] == 0
        assert result["sha256"] == hashlib.sha256(b"").hexdigest()

    @pytest.mark.asyncio
    async def test_name_collision_uniquifies_with_numeric_suffix(self, http_server, tmp_path):
        """The store's writers overwrite silently, so the PLUGIN uniquifies."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "report.pdf").write_bytes(b"already-there")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"second-download")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/files/report.pdf",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "report.pdf").read_bytes() == b"already-there"
        assert (tmp_path / "report-2.pdf").read_bytes() == b"second-download"
        assert result["body"] == "artifact://report-2.pdf"

    @pytest.mark.asyncio
    async def test_second_collision_increments_the_suffix(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "report.pdf").write_bytes(b"one")
        (tmp_path / "report-2.pdf").write_bytes(b"two")
        plugin = HTTPClientPlugin()
        http_server.enqueue(body=b"three")

        result = await plugin.execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/files/report.pdf",
                    "response_mode": "file",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "report-3.pdf").read_bytes() == b"three"
        assert result["body"] == "artifact://report-3.pdf"


class TestFileModeExplicitPath:
    """An explicit File Path is the full WAVE-side target, resolved through the write flavor."""

    @pytest.mark.asyncio
    async def test_a_nested_artifact_path_creates_its_folders(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"payload")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": "artifact://reports/q1/data.bin",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "reports" / "q1" / "data.bin").read_bytes() == b"payload"
        assert result["body"] == "artifact://reports/q1/data.bin"

    @pytest.mark.asyncio
    async def test_an_explicit_path_replaces_an_existing_file(self, http_server, tmp_path):
        """The target is the name the user asked for: no numbered suffix."""
        from wavecore.plugins.http_client import HTTPClientPlugin

        (tmp_path / "report.pdf").write_bytes(b"already-there")
        http_server.enqueue(body=b"second-download")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/files/report.pdf",
                    "response_mode": "file",
                    "file_path": "artifact://report.pdf",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "report.pdf").read_bytes() == b"second-download"
        assert not (tmp_path / "report-2.pdf").exists()
        assert result["body"] == "artifact://report.pdf"

    @pytest.mark.asyncio
    async def test_an_absolute_path_outside_the_artifacts_answers_that_path(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        target = tmp_path / "elsewhere" / "out.bin"
        http_server.enqueue(body=b"payload")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": str(target),
                },
                artifacts_dir=str(tmp_path / "runs"),
            )
        )

        assert target.read_bytes() == b"payload"
        assert result["body"] == str(target)

    @pytest.mark.asyncio
    async def test_an_absolute_path_inside_the_artifacts_answers_a_reference(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"payload")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": str(tmp_path / "reports" / "out.bin"),
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "reports" / "out.bin").read_bytes() == b"payload"
        assert result["body"] == "artifact://reports/out.bin"

    @pytest.mark.asyncio
    async def test_a_relative_path_is_written_under_the_server_users_home(
        self, http_server, tmp_path, monkeypatch, server_home
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"payload")
        monkeypatch.chdir(tmp_path)

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": "downloads/out.bin",
                },
                artifacts_dir=str(tmp_path / "artifacts"),
            )
        )

        assert (server_home / "downloads" / "out.bin").read_bytes() == b"payload"
        assert result["body"] == str(server_home / "downloads" / "out.bin")
        assert not (tmp_path / "downloads").exists()

    @pytest.mark.asyncio
    async def test_an_explicit_path_with_no_artifacts_directory_answers_that_path(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        target = tmp_path / "out.bin"
        http_server.enqueue(body=b"payload")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": str(target),
                }
            )
        )

        assert target.read_bytes() == b"payload"
        assert result["body"] == str(target)

    @pytest.mark.asyncio
    async def test_the_size_and_digest_are_of_what_landed(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        payload = b"%PDF-1.7 fake-pdf-bytes"
        http_server.enqueue(body=payload, content_type="application/pdf")

        result = await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": "artifact://out.pdf",
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert result["size"] == len(payload)
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()

    @pytest.mark.asyncio
    async def test_the_explicit_path_is_resolved_through_the_write_flavor(
        self, http_server, tmp_path
    ):
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"payload")

        with patch(
            "wavecore.plugins.http_client.resolve_plugin_path",
            return_value=tmp_path / "out.bin",
        ) as resolver:
            await HTTPClientPlugin().execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/download/blob",
                        "response_mode": "file",
                        "file_path": "artifact://out.bin",
                    },
                    artifacts_dir=str(tmp_path),
                    testdata_dirs=[str(tmp_path / "testdata")],
                )
            )

        assert resolver.call_args_list == [
            call(
                "artifact://out.bin",
                str(tmp_path),
                [str(tmp_path / "testdata")],
                read_only_ok=False,
            )
        ]

    @pytest.mark.asyncio
    async def test_a_testdata_target_is_refused(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        http_server.enqueue(body=b"payload")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            await HTTPClientPlugin().execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/download/blob",
                        "response_mode": "file",
                        "file_path": "testdata://out.bin",
                    },
                    artifacts_dir=str(tmp_path),
                    testdata_dirs=[str(tmp_path / "testdata")],
                )
            )

    @pytest.mark.asyncio
    async def test_an_absolute_target_inside_test_data_is_refused(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        testdata = tmp_path / "testdata"
        testdata.mkdir()
        http_server.enqueue(body=b"payload")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            await HTTPClientPlugin().execute(
                _context(
                    {
                        "method": "GET",
                        "url": f"{http_server.base_url}/download/blob",
                        "response_mode": "file",
                        "file_path": str(testdata / "out.bin"),
                    },
                    artifacts_dir=str(tmp_path / "runs"),
                    testdata_dirs=[str(testdata)],
                )
            )

    @pytest.mark.asyncio
    async def test_a_target_beside_the_artifacts_is_written_there(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        http_server.enqueue(body=b"payload")

        await HTTPClientPlugin().execute(
            _context(
                {
                    "method": "GET",
                    "url": f"{http_server.base_url}/download/blob",
                    "response_mode": "file",
                    "file_path": "artifact://../beside.bin",
                },
                artifacts_dir=str(artifacts),
            )
        )

        assert (tmp_path / "beside.bin").read_bytes() == b"payload"


class TestFileModeCap:
    """Cap in file mode: empty = unlimited; explicit cap truncates on disk."""

    @pytest.mark.asyncio
    async def test_empty_cap_is_unlimited_in_file_mode(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        payload = b"f" * (_CAP_1MB + 1)
        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=payload)

        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/files/big.bin",
                "response_mode": "file",
            },
            artifacts_dir=str(tmp_path),
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        assert (tmp_path / "big.bin").stat().st_size == _CAP_1MB + 1
        assert result["size"] == _CAP_1MB + 1
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()
        assert not any("Response size exceeded" in msg for msg in _warnings(logger))

    @pytest.mark.asyncio
    async def test_explicit_cap_truncates_the_file_with_warn(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=b"g" * 4096)

        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/files/capped.bin",
                "response_mode": "file",
                "max_size": 1024,
            },
            artifacts_dir=str(tmp_path),
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        kept = (tmp_path / "capped.bin").read_bytes()
        assert kept == b"g" * 1024
        assert result["size"] == 1024
        # The digest is of what landed on disk, i.e. the truncated bytes.
        assert result["sha256"] == hashlib.sha256(kept).hexdigest()
        assert "Response size exceeded 1.0 KB - truncated" in _warnings(logger)
        assert result["status_code"] == 200

    @pytest.mark.asyncio
    async def test_file_of_exactly_the_cap_is_not_truncated(self, http_server, tmp_path):
        from wavecore.plugins.http_client import HTTPClientPlugin

        payload = b"h" * 1024
        plugin = HTTPClientPlugin()
        logger = Mock()
        http_server.enqueue(body=payload)

        context = _context(
            {
                "method": "GET",
                "url": f"{http_server.base_url}/files/exact.bin",
                "response_mode": "file",
                "max_size": 1024,
            },
            artifacts_dir=str(tmp_path),
        )
        context["logger"] = logger
        result = await plugin.execute(context)

        assert (tmp_path / "exact.bin").read_bytes() == payload
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()
        assert not any("Response size exceeded" in msg for msg in _warnings(logger))


class TestHTTPPluginBinaryResponse:
    """Body-mode binary responses stay base64-encoded (migrated, unchanged)."""

    @pytest.mark.asyncio
    async def test_binary_response_base64_encoded(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        binary_data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

        client, _ = make_mock_client(
            headers={"Content-Type": "image/png"},
            content=binary_data,
            url="http://example.com/image.png",
        )

        with patch_async_client(client):
            result = await plugin.execute(
                _context({"method": "GET", "url": "http://example.com/image.png"})
            )

        assert result["content_type"] == "image/png"
        assert base64.b64decode(result["body"]) == binary_data


class TestHTTPPluginEmptyResponseBody:
    """Empty bodies (204 No Content) stay empty (migrated, unchanged)."""

    @pytest.mark.asyncio
    async def test_204_no_content_empty_body(self):
        from wavecore.plugins.http_client import HTTPClientPlugin

        plugin = HTTPClientPlugin()
        client, _ = make_mock_client(status_code=204, text="", url="http://example.com/delete")

        with patch_async_client(client):
            result = await plugin.execute(
                _context({"method": "DELETE", "url": "http://example.com/delete"})
            )

        assert result["status_code"] == 204
        assert result["body"] == ""
