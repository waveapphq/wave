"""The one web address parser and the one Basic authorization value (REQ-4.7.14, REQ-5.1.2).

An address is split into its parts and given one normal form, `origin`: the scheme, the host
in lower case with an IPv6 host in brackets, and the port left out when it is the protocol's
default. The parser refuses only a scheme that is not http or https, a missing host and a
port outside 1 to 65535, in that order, and names the reason in one word: every caller shows
its own message. A login, a path, a query and a fragment are returned, never refused. A port
refusal carries the parts that were read, so a caller with its own order can keep it. The
error's text names no part of the address. The module rides to remote hosts, so it imports
the standard library only.
"""

import base64
from pathlib import Path

import pytest

from tests.core.remote_exec._vendorability import (
    imported_names,
    is_stdlib,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.connectivity import web_address
from wavecore.connectivity.web_address import (
    WebAddress,
    WebAddressError,
    basic_authorization,
    parse_web_address,
    typed_reason,
)

_PATH = Path(str(web_address.__file__))

SCHEME = "scheme"
HOST = "host"
PORT = "port"

EVERY_PART = "https://wave:os-secret@gw.internal:8443/a/b?x=1&y=2#top"
EVERY_PART_BAD_PORT = "https://wave:os-secret@gw.internal:0/a/b?x=1&y=2#top"

BROKEN_BRACKET_HOSTS = ["https://[::1", "https://[zz]", "https://[::1]x"]
BROKEN_BRACKET_IDS = ["unclosed-bracket", "no-address-in-brackets", "text-after-the-bracket"]


def _refusal(text: str) -> WebAddressError:
    """The error the parser raises for an address it refuses."""
    with pytest.raises(WebAddressError) as caught:
        parse_web_address(text)
    return caught.value


def _reason(text: str) -> str:
    """The one word the parser gives for refusing an address."""
    return _refusal(text).reason


class TestTheParts:
    """An accepted address comes back as its scheme, host and port."""

    def test_an_accepted_address_is_a_web_address(self) -> None:
        assert isinstance(parse_web_address("https://opensearch.internal:9200"), WebAddress)

    @pytest.mark.parametrize(
        ("text", "scheme", "host", "port"),
        [
            ("https://opensearch.internal:9200", "https", "opensearch.internal", 9200),
            ("http://opensearch.internal:9200", "http", "opensearch.internal", 9200),
            ("http://proxy-1.internal:3128", "http", "proxy-1.internal", 3128),
            ("https://localhost:6443", "https", "localhost", 6443),
            ("http://10.0.0.5:8080", "http", "10.0.0.5", 8080),
            ("https://127.0.0.1:9478", "https", "127.0.0.1", 9478),
        ],
        ids=["https-name", "http-name", "hyphenated-name", "one-label-name", "ipv4", "loopback"],
    )
    def test_a_name_or_an_ipv4_host_with_a_port(
        self, text: str, scheme: str, host: str, port: int
    ) -> None:
        address = parse_web_address(text)

        assert address.scheme == scheme
        assert address.host == host
        assert address.port == port

    @pytest.mark.parametrize("text", ["https://opensearch.internal", "http://10.0.0.5"])
    def test_an_address_without_a_port_holds_none(self, text: str) -> None:
        assert parse_web_address(text).port is None

    def test_an_ipv6_host_is_held_without_its_brackets(self) -> None:
        address = parse_web_address("https://[::1]:8443")

        assert address.host == "::1"
        assert address.port == 8443

    def test_an_ipv6_host_without_a_port(self) -> None:
        address = parse_web_address("http://[2001:db8::1]")

        assert address.host == "2001:db8::1"
        assert address.port is None

    @pytest.mark.parametrize(
        ("text", "scheme"),
        [
            ("HTTPS://Host.Example", "https"),
            ("HTTP://Host.Example:8080", "http"),
            ("HTTPS://[::1]:8443", "https"),
        ],
        ids=["https", "http", "https-ipv6"],
    )
    def test_an_upper_case_scheme_is_accepted_and_held_in_lower_case(
        self, text: str, scheme: str
    ) -> None:
        assert parse_web_address(text).scheme == scheme


class TestWhatIsReturnedNotRefused:
    """A login, a path, a query and a fragment come back in the fields."""

    def test_a_username_and_a_password(self) -> None:
        address = parse_web_address("https://wave:os-secret@opensearch.internal:9200")

        assert address.username == "wave"
        assert address.password == "os-secret"
        assert address.host == "opensearch.internal"
        assert address.port == 9200

    def test_a_username_alone_has_no_password(self) -> None:
        address = parse_web_address("http://wave@proxy.internal:3128")

        assert address.username == "wave"
        assert address.password is None
        assert address.host == "proxy.internal"

    def test_an_address_without_a_login_holds_none_for_both(self) -> None:
        address = parse_web_address("https://opensearch.internal:9200")

        assert address.username is None
        assert address.password is None

    def test_a_path(self) -> None:
        assert parse_web_address("https://k8s.internal:6443/api/v1").path == "/api/v1"

    def test_a_query(self) -> None:
        address = parse_web_address("https://opensearch.internal:9200/os?pretty=true&x=1")

        assert address.query == "pretty=true&x=1"
        assert address.path == "/os"

    def test_a_fragment(self) -> None:
        assert parse_web_address("https://opensearch.internal:9200#top").fragment == "top"

    def test_an_address_without_a_query_or_a_fragment_holds_empty_text(self) -> None:
        address = parse_web_address("https://opensearch.internal:9200/os")

        assert address.query == ""
        assert address.fragment == ""

    def test_every_part_at_once(self) -> None:
        address = parse_web_address(EVERY_PART)

        assert address.scheme == "https"
        assert address.host == "gw.internal"
        assert address.port == 8443
        assert address.username == "wave"
        assert address.password == "os-secret"
        assert address.path == "/a/b"
        assert address.query == "x=1&y=2"
        assert address.fragment == "top"


class TestPorts:
    """The written port, the protocol's default, and the one a connection uses."""

    @pytest.mark.parametrize(
        ("text", "default"),
        [
            ("http://a.example", 80),
            ("https://a.example", 443),
            ("http://a.example:8080", 80),
            ("https://a.example:8443", 443),
            ("https://[::1]:8443", 443),
        ],
    )
    def test_the_default_port_follows_the_scheme(self, text: str, default: int) -> None:
        assert parse_web_address(text).default_port == default

    @pytest.mark.parametrize(
        ("text", "effective"),
        [("http://a.example", 80), ("https://a.example", 443), ("https://[::1]", 443)],
    )
    def test_the_effective_port_is_the_default_when_none_is_written(
        self, text: str, effective: int
    ) -> None:
        assert parse_web_address(text).effective_port == effective

    @pytest.mark.parametrize(
        ("text", "port"),
        [
            ("https://a.example:8443", 8443),
            ("http://a.example:3128", 3128),
            ("https://a.example:443", 443),
            ("http://a.example:80", 80),
            ("https://a.example:80", 80),
            ("http://a.example:443", 443),
            ("https://[::1]:9200", 9200),
        ],
        ids=[
            "https-other",
            "http-other",
            "https-own-default",
            "http-own-default",
            "https-on-80",
            "http-on-443",
            "ipv6",
        ],
    )
    def test_a_written_port_is_the_port_and_the_effective_port(self, text: str, port: int) -> None:
        address = parse_web_address(text)

        assert address.port == port
        assert address.effective_port == port

    @pytest.mark.parametrize("port", [1, 65535])
    def test_the_port_range_ends_are_accepted(self, port: int) -> None:
        assert parse_web_address(f"https://a.example:{port}").port == port


class TestBracketedHost:
    """The host as it is written inside an address: only an IPv6 host takes brackets."""

    @pytest.mark.parametrize(
        ("text", "bracketed"),
        [
            ("https://opensearch.internal:9200", "opensearch.internal"),
            ("http://10.0.0.5:8080", "10.0.0.5"),
            ("https://[::1]:8443", "[::1]"),
            ("http://[2001:db8::1]", "[2001:db8::1]"),
        ],
        ids=["name", "ipv4", "ipv6-loopback", "ipv6"],
    )
    def test_the_bracketed_host(self, text: str, bracketed: str) -> None:
        assert parse_web_address(text).bracketed_host == bracketed


class TestTheNormalForm:
    """`origin` is the scheme, the host in lower case and the port unless it is the default."""

    @pytest.mark.parametrize(
        ("text", "origin"),
        [
            ("https://a.example", "https://a.example"),
            ("http://a.example:8080", "http://a.example:8080"),
            ("https://a.example:443", "https://a.example"),
            ("http://a.example:80", "http://a.example"),
            ("https://a.example:80", "https://a.example:80"),
            ("http://a.example:443", "http://a.example:443"),
            ("http://10.0.0.5:3128", "http://10.0.0.5:3128"),
            ("http://10.0.0.5:80", "http://10.0.0.5"),
        ],
        ids=[
            "https-no-port",
            "http-other-port",
            "https-default-written",
            "http-default-written",
            "https-on-80",
            "http-on-443",
            "ipv4-other-port",
            "ipv4-default-written",
        ],
    )
    def test_the_port_is_left_out_only_when_it_is_the_protocols_default(
        self, text: str, origin: str
    ) -> None:
        assert parse_web_address(text).origin == origin

    @pytest.mark.parametrize(
        ("text", "origin"),
        [
            ("https://A.Example:8443", "https://a.example:8443"),
            ("https://OPENSEARCH.INTERNAL", "https://opensearch.internal"),
            ("http://Proxy-1.Internal:80", "http://proxy-1.internal"),
            ("http://[2001:DB8::1]:8080", "http://[2001:db8::1]:8080"),
        ],
        ids=["mixed-case", "upper-case", "mixed-case-default-port", "ipv6-upper-case"],
    )
    def test_the_host_is_in_lower_case(self, text: str, origin: str) -> None:
        assert parse_web_address(text).origin == origin

    @pytest.mark.parametrize(
        ("text", "origin"),
        [
            ("HTTPS://Host.Example", "https://host.example"),
            ("HTTP://Host.Example:8080", "http://host.example:8080"),
            ("HTTPS://Host.Example:443/os", "https://host.example"),
            ("HTTP://Host.Example:80", "http://host.example"),
        ],
        ids=["https", "http-other-port", "https-default-written", "http-default-written"],
    )
    def test_an_upper_case_scheme_is_in_lower_case(self, text: str, origin: str) -> None:
        assert parse_web_address(text).origin == origin

    @pytest.mark.parametrize(
        ("text", "origin"),
        [
            ("https://[::1]", "https://[::1]"),
            ("https://[::1]:443", "https://[::1]"),
            ("https://[::1]:8443", "https://[::1]:8443"),
            ("http://[2001:db8::1]:80", "http://[2001:db8::1]"),
        ],
        ids=["no-port", "default-written", "other-port", "http-default-written"],
    )
    def test_an_ipv6_host_is_in_brackets(self, text: str, origin: str) -> None:
        assert parse_web_address(text).origin == origin

    @pytest.mark.parametrize(
        ("text", "origin"),
        [
            ("http://xyz.com/", "http://xyz.com"),
            ("https://k8s.internal:6443/api/v1", "https://k8s.internal:6443"),
            ("https://opensearch.internal:9200?pretty=true", "https://opensearch.internal:9200"),
            ("https://opensearch.internal#top", "https://opensearch.internal"),
            ("http://wave:os-secret@proxy.internal:3128", "http://proxy.internal:3128"),
            (EVERY_PART, "https://gw.internal:8443"),
        ],
        ids=["trailing-slash", "path", "query", "fragment", "login", "every-part"],
    )
    def test_a_login_a_path_a_query_and_a_fragment_are_left_out(
        self, text: str, origin: str
    ) -> None:
        assert parse_web_address(text).origin == origin


class TestRefusedAddresses:
    """Only three things are refused, each by its one-word reason."""

    def test_the_error_is_a_value_error(self) -> None:
        assert issubclass(WebAddressError, ValueError)

        with pytest.raises(ValueError):
            parse_web_address("ftp://a.example")

    @pytest.mark.parametrize(
        "text",
        [
            "ftp://opensearch.internal:9200",
            "ws://opensearch.internal:9200",
            "opensearch.internal:9200",
            "opensearch.internal",
            "",
            "//opensearch.internal:9200",
        ],
        ids=["ftp", "ws", "no-scheme-with-port", "no-scheme", "empty", "scheme-relative"],
    )
    def test_a_scheme_other_than_http_or_https(self, text: str) -> None:
        assert _reason(text) == SCHEME

    @pytest.mark.parametrize(
        "text",
        ["https://", "http://", "https://:9200", "http:///os", "https://?pretty", "https://#top"],
        ids=["https-only", "http-only", "port-only", "path-only", "query-only", "fragment-only"],
    )
    def test_no_host(self, text: str) -> None:
        assert _reason(text) == HOST

    @pytest.mark.parametrize("text", BROKEN_BRACKET_HOSTS, ids=BROKEN_BRACKET_IDS)
    def test_a_broken_bracket_host_is_no_host(self, text: str) -> None:
        assert _reason(text) == HOST

    @pytest.mark.parametrize(
        "text",
        [
            "https://opensearch.internal:0",
            "https://opensearch.internal:65536",
            "https://opensearch.internal:99999",
            "https://opensearch.internal:abc",
            "http://10.0.0.5:0",
            "https://[::1]:70000",
        ],
        ids=["zero", "just-above", "far-above", "not-a-number", "ipv4-zero", "ipv6-above"],
    )
    def test_a_port_outside_1_to_65535(self, text: str) -> None:
        assert _reason(text) == PORT


class TestTheOrderOfTheRefusals:
    """The scheme is checked first, then the host, then the port."""

    @pytest.mark.parametrize("text", ["ftp://", "ftp:///os", "opensearch.internal"])
    def test_the_scheme_is_checked_before_the_host(self, text: str) -> None:
        assert _reason(text) == SCHEME

    @pytest.mark.parametrize("text", ["ftp://opensearch.internal:0", "ftp://[::1]:70000"])
    def test_the_scheme_is_checked_before_the_port(self, text: str) -> None:
        assert _reason(text) == SCHEME

    def test_the_scheme_is_checked_before_the_host_and_the_port(self) -> None:
        assert _reason("ftp://:0") == SCHEME

    @pytest.mark.parametrize("text", ["ftp://[::1", "ftp://[zz]", "ws://[::1]x:0"])
    def test_the_scheme_is_checked_before_a_broken_bracket_host(self, text: str) -> None:
        assert _reason(text) == SCHEME

    @pytest.mark.parametrize("text", ["https://:0", "https://:99999", "http://:abc"])
    def test_the_host_is_checked_before_the_port(self, text: str) -> None:
        assert _reason(text) == HOST

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            ("ftp://wave:pw@opensearch.internal:9200", SCHEME),
            ("https://wave:pw@:9200", HOST),
            ("https://wave:pw@opensearch.internal:0", PORT),
        ],
        ids=["scheme", "host", "port"],
    )
    def test_a_login_changes_no_reason(self, text: str, reason: str) -> None:
        assert _reason(text) == reason

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            ("ftp://opensearch.internal:9200?pretty", SCHEME),
            ("https://:9200/os?pretty#top", HOST),
            ("https://opensearch.internal:99999?pretty", PORT),
            ("https://opensearch.internal:0#top", PORT),
        ],
        ids=["scheme", "host", "port-with-query", "port-with-fragment"],
    )
    def test_a_query_or_a_fragment_changes_no_reason(self, text: str, reason: str) -> None:
        assert _reason(text) == reason


