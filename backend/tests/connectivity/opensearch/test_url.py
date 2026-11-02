"""Cluster URL rules and index-pattern path encoding (REQ-5.1.2, REQ-3.3.2.5, OS-11)."""

import pytest

from wavecore.connectivity.opensearch._errors import OpenSearchFailure
from wavecore.connectivity.opensearch._url import ClusterUrl, index_path, parse_cluster_url

NOT_HTTP = "Cluster URL must start with http:// or https://"
NO_HOST = "Cluster URL needs a host, such as https://opensearch.internal:9200"
CREDENTIALS_IN_URL = (
    "Cluster URL must not hold a username or password: put them in Username and Password"
)
QUERY_OR_FRAGMENT = "Cluster URL must not hold a query (?...) or fragment (#...)"
PORT_OUT_OF_RANGE = "Cluster URL port must be between 1 and 65535"


def _refused(text: str) -> OpenSearchFailure:
    with pytest.raises(OpenSearchFailure) as caught:
        parse_cluster_url(text)
    return caught.value


class TestAcceptedUrls:
    """The four cases of the URL table."""

    def test_an_https_url_with_a_port(self) -> None:
        url = parse_cluster_url("https://opensearch.internal:9200")

        assert url == ClusterUrl("https", "opensearch.internal", 9200, "", True)

    def test_an_http_url_turns_tls_off(self) -> None:
        url = parse_cluster_url("http://opensearch.internal:9200")

        assert url.tls is False
        assert url.scheme == "http"

    def test_a_gateway_path_becomes_the_prefix_without_its_trailing_slash(self) -> None:
        url = parse_cluster_url("http://127.0.0.1:9478/os/")

        assert url == ClusterUrl("http", "127.0.0.1", 9478, "/os", False)

    def test_a_path_without_a_trailing_slash_is_the_prefix(self) -> None:
        assert parse_cluster_url("http://127.0.0.1:9478/os").prefix == "/os"

    def test_a_nested_gateway_path_keeps_every_segment(self) -> None:
        assert parse_cluster_url("https://gw.internal:443/a/b/").prefix == "/a/b"

    def test_a_lone_trailing_slash_gives_no_prefix(self) -> None:
        assert parse_cluster_url("https://opensearch.internal:9200/").prefix == ""

    def test_https_without_a_port_is_443(self) -> None:
        url = parse_cluster_url("https://opensearch.internal")

        assert url.port == 443
        assert url.where == "opensearch.internal:443"

    def test_http_without_a_port_is_80(self) -> None:
        url = parse_cluster_url("http://opensearch.internal")

        assert url.port == 80
        assert url.where == "opensearch.internal:80"

    def test_an_ipv6_host_drops_its_brackets_and_where_restores_them(self) -> None:
        url = parse_cluster_url("https://[::1]:9200")

        assert url.host == "::1"
        assert url.port == 9200
        assert url.where == "[::1]:9200"

    def test_an_ipv6_host_without_a_port_names_the_default_port(self) -> None:
        assert parse_cluster_url("https://[::1]").where == "[::1]:443"

    def test_where_is_host_and_port(self) -> None:
        assert parse_cluster_url("http://127.0.0.1:9478/os/").where == "127.0.0.1:9478"

    @pytest.mark.parametrize("port", [1, 65535])
    def test_the_port_range_ends_are_accepted(self, port: int) -> None:
        assert parse_cluster_url(f"https://opensearch.internal:{port}").port == port

    def test_the_parsed_url_is_frozen(self) -> None:
        url = parse_cluster_url("https://opensearch.internal:9200")

        with pytest.raises(AttributeError):
            url.host = "elsewhere"


