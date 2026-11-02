"""Shared fake-httpx helpers for the HTTP plugin test files.

The plugin drives httpx.AsyncClient (pure-Python, no C extension), so tests
that assert call shapes mock that layer: httpx.AsyncClient(verify=,
follow_redirects=, max_redirects=, timeout=) is an async context manager, and
client.request(method=, url=, params=, headers=, content=, ...) returns a
Response with status_code / headers / text / content / reason_phrase / url.
Wire-level tests use the real local server fixtures from conftest instead.
"""

import contextlib
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock, patch


@contextlib.contextmanager
def patch_async_client(client: Any) -> Iterator[MagicMock]:
    """Patch httpx.AsyncClient with a real class returning the fake client.

    A real class keeps the plugin's isinstance backend-swap guard working: the
    fake client is not an instance of it, so the swap is skipped. The yielded
    recorder mock captures constructor kwargs like a patched-class mock would.
    """
    recorder = MagicMock()

    class _FakeAsyncClient:
        def __new__(cls, **kwargs: Any) -> Any:
            recorder(**kwargs)
            return client

    with patch("httpx.AsyncClient", _FakeAsyncClient):
        yield recorder


def make_response(
    status_code: int = 200,
    headers: dict[str, str] | None = None,
    text: str = "",
    content: bytes | None = None,
    reason_phrase: str = "OK",
    url: str = "http://example.com/",
) -> Mock:
    """Build a fake httpx.Response (body already read: text/content are plain)."""
    resp = Mock()
    resp.status_code = status_code
    resp.headers = headers if headers is not None else {}
    resp.text = text
    resp.content = content if content is not None else text.encode()
    resp.reason_phrase = reason_phrase
    resp.url = url
    return resp


def make_client(request: AsyncMock) -> AsyncMock:
    """Wrap a request AsyncMock in a fake httpx.AsyncClient async context manager."""
    client = AsyncMock()
    client.request = request
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def make_mock_client(**response_kwargs: Any) -> tuple[AsyncMock, Mock]:
    """A fake client whose single request returns one response from the given kwargs."""
    resp = make_response(**response_kwargs)
    return make_client(AsyncMock(return_value=resp)), resp