class TestTheReasonForATypedAddress:
    """A block that shows its user the address they typed calls a missing "//" a wrong start."""

    @pytest.mark.parametrize(
        "text",
        [
            "https:/k8s.example",
            "https:k8s.example",
            "http:/k8s.example:8001",
            "HTTPS:k8s.example",
            "https:",
        ],
        ids=["one-slash", "no-slash", "plain-http-one-slash", "capitals-no-slash", "scheme-only"],
    )
    def test_no_host_without_both_slashes_is_a_wrong_start(self, text: str) -> None:
        refusal = _refusal(text)

        assert refusal.reason == HOST
        assert typed_reason(text, refusal) == SCHEME

    @pytest.mark.parametrize(
        "text",
        ["https://", "https://:6443", "https://wave@", "https:///path", *BROKEN_BRACKET_HOSTS],
        ids=["scheme-only", "port-only", "login-only", "path-only", *BROKEN_BRACKET_IDS],
    )
    def test_no_host_after_both_slashes_stays_no_host(self, text: str) -> None:
        assert typed_reason(text, _refusal(text)) == HOST

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            ("ftp://k8s.example", SCHEME),
            ("k8s.example:6443", SCHEME),
            ("", SCHEME),
            ("https://k8s.example:0", PORT),
            ("https://k8s.example:abc", PORT),
        ],
        ids=["another-scheme", "no-scheme", "empty", "port-zero", "port-not-a-number"],
    )
    def test_a_scheme_or_a_port_refusal_keeps_its_reason(self, text: str, reason: str) -> None:
        refusal = _refusal(text)

        assert refusal.reason == reason
        assert typed_reason(text, refusal) == reason


