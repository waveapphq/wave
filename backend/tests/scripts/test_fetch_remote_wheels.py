"""Tests for scripts/lib/fetch-remote-wheels.sh against a fake PyPI that drops requests."""

import hashlib
import json
import re
import sys
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from tests.scripts.script_support import Repo, Run, copy_from_clone, run

SCRIPT = "scripts/lib/fetch-remote-wheels.sh"
WHEEL = "fixwheel-1.0.0-py3-none-any.whl"
WHEEL_BYTES = b"a wheel for the fetch test"
JSON_PATH = "/pypi/fixwheel/1.0.0/json"
FILE_PATH = f"/files/{WHEEL}"
FAILED = re.compile(r"^Download failed after 4 tries: " + re.escape(WHEEL) + r" \(.+\)$")


@dataclass
class FakePyPI:
    """Serves one release's JSON and its wheel; drops the first N requests of each path."""

    url: str = ""
    drops: dict[str, int] = field(default_factory=dict)
    hits: dict[str, int] = field(default_factory=dict)

    def count(self, path: str) -> int:
        return self.hits.get(path, 0)


@pytest.fixture
def pypi() -> Iterator[FakePyPI]:
    fake = FakePyPI()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the http.server hook name
            path = self.path.split("?")[0]
            fake.hits[path] = fake.hits.get(path, 0) + 1
            if fake.hits[path] <= fake.drops.get(path, 0):
                # A dropped connection: no status line, the socket just closes.
                self.close_connection = True
                self.wfile.flush()
                self.connection.shutdown(2)
                return
            body: bytes
            if path == JSON_PATH:
                body = json.dumps(
                    {"urls": [{"filename": WHEEL, "url": f"{fake.url}{FILE_PATH}"}]}
                ).encode()
            elif path == FILE_PATH:
                body = WHEEL_BYTES
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    fake.url = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield fake
    server.shutdown()
    server.server_close()


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    lock = {
        "wheels": [
            {
                "file": WHEEL,
                "sha256": hashlib.sha256(WHEEL_BYTES).hexdigest(),
                "package": "fixwheel",
                "python": ["3.12"],
                "machine": "x86_64",
                "libc": "glibc",
            }
        ]
    }
    tree.write("backend/vendor/wheels.lock", [json.dumps(lock)])
    return tree


def fetch(repo: Repo, pypi: FakePyPI, tmp_path: Path) -> Run:
    if "WAVE_PYPI_URL" not in (repo.root / SCRIPT).read_text(encoding="utf-8"):
        # Without the override the copy would call the real PyPI.
        pytest.fail(f"{SCRIPT} does not read WAVE_PYPI_URL; the test does not run it.")
    temp = tmp_path / "temp"
    temp.mkdir(exist_ok=True)
    env = {
        "PATH": "/usr/bin:/bin",
        "HOME": str(tmp_path),
        "LANG": "C.UTF-8",
        "TMPDIR": str(temp),
        "PYTHON": sys.executable,
        "WAVE_PYPI_URL": pypi.url,
        "WAVE_FETCH_RETRY_SECONDS": "0",
    }
    return run(repo, ["bash", str(repo.root / SCRIPT)], env)


def fetched(repo: Repo) -> Path:
    return repo.root / "backend" / "vendor" / "wheels" / WHEEL


class TestRetries:
    """Each JSON call and each download is tried up to 3 more times."""

    def test_the_fake_pypi_url_serves_the_wheel(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        result = fetch(repo, pypi, tmp_path)

        assert result.code == 0, result.lines
        assert fetched(repo).read_bytes() == WHEEL_BYTES
        assert pypi.count(JSON_PATH) == 1
        assert pypi.count(FILE_PATH) == 1

    def test_a_download_dropped_twice_is_fetched_on_the_third_try(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {FILE_PATH: 2}

        result = fetch(repo, pypi, tmp_path)

        assert result.code == 0, result.lines
        assert fetched(repo).read_bytes() == WHEEL_BYTES
        assert pypi.count(FILE_PATH) == 3
        assert f"fetched {WHEEL}" in result.lines

    def test_a_json_call_dropped_twice_is_read_on_the_third_try(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {JSON_PATH: 2}

        result = fetch(repo, pypi, tmp_path)

        assert result.code == 0, result.lines
        assert fetched(repo).read_bytes() == WHEEL_BYTES
        assert pypi.count(JSON_PATH) == 3

    def test_a_download_dropped_three_times_is_fetched_on_the_fourth_try(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {FILE_PATH: 3}

        result = fetch(repo, pypi, tmp_path)

        assert result.code == 0, result.lines
        assert pypi.count(FILE_PATH) == 4


class TestGivingUp:
    """After 4 tries the script exits 1 naming the file and the last error."""

    def test_a_download_dropped_four_times_fails(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {FILE_PATH: 4}

        result = fetch(repo, pypi, tmp_path)

        assert result.code == 1, result.lines
        assert [line for line in result.lines if FAILED.match(line)], result.lines
        assert pypi.count(FILE_PATH) == 4
        assert not fetched(repo).exists()

    def test_a_json_call_dropped_four_times_fails(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {JSON_PATH: 4}

        result = fetch(repo, pypi, tmp_path)

        assert result.code == 1, result.lines
        assert [line for line in result.lines if FAILED.match(line)], result.lines
        assert pypi.count(JSON_PATH) == 4
        assert pypi.count(FILE_PATH) == 0

    def test_no_partial_file_is_left_behind(
        self, repo: Repo, pypi: FakePyPI, tmp_path: Path
    ) -> None:
        pypi.drops = {FILE_PATH: 4}

        fetch(repo, pypi, tmp_path)

        wheels = repo.root / "backend" / "vendor" / "wheels"
        assert sorted(p.name for p in wheels.iterdir()) == []