class TestRefusedUrls:
    """Reason Validation, checked in table order."""

    @pytest.mark.parametrize(
        "text",
        ["ftp://opensearch.internal:9200", "opensearch.internal:9200", "", "//opensearch:9200"],
        ids=["ftp", "no-scheme", "empty", "scheme-relative"],
    )
    def test_a_scheme_other_than_http_or_https(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == NOT_HTTP
        assert failure.reason == "Validation"

    @pytest.mark.parametrize("text", ["https://", "https://:9200", "http:///os"])
    def test_no_host(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == NO_HOST
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        [
            "https://wave:os-secret@opensearch.internal:9200",
            "https://wave@opensearch.internal:9200",
            "https://wave:@opensearch.internal",
        ],
        ids=["user-and-password", "user-only", "user-empty-password"],
    )
    def test_credentials_in_the_url(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == CREDENTIALS_IN_URL
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        [
            "https://@opensearch.internal:9200",
            "https://:os-secret@opensearch.internal:9200",
            "https://:@opensearch.internal",
        ],
        ids=["at-sign-only", "password-only", "empty-pair"],
    )
    def test_a_login_with_no_username_is_still_credentials(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == CREDENTIALS_IN_URL
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        [
            "https://opensearch.internal:9200/?pretty",
            "https://opensearch.internal:9200?pretty=true",
            "https://opensearch.internal:9200#top",
            "http://127.0.0.1:9478/os/?a=b#c",
        ],
        ids=["query-after-slash", "query", "fragment", "both"],
    )
    def test_a_query_or_a_fragment(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == QUERY_OR_FRAGMENT
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        [
            "https://opensearch.internal:9200?",
            "https://opensearch.internal:9200#",
            "http://127.0.0.1:9478/os/?",
            "https://opensearch.internal:99999?",
        ],
        ids=["question-mark", "hash", "after-a-path", "with-a-bad-port"],
    )
    def test_a_bare_question_mark_or_hash_is_a_query_or_a_fragment(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == QUERY_OR_FRAGMENT
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        [
            "https://opensearch.internal:0",
            "https://opensearch.internal:65536",
            "https://opensearch.internal:99999",
            "https://opensearch.internal:abc",
            "https://[::1]:70000",
        ],
        ids=["zero", "just-above", "far-above", "not-a-number", "ipv6-above"],
    )
    def test_a_port_outside_1_to_65535(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == PORT_OUT_OF_RANGE
        assert failure.reason == "Validation"

    def test_the_scheme_is_checked_before_the_credentials(self) -> None:
        assert _refused("ftp://wave:pw@opensearch.internal:9200").message == NOT_HTTP

    def test_the_host_is_checked_before_the_credentials(self) -> None:
        assert _refused("https://wave:pw@:9200").message == NO_HOST

    def test_the_credentials_are_checked_before_the_query(self) -> None:
        assert (
            _refused("https://wave:pw@opensearch.internal:9200?pretty").message
            == CREDENTIALS_IN_URL
        )

    def test_the_query_is_checked_before_the_port(self) -> None:
        assert _refused("https://opensearch.internal:99999?pretty").message == QUERY_OR_FRAGMENT

    @pytest.mark.parametrize(
        "text",
        [
            "https://wave:os-secret@opensearch.internal:0",
            "https://wave:os-secret@opensearch.internal:99999",
            "https://wave:os-secret@opensearch.internal:abc",
        ],
        ids=["zero", "far-above", "not-a-number"],
    )
    def test_the_credentials_are_checked_before_the_port(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == CREDENTIALS_IN_URL
        assert failure.reason == "Validation"

    @pytest.mark.parametrize(
        "text",
        ["https://[::1", "https://[zz]", "https://[::1]x"],
        ids=["unclosed-bracket", "no-address-in-brackets", "text-after-the-bracket"],
    )
    def test_a_broken_bracket_host_is_no_host(self, text: str) -> None:
        failure = _refused(text)

        assert failure.message == NO_HOST
        assert failure.reason == "Validation"


class TestIndexPath:
    """The whole Index pattern row is one encoded path segment (REQ-3.3.2.5)."""

    def test_date_math_a_list_and_an_exclusion_are_encoded_whole(self) -> None:
        path = index_path("", "<logs-{now/d}>,-logs-debug*", "_search")

        assert path == "/%3Clogs-%7Bnow%2Fd%7D%3E%2C-logs-debug%2A/_search"

    def test_the_prefix_leads_the_path(self) -> None:
        assert index_path("/os", "filebeat-*", "_field_caps") == "/os/filebeat-%2A/_field_caps"

    def test_a_blank_pattern_leaves_only_the_prefix_and_the_endpoint(self) -> None:
        assert index_path("/os", "", "_search") == "/os/_search"

    def test_a_blank_pattern_without_a_prefix(self) -> None:
        assert index_path("", "", "_search") == "/_search"

    def test_a_slash_inside_the_pattern_is_encoded(self) -> None:
        assert index_path("", "a/b", "_search") == "/a%2Fb/_search"

    def test_a_space_and_non_ascii_text_are_percent_encoded(self) -> None:
        assert index_path("", "logs é", "_search") == "/logs%20%C3%A9/_search"

    def test_a_plain_name_is_unchanged(self) -> None:
        assert index_path("", "logs-2026.09.25", "_search") == "/logs-2026.09.25/_search"