class TestWhatAPortRefusalCarries:
    """A port refusal carries the parts that were read, with no port."""

    @pytest.mark.parametrize(
        "text",
        [
            "https://opensearch.internal:0",
            "https://opensearch.internal:65536",
            "https://opensearch.internal:99999",
            "https://opensearch.internal:abc",
        ],
        ids=["zero", "just-above", "far-above", "not-a-number"],
    )
    def test_the_address_is_a_web_address_whose_port_is_none(self, text: str) -> None:
        error = _refusal(text)

        assert error.reason == PORT
        assert isinstance(error.address, WebAddress)
        assert error.address.port is None

    def test_the_scheme_and_the_host_are_carried(self) -> None:
        address = _refusal("http://opensearch.internal:0").address

        assert address.scheme == "http"
        assert address.host == "opensearch.internal"

    def test_a_login_is_carried(self) -> None:
        address = _refusal("https://wave:os-secret@opensearch.internal:0").address

        assert address.username == "wave"
        assert address.password == "os-secret"
        assert address.host == "opensearch.internal"
        assert address.port is None

    def test_no_login_is_carried_as_none_for_both(self) -> None:
        address = _refusal("https://opensearch.internal:99999").address

        assert address.username is None
        assert address.password is None

    def test_a_path_is_carried(self) -> None:
        assert _refusal("https://opensearch.internal:abc/os").address.path == "/os"

    def test_a_query_is_carried(self) -> None:
        assert _refusal("https://opensearch.internal:99999?pretty").address.query == "pretty"

    def test_every_part_is_carried(self) -> None:
        address = _refusal(EVERY_PART_BAD_PORT).address

        assert address.scheme == "https"
        assert address.host == "gw.internal"
        assert address.port is None
        assert address.username == "wave"
        assert address.password == "os-secret"
        assert address.path == "/a/b"
        assert address.query == "x=1&y=2"
        assert address.fragment == "top"


