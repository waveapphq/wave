"""A password written inside a URL is masked wherever a value or a line is shown (REQ-3.1.3.5).

Every `scheme://user:password@host` keeps its scheme, user, host and the rest, with the
password as the engine's placeholder; a URL with no password, and text that is no URL, stay
as they are.
"""

from pathlib import Path
from typing import Any

import pytest

from tests.core.remote_exec._vendorability import (
    imported_names,
    is_stdlib,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.connectivity import url_credentials
from wavecore.connectivity.url_credentials import (
    MASK,
    mask_url_passwords,
    mask_url_passwords_in,
)
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

_PATH = Path(str(url_credentials.__file__))


class TestMaskUrlPasswords:
    """The password part of every URL in a text."""

    @pytest.mark.parametrize(
        ("text", "shown"),
        [
            pytest.param(
                "https://wave:os-secret@127.0.0.1:9477",
                "https://wave:********@127.0.0.1:9477",
                id="user-and-password",
            ),
            pytest.param(
                "https://wave:pw@opensearch.internal:9200/os?pretty#top",
                "https://wave:********@opensearch.internal:9200/os?pretty#top",
                id="path-query-fragment-kept",
            ),
            pytest.param(
                "redis://:pw@cache.internal:6379",
                "redis://:********@cache.internal:6379",
                id="no-user",
            ),
            pytest.param(
                "postgresql://app:pw@db.internal/orders",
                "postgresql://app:********@db.internal/orders",
                id="any-scheme",
            ),
            pytest.param(
                "https://wave:p@ss@host.internal",
                "https://wave:********@host.internal",
                id="at-sign",
            ),
            pytest.param(
                "https://wave:a:b@host.internal", "https://wave:********@host.internal", id="colon"
            ),
            pytest.param(
                "http://[::1]:9200 and http://u:pw@[::1]:9200",
                "http://[::1]:9200 and http://u:********@[::1]:9200",
                id="several-urls",
            ),
            pytest.param(
                '{"url":"https://u:pw@h.internal/x","mail":"ann@example.com"}',
                '{"url":"https://u:********@h.internal/x","mail":"ann@example.com"}',
                id="inside-json-text",
            ),
            pytest.param(
                "https://h.internal/x?next=http://u:pw@i.internal",
                "https://h.internal/x?next=http://u:********@i.internal",
                id="url-inside-a-query",
            ),
        ],
    )
    def test_the_password_is_masked(self, text: str, shown: str) -> None:
        assert mask_url_passwords(text) == shown

    @pytest.mark.parametrize(
        "text",
        [
            pytest.param("https://opensearch.internal:9200", id="no-userinfo"),
            pytest.param("https://wave@opensearch.internal:9200", id="user-only"),
            pytest.param("https://wave:@opensearch.internal", id="empty-password"),
            pytest.param("wave:secret@opensearch.internal", id="no-scheme"),
            pytest.param("mailto:ann@example.com", id="not-hierarchical"),
            pytest.param("", id="empty"),
        ],
    )
    def test_text_without_a_url_password_is_unchanged(self, text: str) -> None:
        assert mask_url_passwords(text) == text

    def test_the_mask_is_the_engine_placeholder(self) -> None:
        assert MASK == MASK_PLACEHOLDER


class TestMaskUrlPasswordsIn:
    """Every text inside a value: lists, tuples and maps are walked, other values pass."""

    def test_texts_inside_maps_and_lists(self) -> None:
        value = {
            "proxy": "http://u:pw@proxy.internal:3128",
            "hosts": ["https://a:pw@h1.internal", ("https://b:pw@h2.internal",)],
            "port": 9200,
        }

        assert mask_url_passwords_in(value) == {
            "proxy": "http://u:********@proxy.internal:3128",
            "hosts": ["https://a:********@h1.internal", ["https://b:********@h2.internal"]],
            "port": 9200,
        }

    @pytest.mark.parametrize("value", [None, True, 7, 2.5])
    def test_other_values_pass_through(self, value: Any) -> None:
        assert mask_url_passwords_in(value) is value


class TestRidesToRemoteHosts:
    """The OpenSearch core masks its request lines with it on a remote host too."""

    def test_it_imports_only_the_standard_library(self) -> None:
        names = imported_names(url_credentials.__name__, _PATH)

        assert names and all(is_stdlib({name}) for name in names), names

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()