class TestTheErrorTextNamesNoPartOfTheAddress:
    """What the error says never repeats the login or the host, whatever the reason."""

    @pytest.mark.parametrize(
        "text",
        [
            "ftp://svc-reader:os-secret@opensearch.internal:9200",
            "https://svc-reader:os-secret@:9200",
            "https://svc-reader:os-secret@[opensearch.internal]",
            "https://svc-reader:os-secret@opensearch.internal:0",
            "https://svc-reader:os-secret@opensearch.internal:abc",
        ],
        ids=["scheme", "no-host", "broken-bracket-host", "port-zero", "port-not-a-number"],
    )
    def test_the_text_holds_no_password_no_username_and_no_host(self, text: str) -> None:
        shown = str(_refusal(text))

        assert "os-secret" not in shown
        assert "svc-reader" not in shown
        assert "opensearch.internal" not in shown


class TestBasicAuthorization:
    """The whole header value: the word Basic, then `username:password` in UTF-8 as Base64."""

    @pytest.mark.parametrize(
        ("username", "password", "value"),
        [
            ("wave", "os-secret", "Basic d2F2ZTpvcy1zZWNyZXQ="),
            ("svc", "a:b", "Basic c3ZjOmE6Yg=="),
            ("jürgen", "pässwörd", "Basic asO8cmdlbjpww6Rzc3fDtnJk"),
            ("名前", "密码", "Basic 5ZCN5YmNOuWvhueggQ=="),
        ],
        ids=["plain", "colon-in-the-password", "accented", "non-latin"],
    )
    def test_a_username_and_a_password(self, username: str, password: str, value: str) -> None:
        assert basic_authorization(username, password) == value

    def test_the_pair_is_encoded_as_utf8(self) -> None:
        word, _, encoded = basic_authorization("jürgen", "pässwörd").partition(" ")

        assert word == "Basic"
        assert base64.b64decode(encoded, validate=True) == "jürgen:pässwörd".encode()

    def test_a_username_with_an_empty_password(self) -> None:
        assert basic_authorization("wave", "") == "Basic d2F2ZTo="

    def test_no_password_is_the_empty_password(self) -> None:
        assert basic_authorization("wave", None) == "Basic d2F2ZTo="


class TestRidesToRemoteHosts:
    """Vendored cores parse addresses on remote hosts, so the module is carried verbatim."""

    def test_it_imports_only_the_standard_library(self) -> None:
        names = imported_names(web_address.__name__, _PATH)

        assert all(is_stdlib({name}) for name in names), names

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()
