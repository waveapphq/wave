"""The route decision of the Proxy setting (REQ-4.7.14).

An address is compared in one normal form: protocol, host in lower case with an IPv6 host
compressed and in brackets, and the port left out when it is the protocol's default. This file
holds the rules of the address list entries, the test for a local address, the address list
decision of a Custom proxy, the NO_PROXY decision of the WAVE host's settings, the reading of
one WAVE host proxy value and the time limit on matching one regular expression.
"""

import re
import time
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

import pytest

from wavecore.api.services.network import _proxy_addresses
from wavecore.api.services.network._proxy_addresses import (
    is_local,
    list_rule,
    no_proxy_rule,
    normalize_entry,
    parse_host_proxy,
    validate_entries,
)
from wavecore.connectivity.proxy import ProxyEndpoint, ProxyError

KIND = "Choose Exact or Regex"
REQUIRED = "An address is required"
TOO_LONG = "An address must be 256 characters or fewer"
EXACT_FORM = "An exact address is http:// or https://, a host and an optional port"
AFTER_HOST = "Remove everything after the host and port"
NOT_A_LIST = "The address list must be a list of entries with a kind and an address"
TOO_MANY = "The address list holds at most 100 entries"

# The two modes' answers for one address, "except" first; True means through the proxy.
MATCHED = (False, True)
NOT_MATCHED = (True, False)

LOCAL_HOSTS = ["localhost", "LOCALHOST", "127.0.0.1", "127.8.8.8", "::1"]
MATCHES_EVERYTHING = ".*"

# Alternatives that overlap make the engine try every split of the run of letters.
BACKTRACKING = "(a|aa)+$"
STUCK_HOST = "a" * 60 + ".example"
LOWERED_LIMIT_S = 0.005
SHIPPED_LIMIT_S = 0.1
LIMIT_MARGIN_S = 0.05


def whole(message: str) -> str:
    return f"^{re.escape(message)}$"


def exact(address: str) -> dict[str, str]:
    return {"kind": "exact", "address": address}


def pattern(address: str) -> dict[str, str]:
    return {"kind": "regex", "address": address}


def problem(row: int | None, message: str) -> dict[str, Any]:
    return {"row": row, "message": message}


def same(row: int) -> str:
    return f"The same address as entry {row}"


def not_a_regex(reason: str) -> str:
    return f"Not a valid regular expression: {reason}"


def by_row(problems: list[dict[str, Any]]) -> dict[int | None, str]:
    """The message of each row, after checking each problem's shape and one problem per row."""
    assert all(set(found) == {"row", "message"} for found in problems)
    rows = [found["row"] for found in problems]
    assert len(rows) == len(set(rows))
    return {found["row"]: found["message"] for found in problems}


def decisions(
    entries: list[dict[str, str]], scheme: str, host: str, port: int, proxy_local: bool = False
) -> tuple[bool, bool]:
    """What the "except" and the "only" mode answer for one address, in that order."""
    return (
        list_rule("except", entries, proxy_local)(scheme, host, port),
        list_rule("only", entries, proxy_local)(scheme, host, port),
    )


def no_proxy_answer(no_proxy: str, host: str, scheme: str = "https", port: int = 443) -> bool:
    return no_proxy_rule(no_proxy)(scheme, host, port)


def too_slow(address: str) -> str:
    return whole(f"Proxy address list: the pattern {BACKTRACKING} took too long to match {address}")


def unusable(value: str) -> str:
    return whole(
        f"This WAVE host's proxy address {value} is not an http:// address: "
        "choose Custom or turn the proxy off"
    )


class TestNormalForm:
    """An Exact entry is stored as protocol, host and port in the one normal form."""

    @pytest.mark.parametrize(
        ("typed", "normal"),
        [
            ("https://A.Example", "https://a.example"),
            ("http://BUILD.Corp.Example:8080", "http://build.corp.example:8080"),
        ],
        ids=["mixed-case", "upper-case-with-port"],
    )
    def test_the_host_is_put_in_lower_case(self, typed: str, normal: str) -> None:
        assert normalize_entry("exact", typed) == normal

    @pytest.mark.parametrize(
        ("typed", "normal"),
        [
            ("https://a.example:443", "https://a.example"),
            ("http://a.example:80", "http://a.example"),
            ("https://a.example", "https://a.example"),
            ("http://a.example", "http://a.example"),
        ],
        ids=["https-443", "http-80", "https-no-port", "http-no-port"],
    )
    def test_the_default_port_of_the_protocol_is_left_out(self, typed: str, normal: str) -> None:
        assert normalize_entry("exact", typed) == normal

    def test_an_address_with_its_default_port_equals_the_one_without(self) -> None:
        with_port = normalize_entry("exact", "https://a.example:443")

        assert with_port == normalize_entry("exact", "https://a.example")

    @pytest.mark.parametrize(
        ("typed", "normal"),
        [
            ("https://a.example:8443", "https://a.example:8443"),
            ("http://a.example:443", "http://a.example:443"),
            ("https://a.example:80", "https://a.example:80"),
            ("http://10.1.2.3:3128", "http://10.1.2.3:3128"),
        ],
        ids=["https-8443", "http-on-443", "https-on-80", "ipv4"],
    )
    def test_any_other_port_is_kept(self, typed: str, normal: str) -> None:
        assert normalize_entry("exact", typed) == normal

    @pytest.mark.parametrize(
        ("typed", "normal"),
        [
            ("https://[2001:db8::1]", "https://[2001:db8::1]"),
            ("https://[2001:db8::1]:443", "https://[2001:db8::1]"),
            ("http://[2001:db8::1]:8080", "http://[2001:db8::1]:8080"),
            ("https://[2001:DB8::1]:8443", "https://[2001:db8::1]:8443"),
            ("https://[2001:db8:0:0:0:0:0:1]", "https://[2001:db8::1]"),
            (
                "https://[2001:0db8:0000:0000:0000:0000:0000:0001]:8443",
                "https://[2001:db8::1]:8443",
            ),
            ("http://[0:0:0:0:0:0:0:1]:8080", "http://[::1]:8080"),
        ],
        ids=[
            "short-form",
            "default-port",
            "other-port",
            "upper-case",
            "zero-groups",
            "leading-zeros",
            "loopback-written-in-full",
        ],
    )
    def test_an_ipv6_host_is_compressed_and_in_brackets(self, typed: str, normal: str) -> None:
        assert normalize_entry("exact", typed) == normal

    @pytest.mark.parametrize(
        "typed",
        [
            r"^HTTPS://.*\.Corp\.Example$",
            r"corp\.example:443/",
            r"(?<=Build\d*)\.Corp\.Example$",
            "https://A.Example:443",
        ],
        ids=["upper-case", "default-port-and-slash", "lookbehind", "reads-like-an-address"],
    )
    def test_a_regex_entry_is_kept_as_typed(self, typed: str) -> None:
        assert normalize_entry("regex", typed) == typed


class TestWholeListProblems:
    """A problem of the list as a whole carries no row."""

    def test_an_empty_list_has_no_problem(self) -> None:
        assert validate_entries([]) == []

    def test_a_list_of_valid_entries_has_no_problem(self) -> None:
        entries = [
            exact("https://a.example"),
            exact("http://A.Example:8080"),
            exact("https://b.example:443"),
            exact("https://10.1.2.3"),
            exact("https://[2001:db8::1]:8443"),
            pattern(r"\.corp\.example$"),
            pattern(r"^https://build\d+\."),
        ]

        assert validate_entries(entries) == []

    @pytest.mark.parametrize(
        "entries",
        ["https://a.example", {"kind": "exact", "address": "https://a.example"}, 5],
        ids=["text", "one-entry-outside-a-list", "number"],
    )
    def test_a_value_that_is_not_a_list(self, entries: Any) -> None:
        assert validate_entries(entries) == [problem(None, NOT_A_LIST)]

    @pytest.mark.parametrize(
        "item",
        [
            "https://a.example",
            ["exact", "https://a.example"],
            {"kind": "exact"},
            {"address": "https://a.example"},
            {},
            5,
            None,
        ],
        ids=["text", "pair", "no-address", "no-kind", "empty-map", "number", "nothing"],
    )
    def test_an_item_that_is_not_an_entry_with_a_kind_and_an_address(self, item: Any) -> None:
        assert validate_entries([exact("https://a.example"), item]) == [problem(None, NOT_A_LIST)]

    def test_100_entries_are_accepted(self) -> None:
        entries = [exact(f"https://host-{number}.example") for number in range(100)]

        assert validate_entries(entries) == []

    def test_more_than_100_entries(self) -> None:
        entries = [exact(f"https://host-{number}.example") for number in range(101)]

        assert validate_entries(entries) == [problem(None, TOO_MANY)]


class TestEntryMessages:
    """Each rule of one entry gives its own message, with the row counted from 1."""

    @pytest.mark.parametrize("kind", ["substring", "glob", ""], ids=["substring", "glob", "empty"])
    def test_a_kind_that_is_neither_exact_nor_regex(self, kind: str) -> None:
        entries = [{"kind": kind, "address": "https://a.example"}]

        assert validate_entries(entries) == [problem(1, KIND)]

    @pytest.mark.parametrize("kind", ["exact", "regex"])
    @pytest.mark.parametrize("address", ["", "   "], ids=["empty", "spaces"])
    def test_a_blank_address(self, kind: str, address: str) -> None:
        entries = [{"kind": kind, "address": address}]

        assert validate_entries(entries) == [problem(1, REQUIRED)]

    def test_an_exact_address_of_256_characters_is_accepted(self) -> None:
        address = "https://" + ".".join(["a" * 63, "b" * 63, "c" * 63, "d" * 56])

        assert len(address) == 256
        assert validate_entries([exact(address)]) == []

    def test_a_regex_of_256_characters_is_accepted(self) -> None:
        assert validate_entries([pattern("a" * 256)]) == []

    @pytest.mark.parametrize(
        "entry",
        [exact("https://" + "a" * 249), pattern("a" * 257)],
        ids=["exact", "regex"],
    )
    def test_an_address_longer_than_256_characters(self, entry: dict[str, str]) -> None:
        assert len(entry["address"]) == 257
        assert validate_entries([entry]) == [problem(1, TOO_LONG)]

    @pytest.mark.parametrize(
        "address",
        [
            "a.example",
            "a.example:8080",
            "//a.example",
            "ftp://a.example",
            "ws://a.example",
            "socks5://a.example:1080",
            "https://",
            "http://:8080",
            "https://wave@a.example",
            "https://wave:secret@a.example:8443",
            "https://a.example?x=1",
            "https://a.example:8443?x=1",
            "https://a.example#top",
        ],
        ids=[
            "no-protocol",
            "no-protocol-with-port",
            "no-protocol-with-slashes",
            "ftp",
            "ws",
            "socks5",
            "no-host",
            "no-host-with-port",
            "username",
            "username-and-password",
            "query",
            "query-after-port",
            "fragment",
        ],
    )
    def test_an_exact_address_that_is_not_protocol_host_and_optional_port(
        self, address: str
    ) -> None:
        assert validate_entries([exact(address)]) == [problem(1, EXACT_FORM)]

    @pytest.mark.parametrize(
        "address",
        [
            "http://a.example:0",
            "http://a.example:99999",
            "http://a.example:abc",
            "https://a.example:65536",
        ],
        ids=["zero", "too-large", "not-a-number", "one-above-the-largest"],
    )
    def test_an_exact_address_with_a_port_that_is_not_1_to_65535(self, address: str) -> None:
        assert validate_entries([exact(address)]) == [problem(1, EXACT_FORM)]

    @pytest.mark.parametrize(
        "address",
        ["https://a.example?", "https://a.example:8443?", "https://a.example#"],
        ids=["bare-query-mark", "bare-query-mark-after-port", "bare-fragment-mark"],
    )
    def test_an_exact_address_with_a_bare_query_or_fragment_mark(self, address: str) -> None:
        assert validate_entries([exact(address)]) == [problem(1, EXACT_FORM)]

    @pytest.mark.parametrize(
        "address",
        ["https://a b.example", "https://a.example ", "https://a..example", "https://a$b.example"],
        ids=["space", "space-at-the-end", "empty-label", "other-character"],
    )
    def test_an_exact_address_whose_host_is_no_host_name(self, address: str) -> None:
        assert validate_entries([exact(address)]) == [problem(1, EXACT_FORM)]

    def test_the_smallest_and_the_largest_port_are_accepted(self) -> None:
        entries = [exact("http://a.example:1"), exact("https://a.example:65535")]

        assert validate_entries(entries) == []

    @pytest.mark.parametrize(
        "address",
        [
            "https://a.example/",
            "http://xyz.com/",
            "https://a.example:8443/",
            "https://a.example/path",
            "https://a.example:8443/api/v1",
            "https://[2001:db8::1]:8443/",
        ],
        ids=["slash", "http-slash", "slash-after-port", "path", "path-after-port", "ipv6-slash"],
    )
    def test_an_exact_address_with_a_path_or_a_trailing_slash(self, address: str) -> None:
        assert validate_entries([exact(address)]) == [problem(1, AFTER_HOST)]

    def test_an_address_and_its_copy_with_a_slash_cannot_both_be_stored(self) -> None:
        entries = [exact("http://xyz.com"), exact("http://xyz.com/")]

        assert validate_entries(entries) == [problem(2, AFTER_HOST)]

    def test_the_row_number_is_counted_from_1(self) -> None:
        entries = [exact("https://a.example"), pattern(r"\.corp\.example$"), exact("b.example")]

        assert validate_entries(entries) == [problem(3, EXACT_FORM)]


class TestRegexEntriesAreCompiledByTheRunTimeEngine:
    """Save judges a regular expression with the engine that matches it in a run."""

    @pytest.mark.parametrize(
        ("typed", "reason"),
        [
            ("(", "missing ) at position 1"),
            (r"\.cluster\.local(:\d+", "missing ) at position 21"),
            ("[a-z", "unterminated character set at position 4"),
            ("*.corp.example", "nothing to repeat at position 0"),
            ("corp.example)", "unbalanced parenthesis at position 12"),
        ],
        ids=["open-group", "open-group-at-the-end", "open-set", "leading-star", "stray-close"],
    )
    def test_a_regex_that_does_not_compile_is_refused_with_the_engines_reason(
        self, typed: str, reason: str
    ) -> None:
        assert validate_entries([pattern(typed)]) == [problem(1, not_a_regex(reason))]

    def test_a_regex_the_standard_library_accepts_and_the_engine_refuses(self) -> None:
        entries = [pattern("a{e<=x}")]

        assert validate_entries(entries) == [
            problem(1, not_a_regex("bad fuzzy cost limit at position 5"))
        ]

    @pytest.mark.parametrize(
        "typed",
        [
            r"(?<=build\d*)\.corp\.example$",
            r"(?<!dev|staging)\.corp\.example$",
            r"\p{Ll}+\.corp\.example",
        ],
        ids=["lookbehind-of-any-length", "lookbehind-of-two-lengths", "unicode-property"],
    )
    def test_a_regex_only_the_engine_accepts_is_valid(self, typed: str) -> None:
        assert validate_entries([pattern(typed)]) == []

    def test_an_exact_address_is_never_read_as_a_regex(self) -> None:
        assert validate_entries([exact("(")]) == [problem(1, EXACT_FORM)]


class TestDuplicates:
    """The later of two equal entries is refused and names the earlier row."""

    @pytest.mark.parametrize(
        ("first", "second"),
        [
            ("https://a.example", "https://a.example"),
            ("https://a.example", "https://A.EXAMPLE"),
            ("https://a.example", "https://a.example:443"),
            ("http://a.example:80", "http://A.Example"),
            ("https://[2001:db8::1]", "https://[2001:DB8:0:0:0:0:0:1]:443"),
        ],
        ids=["same-text", "case", "default-port", "case-and-default-port", "ipv6-written-in-full"],
    )
    def test_two_exact_entries_with_the_same_normal_form(self, first: str, second: str) -> None:
        assert validate_entries([exact(first), exact(second)]) == [problem(2, same(1))]

    def test_exact_entries_that_differ_in_protocol_or_port_are_not_duplicates(self) -> None:
        entries = [
            exact("https://a.example"),
            exact("http://a.example"),
            exact("https://a.example:8443"),
            exact("https://b.a.example"),
        ]

        assert validate_entries(entries) == []

    def test_two_regex_entries_with_the_same_text(self) -> None:
        entries = [pattern(r"\.corp\.example$"), pattern(r"\.corp\.example$")]

        assert validate_entries(entries) == [problem(2, same(1))]

    def test_regex_entries_that_differ_in_case_are_not_duplicates(self) -> None:
        entries = [pattern(r"\.corp\.example$"), pattern(r"\.CORP\.example$")]

        assert validate_entries(entries) == []

    def test_an_exact_and_a_regex_entry_with_the_same_text_are_not_duplicates(self) -> None:
        entries = [exact("https://a.example"), pattern("https://a.example")]

        assert validate_entries(entries) == []

    def test_the_message_names_the_row_of_the_earlier_entry(self) -> None:
        entries = [
            exact("https://a.example"),
            pattern(r"\.corp\.example$"),
            exact("https://b.example"),
            pattern(r"\.corp\.example$"),
            exact("https://B.Example:443"),
        ]

        assert by_row(validate_entries(entries)) == {4: same(2), 5: same(3)}

    def test_every_later_copy_names_the_first_entry(self) -> None:
        entries = [
            exact("https://a.example"),
            exact("https://A.Example"),
            exact("https://a.example"),
        ]

        assert by_row(validate_entries(entries)) == {2: same(1), 3: same(1)}


class TestEveryBadRowIsReported:
    """The answer holds one problem for each bad row, not only the first."""

    def test_each_bad_row_gets_its_own_problem(self) -> None:
        entries = [
            exact("https://a.example"),
            {"kind": "substring", "address": "a.example"},
            exact(""),
            pattern(r"\.corp\.example$"),
            pattern("("),
            exact("https://a.example/path"),
            exact("https://A.Example:443"),
            exact("ftp://a.example"),
            pattern("a" * 257),
        ]

        assert by_row(validate_entries(entries)) == {
            2: KIND,
            3: REQUIRED,
            5: not_a_regex("missing ) at position 1"),
            6: AFTER_HOST,
            7: same(1),
            8: EXACT_FORM,
            9: TOO_LONG,
        }

    def test_two_rows_with_the_same_mistake_are_both_reported(self) -> None:
        entries = [exact("http://xyz.com/"), exact("http://xyz.com/")]

        assert by_row(validate_entries(entries)) == {1: AFTER_HOST, 2: AFTER_HOST}


class TestTheFirstRuleInOrderWins:
    """A row with several mistakes gets one problem: the first in rule order."""

    @pytest.mark.parametrize(
        ("entry", "message"),
        [
            ({"kind": "substring", "address": ""}, KIND),
            ({"kind": "substring", "address": "a" * 257}, KIND),
            ({"kind": "substring", "address": "https://a.example/"}, KIND),
            (exact("   "), REQUIRED),
            (exact("a" * 257), TOO_LONG),
            (exact("https://a.example/" + "a" * 239), TOO_LONG),
            (pattern("(" * 257), TOO_LONG),
            (exact("https://wave@a.example/path"), EXACT_FORM),
            (exact("https://a.example/path?x=1"), EXACT_FORM),
            (exact("https://a.example/#top"), EXACT_FORM),
            (exact("ftp://a.example/"), EXACT_FORM),
            (exact("http://a.example:99999/path"), EXACT_FORM),
        ],
        ids=[
            "kind-before-blank",
            "kind-before-length",
            "kind-before-slash",
            "blank-before-form",
            "length-before-form",
            "length-before-slash",
            "length-before-compile",
            "login-before-path",
            "query-before-path",
            "fragment-before-slash",
            "protocol-before-slash",
            "port-before-path",
        ],
    )
    def test_one_problem_for_a_row_with_several_mistakes(
        self, entry: dict[str, str], message: str
    ) -> None:
        assert validate_entries([entry]) == [problem(1, message)]

    def test_a_refused_row_is_not_also_reported_as_a_duplicate(self) -> None:
        entries = [pattern("("), pattern("(")]

        reason = not_a_regex("missing ) at position 1")
        assert by_row(validate_entries(entries)) == {1: reason, 2: reason}


class TestLocalAddresses:
    """localhost, every 127.x.x.x address and ::1 are local."""

    @pytest.mark.parametrize(
        "host",
        ["localhost", "127.0.0.1", "127.8.8.8", "127.0.0.0", "127.255.255.255", "::1"],
    )
    def test_a_local_address(self, host: str) -> None:
        assert is_local(host) is True

    @pytest.mark.parametrize("host", ["LOCALHOST", "LocalHost"])
    def test_case_is_ignored(self, host: str) -> None:
        assert is_local(host) is True

    @pytest.mark.parametrize(
        "host",
        [
            "a.example",
            "localhost.example",
            "128.0.0.1",
            "126.255.255.255",
            "10.1.2.3",
            "::2",
            "2001:db8::1",
        ],
    )
    def test_an_address_that_is_not_local(self, host: str) -> None:
        assert is_local(host) is False


class TestListRuleExactEntries:
    """An Exact entry matches when its protocol, host and port equal the address."""

    def test_an_empty_list_sends_everything_through_the_proxy_in_except_mode(self) -> None:
        through_proxy = list_rule("except", [], False)

        assert through_proxy("https", "a.example", 443) is True
        assert through_proxy("http", "10.1.2.3", 8080) is True

    @pytest.mark.parametrize(
        ("entry", "target", "answers"),
        [
            ("https://a.example", ("https", "a.example", 443), MATCHED),
            ("https://a.example", ("https", "A.Example", 443), MATCHED),
            ("https://a.example", ("http", "a.example", 80), NOT_MATCHED),
            ("https://a.example", ("https", "a.example", 8443), NOT_MATCHED),
            ("https://a.example", ("https", "b.a.example", 443), NOT_MATCHED),
            ("https://a.example", ("https", "a.example.evil.test", 443), NOT_MATCHED),
            ("https://a.example", ("https", "axexample", 443), NOT_MATCHED),
            ("https://a.example:8443", ("https", "a.example", 8443), MATCHED),
            ("https://a.example:8443", ("https", "a.example", 443), NOT_MATCHED),
            ("http://a.example", ("http", "a.example", 80), MATCHED),
            ("http://a.example", ("http", "a.example", 8080), NOT_MATCHED),
            ("http://10.1.2.3:3128", ("http", "10.1.2.3", 3128), MATCHED),
            ("http://10.1.2.3:3128", ("http", "10.1.2.30", 3128), NOT_MATCHED),
            ("https://[2001:db8::1]:8443", ("https", "2001:db8::1", 8443), MATCHED),
            ("https://[2001:db8::1]:8443", ("https", "2001:DB8:0:0:0:0:0:1", 8443), MATCHED),
            ("https://[2001:db8::1]", ("https", "2001:db8::1", 443), MATCHED),
            ("https://[2001:db8::1]", ("https", "2001:db8::2", 443), NOT_MATCHED),
        ],
        ids=[
            "same-address",
            "host-in-upper-case",
            "other-protocol",
            "other-port",
            "subdomain",
            "longer-name",
            "dot-is-not-a-wildcard",
            "port-written",
            "port-written-default-asked",
            "http-default-port",
            "http-other-port",
            "ipv4",
            "ipv4-longer",
            "ipv6",
            "ipv6-written-in-full",
            "ipv6-default-port",
            "ipv6-other-address",
        ],
    )
    def test_an_exact_entry_in_both_modes(
        self, entry: str, target: tuple[str, str, int], answers: tuple[bool, bool]
    ) -> None:
        assert decisions([exact(entry)], *target) == answers

    def test_any_entry_of_the_list_can_match(self) -> None:
        entries = [
            exact("https://a.example"),
            pattern(r"\.corp\.example$"),
            exact("http://b.example"),
        ]

        assert decisions(entries, "https", "a.example", 443) == MATCHED
        assert decisions(entries, "https", "build.corp.example", 443) == MATCHED
        assert decisions(entries, "http", "b.example", 80) == MATCHED
        assert decisions(entries, "https", "c.example", 443) == NOT_MATCHED

    @pytest.mark.parametrize(
        ("entry", "target"),
        [
            ("https://A.Example:443", ("https", "a.example", 443)),
            ("HTTP://a.example:80", ("http", "a.example", 80)),
            ("https://[2001:DB8:0:0:0:0:0:1]:8443", ("https", "2001:db8::1", 8443)),
        ],
        ids=["case-and-default-port", "protocol-in-upper-case", "ipv6-written-in-full"],
    )
    def test_an_exact_entry_stored_in_another_spelling_matches_by_its_normal_form(
        self, entry: str, target: tuple[str, str, int]
    ) -> None:
        assert decisions([exact(entry)], *target) == MATCHED


class TestListRuleRegexEntries:
    """A Regex entry matches when it is found anywhere in the address, ignoring case."""

    @pytest.mark.parametrize(
        ("typed", "target", "answers"),
        [
            (r"corp\.example", ("https", "build.corp.example", 8443), MATCHED),
            (r"corp\.example", ("https", "corp.example.evil.test", 443), MATCHED),
            (r"corp\.example", ("https", "build.corp.test", 443), NOT_MATCHED),
            (r"CORP\.EXAMPLE", ("https", "build.corp.example", 443), MATCHED),
            (r"corp\.example", ("https", "BUILD.CORP.EXAMPLE", 443), MATCHED),
            (r"^corp\.example", ("https", "corp.example", 443), NOT_MATCHED),
            (r"^https://corp\.", ("https", "corp.example", 443), MATCHED),
            (r"^https://corp\.", ("http", "corp.example", 80), NOT_MATCHED),
            (r"^https://corp\.", ("https", "build.corp.example", 443), NOT_MATCHED),
            (r"corp\.example$", ("https", "build.corp.example", 443), MATCHED),
            (r"corp\.example$", ("https", "build.corp.example", 8443), NOT_MATCHED),
            (r"corp\.example$", ("https", "corp.example.evil.test", 443), NOT_MATCHED),
            (r"^https://a\.example$", ("https", "a.example", 443), MATCHED),
            (r"^https://a\.example$", ("https", "a.example", 8443), NOT_MATCHED),
            (r"^https://a\.example$", ("http", "a.example", 80), NOT_MATCHED),
            (r"^a\.example$", ("https", "a.example", 443), NOT_MATCHED),
        ],
        ids=[
            "found-in-the-middle",
            "found-before-the-end",
            "not-found",
            "pattern-in-upper-case",
            "host-in-upper-case",
            "start-is-the-protocol",
            "start-with-the-protocol",
            "start-with-another-protocol",
            "start-then-another-host",
            "end-of-the-address",
            "end-is-after-the-port",
            "end-of-a-longer-name",
            "whole-address",
            "whole-address-other-port",
            "whole-address-other-protocol",
            "host-alone-is-not-the-address",
        ],
    )
    def test_a_regex_entry_in_both_modes(
        self, typed: str, target: tuple[str, str, int], answers: tuple[bool, bool]
    ) -> None:
        assert decisions([pattern(typed)], *target) == answers

    @pytest.mark.parametrize(
        ("typed", "target", "answers"),
        [
            (r":443$", ("https", "a.example", 443), NOT_MATCHED),
            (r":80$", ("http", "a.example", 80), NOT_MATCHED),
            (r":8443$", ("https", "a.example", 8443), MATCHED),
            (r":80$", ("https", "a.example", 80), MATCHED),
            (r"^http://", ("http", "a.example", 80), MATCHED),
            (r"^http://", ("https", "a.example", 443), NOT_MATCHED),
            (r"^https://\[2001:db8::1\]:8443$", ("https", "2001:db8::1", 8443), MATCHED),
            (r"^https://\[2001:db8::1\]:8443$", ("https", "2001:DB8:0:0:0:0:0:1", 8443), MATCHED),
            (r"^https://\[2001:db8::1\]$", ("https", "2001:db8::1", 443), MATCHED),
        ],
        ids=[
            "https-default-port-left-out",
            "http-default-port-left-out",
            "other-port-kept",
            "port-80-kept-for-https",
            "protocol-http",
            "protocol-https",
            "ipv6-in-brackets",
            "ipv6-compressed",
            "ipv6-default-port-left-out",
        ],
    )
    def test_the_address_matched_is_the_normal_form(
        self, typed: str, target: tuple[str, str, int], answers: tuple[bool, bool]
    ) -> None:
        assert decisions([pattern(typed)], *target) == answers

    def test_a_regex_only_the_engine_accepts_matches_in_a_run(self) -> None:
        entries = [pattern(r"(?<=build\d*)\.corp\.example$")]

        assert decisions(entries, "https", "build12.corp.example", 443) == MATCHED
        assert decisions(entries, "https", "deploy.corp.example", 443) == NOT_MATCHED


class TestListRuleLocalAddresses:
    """A local address connects directly unless the proxy is used for local addresses too."""

    @pytest.mark.parametrize("host", LOCAL_HOSTS)
    def test_with_the_switch_off_a_local_address_connects_directly_whatever_the_list_says(
        self, host: str
    ) -> None:
        nothing_listed = list_rule("except", [], False)
        everything_listed = list_rule("only", [pattern(MATCHES_EVERYTHING)], False)

        assert nothing_listed("http", host, 8080) is False
        assert everything_listed("http", host, 8080) is False

    def test_with_the_switch_off_a_listed_local_address_still_connects_directly(self) -> None:
        through_proxy = list_rule("only", [exact("http://localhost:8080")], False)

        assert through_proxy("http", "localhost", 8080) is False

    def test_with_the_switch_off_other_addresses_still_follow_the_list(self) -> None:
        nothing_listed = list_rule("except", [], False)
        everything_listed = list_rule("only", [pattern(MATCHES_EVERYTHING)], False)

        assert nothing_listed("http", "a.example", 8080) is True
        assert everything_listed("http", "128.0.0.1", 8080) is True

    @pytest.mark.parametrize("host", LOCAL_HOSTS)
    def test_with_the_switch_on_a_local_address_follows_the_list(self, host: str) -> None:
        everything = [pattern(MATCHES_EVERYTHING)]
        another = [exact("https://a.example")]

        assert list_rule("except", [], True)("http", host, 8080) is True
        assert decisions(everything, "http", host, 8080, proxy_local=True) == MATCHED
        assert decisions(another, "http", host, 8080, proxy_local=True) == NOT_MATCHED

    @pytest.mark.parametrize(
        ("entry", "host"),
        [
            ("http://localhost:8080", "localhost"),
            ("http://127.0.0.1:8080", "127.0.0.1"),
            ("http://127.8.8.8:8080", "127.8.8.8"),
            ("http://[::1]:8080", "::1"),
        ],
    )
    def test_with_the_switch_on_an_exact_entry_matches_a_local_address(
        self, entry: str, host: str
    ) -> None:
        assert decisions([exact(entry)], "http", host, 8080, proxy_local=True) == MATCHED
        assert decisions([exact(entry)], "http", host, 9090, proxy_local=True) == NOT_MATCHED


class TestNoProxyRule:
    """The WAVE host's NO_PROXY decides; the answer True means through the proxy."""

    @pytest.mark.parametrize("host", ["a.example", "10.1.2.3", "2001:db8::1"])
    def test_an_empty_value_proxies_everything_that_is_not_local(self, host: str) -> None:
        assert no_proxy_answer("", host) is True

    @pytest.mark.parametrize("host", ["a.example", "build.corp.example", "10.1.2.3", "2001:db8::1"])
    def test_a_lone_asterisk_matches_every_host(self, host: str) -> None:
        assert no_proxy_answer("*", host) is False

    def test_an_exact_host(self) -> None:
        assert no_proxy_answer("a.example", "a.example") is False
        assert no_proxy_answer("a.example", "b.example") is True

    @pytest.mark.parametrize("entry", [".corp.example", "corp.example"], ids=["dot", "no-dot"])
    @pytest.mark.parametrize(
        ("host", "through"),
        [
            ("corp.example", False),
            ("build.corp.example", False),
            ("eu.build.corp.example", False),
            ("notcorp.example", True),
            ("corp.example.evil.test", True),
            ("example", True),
        ],
    )
    def test_an_entry_matches_the_host_and_its_subdomains(
        self, entry: str, host: str, through: bool
    ) -> None:
        assert no_proxy_answer(entry, host) is through

    @pytest.mark.parametrize(
        ("entry", "host", "through"),
        [
            ("10.1.2.3", "10.1.2.3", False),
            ("10.1.2.3", "10.1.2.30", True),
            ("10.1.2.3", "110.1.2.3", True),
            ("2001:db8::5", "2001:db8::5", False),
            ("2001:db8::5", "2001:db8::6", True),
        ],
        ids=["ipv4", "ipv4-longer", "ipv4-longer-in-front", "ipv6", "ipv6-other"],
    )
    def test_an_ip_address_matches_exactly(self, entry: str, host: str, through: bool) -> None:
        assert no_proxy_answer(entry, host) is through

    @pytest.mark.parametrize(
        ("entry", "host", "through"),
        [
            ("10.0.0.0/8", "10.200.3.4", False),
            ("10.0.0.0/8", "11.0.0.1", True),
            ("192.168.4.0/24", "192.168.4.255", False),
            ("192.168.4.0/24", "192.168.5.1", True),
            ("2001:db8::/32", "2001:db8:7::9", False),
            ("2001:db8::/32", "2001:db9::1", True),
            ("10.0.0.0/8", "a.example", True),
        ],
        ids=[
            "ipv4-inside",
            "ipv4-outside",
            "ipv4-24-inside",
            "ipv4-24-outside",
            "ipv6-inside",
            "ipv6-outside",
            "a-name-is-in-no-range",
        ],
    )
    def test_an_address_range_matches_every_address_in_it(
        self, entry: str, host: str, through: bool
    ) -> None:
        assert no_proxy_answer(entry, host) is through

    @pytest.mark.parametrize(
        ("entry", "host"),
        [
            ("CORP.Example", "build.corp.example"),
            ("corp.example", "Build.CORP.Example"),
            (".CORP.EXAMPLE", "corp.example"),
        ],
        ids=["entry", "host", "entry-with-dot"],
    )
    def test_case_is_ignored(self, entry: str, host: str) -> None:
        assert no_proxy_answer(entry, host) is False

    @pytest.mark.parametrize(
        ("entry", "host", "port"),
        [
            ("a.example:8443", "a.example", 443),
            ("a.example:8443", "a.example", 8443),
            (".corp.example:8080", "build.corp.example", 443),
            ("10.1.2.3:3128", "10.1.2.3", 80),
        ],
        ids=["other-port-asked", "same-port-asked", "subdomain", "ip-address"],
    )
    def test_a_port_written_in_an_entry_is_ignored(self, entry: str, host: str, port: int) -> None:
        assert no_proxy_answer(entry, host, port=port) is False

    @pytest.mark.parametrize(
        "entry", ["[2001:db8::5]", "[2001:db8::5]:3128"], ids=["brackets", "brackets-and-port"]
    )
    def test_an_ipv6_address_in_brackets_matches_exactly(self, entry: str) -> None:
        assert no_proxy_answer(entry, "2001:db8::5") is False
        assert no_proxy_answer(entry, "2001:db8::6") is True

    def test_the_port_and_the_protocol_of_the_request_do_not_matter(self) -> None:
        through_proxy = no_proxy_rule("a.example")

        assert through_proxy("https", "a.example", 8443) is False
        assert through_proxy("http", "a.example", 80) is False
        assert through_proxy("http", "b.example", 80) is True

    def test_spaces_and_empty_items_are_tolerated(self) -> None:
        through_proxy = no_proxy_rule(" a.example , ,.corp.example,,10.0.0.0/8 ,")

        assert through_proxy("https", "a.example", 443) is False
        assert through_proxy("https", "build.corp.example", 443) is False
        assert through_proxy("https", "10.9.9.9", 443) is False
        assert through_proxy("https", "b.example", 443) is True

    def test_any_entry_of_the_list_can_match(self) -> None:
        through_proxy = no_proxy_rule("a.example,10.1.2.3,.corp.example")

        assert through_proxy("https", "a.example", 443) is False
        assert through_proxy("https", "10.1.2.3", 443) is False
        assert through_proxy("https", "build.corp.example", 443) is False
        assert through_proxy("https", "c.example", 443) is True

    @pytest.mark.parametrize("no_proxy", ["", "a.example", "10.0.0.0/8"])
    @pytest.mark.parametrize("host", LOCAL_HOSTS)
    def test_a_local_address_always_connects_directly(self, no_proxy: str, host: str) -> None:
        assert no_proxy_answer(no_proxy, host, scheme="http", port=8080) is False


class TestHostProxyValue:
    """One proxy value of the WAVE host is read as a plain http proxy with its own login."""

    def test_a_full_http_value(self) -> None:
        endpoint = parse_host_proxy("http://proxy.corp.example:3128")

        assert endpoint == ProxyEndpoint("proxy.corp.example", 3128, None, None)

    def test_a_value_without_a_protocol_is_read_as_http(self) -> None:
        endpoint = parse_host_proxy("proxy.corp.example:3128")

        assert endpoint == ProxyEndpoint("proxy.corp.example", 3128, None, None)

    @pytest.mark.parametrize(
        "value",
        ["http://proxy.corp.example", "proxy.corp.example", "http://10.1.2.3", "10.1.2.3"],
        ids=["name", "name-without-protocol", "ip-address", "ip-address-without-protocol"],
    )
    def test_a_value_with_no_port_means_port_80(self, value: str) -> None:
        assert parse_host_proxy(value).port == 80

    @pytest.mark.parametrize(
        "value",
        ["http://proxy.corp.example:3128/", "proxy.corp.example:3128/"],
        ids=["with-protocol", "without-protocol"],
    )
    def test_a_trailing_slash_is_left_out(self, value: str) -> None:
        assert parse_host_proxy(value) == ProxyEndpoint("proxy.corp.example", 3128, None, None)

    def test_the_username_and_password_of_the_value_land_in_the_endpoint(self) -> None:
        endpoint = parse_host_proxy("http://wave:s3cret@proxy.corp.example:3128")

        assert endpoint == ProxyEndpoint("proxy.corp.example", 3128, "wave", "s3cret")

    def test_the_login_is_percent_decoded(self) -> None:
        endpoint = parse_host_proxy("http://wave%40corp:p%40ss%3Aw0rd%2F1@proxy.corp.example:3128")

        assert endpoint == ProxyEndpoint("proxy.corp.example", 3128, "wave@corp", "p@ss:w0rd/1")

    def test_a_login_in_a_value_without_a_protocol(self) -> None:
        endpoint = parse_host_proxy("wave:s3cret@proxy.corp.example:3128")

        assert endpoint == ProxyEndpoint("proxy.corp.example", 3128, "wave", "s3cret")

    @pytest.mark.parametrize(
        ("value", "username"),
        [
            ("http://wave:@proxy.corp.example:3128", "wave"),
            ("http://@proxy.corp.example:3128", None),
        ],
        ids=["empty-password", "empty-login"],
    )
    def test_an_empty_part_of_the_login_is_no_part(self, value: str, username: str | None) -> None:
        assert parse_host_proxy(value) == ProxyEndpoint("proxy.corp.example", 3128, username, None)

    @pytest.mark.parametrize(
        "value",
        ["http://[2001:db8::5]:3128", "[2001:db8::5]:3128"],
        ids=["with-protocol", "without-protocol"],
    )
    def test_an_ipv6_proxy_host_is_held_without_brackets(self, value: str) -> None:
        assert parse_host_proxy(value) == ProxyEndpoint("2001:db8::5", 3128, None, None)

    @pytest.mark.parametrize(
        "value",
        [
            "https://proxy.corp.example:3128",
            "https://proxy.corp.example",
            "socks5://proxy.corp.example:1080",
            "socks5h://proxy.corp.example:1080",
            "socks4://proxy.corp.example:1080",
        ],
        ids=["https", "https-no-port", "socks5", "socks5h", "socks4"],
    )
    def test_a_proxy_wave_cannot_use_is_refused(self, value: str) -> None:
        with pytest.raises(ValueError, match=unusable(value)):
            parse_host_proxy(value)

    @pytest.mark.parametrize(
        ("value", "shown"),
        [
            (
                "https://wave:s3cret@proxy.corp.example:3128",
                "https://wave:********@proxy.corp.example:3128",
            ),
            (
                "socks5://wave:s3cret@proxy.corp.example:1080",
                "socks5://wave:********@proxy.corp.example:1080",
            ),
        ],
        ids=["https", "socks5"],
    )
    def test_the_refusal_masks_the_password(self, value: str, shown: str) -> None:
        with pytest.raises(ValueError, match=unusable(shown)):
            parse_host_proxy(value)

    @pytest.mark.parametrize(
        ("value", "shown"),
        [
            ("http://proxy.corp.example:99999", "http://proxy.corp.example:99999"),
            ("proxy.corp.example:99999", "proxy.corp.example:99999"),
            ("http://:3128", "http://:3128"),
            ("wave:s3cret@proxy.corp.example:99999", "wave:********@proxy.corp.example:99999"),
        ],
        ids=["port", "port-without-protocol", "no-host", "password-without-protocol"],
    )
    def test_an_http_value_with_no_host_or_no_usable_port_is_refused_as_it_is_written(
        self, value: str, shown: str
    ) -> None:
        with pytest.raises(ValueError, match=unusable(shown)):
            parse_host_proxy(value)


# Without a limit the match never returns: fail the case instead of hanging the run.
@pytest.mark.timeout(5)
class TestPatternTimeLimit:
    """Matching one address against one regular expression is limited in time."""

    def test_the_shipped_limit_is_100_milliseconds(self) -> None:
        assert _proxy_addresses.PATTERN_MATCH_LIMIT_S == SHIPPED_LIMIT_S

    def test_a_pattern_that_backtracks_stops_at_the_limit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", LOWERED_LIMIT_S)
        through_proxy = list_rule("except", [pattern(BACKTRACKING)], False)
        spans = []

        for _ in range(5):
            started = time.perf_counter()
            with pytest.raises(ProxyError, match=too_slow(f"https://{STUCK_HOST}")):
                through_proxy("https", STUCK_HOST, 443)
            spans.append(time.perf_counter() - started)

        bound = LOWERED_LIMIT_S + LIMIT_MARGIN_S
        # The bound sits under the shipped limit, so the lowered value is the one the match used.
        assert bound < SHIPPED_LIMIT_S
        assert min(spans) < bound

    @pytest.mark.parametrize(
        ("target", "address"),
        [
            (("https", STUCK_HOST, 443), f"https://{STUCK_HOST}"),
            (("http", STUCK_HOST, 8080), f"http://{STUCK_HOST}:8080"),
            (("https", STUCK_HOST.upper(), 8443), f"https://{STUCK_HOST}:8443"),
        ],
        ids=["default-port", "other-port", "host-in-upper-case"],
    )
    def test_the_message_names_the_pattern_and_the_address_in_its_normal_form(
        self, monkeypatch: pytest.MonkeyPatch, target: tuple[str, str, int], address: str
    ) -> None:
        monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", LOWERED_LIMIT_S)
        through_proxy = list_rule("except", [pattern(BACKTRACKING)], False)

        with pytest.raises(ProxyError, match=too_slow(address)):
            through_proxy(*target)

    def test_the_limit_holds_in_the_only_mode_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", LOWERED_LIMIT_S)
        through_proxy = list_rule("only", [pattern(BACKTRACKING)], False)

        with pytest.raises(ProxyError, match=too_slow(f"https://{STUCK_HOST}")):
            through_proxy("https", STUCK_HOST, 443)

    def test_the_rule_still_answers_for_another_address_after_a_time_out(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", LOWERED_LIMIT_S)
        through_proxy = list_rule("except", [pattern(BACKTRACKING)], False)

        with pytest.raises(ProxyError, match=too_slow(f"https://{STUCK_HOST}")):
            through_proxy("https", STUCK_HOST, 443)

        assert through_proxy("https", "b.example", 443) is True


class _TimingOutPattern:
    """Stands in for a compiled pattern: its first searches run out of time after a set span."""

    def __init__(self, time_outs: int, span_s: float) -> None:
        self.pattern = r"corp\.example"
        self.now_s = 0.0
        self.searches: list[tuple[float, bool]] = []
        self._time_outs = time_outs
        self._span_s = span_s

    def search(self, address: str, timeout: float, concurrent: bool) -> object | None:
        self.searches.append((timeout, concurrent))
        self.now_s += self._span_s
        if len(self.searches) <= self._time_outs:
            raise TimeoutError("regex timed out")
        return re.search(self.pattern, address, re.IGNORECASE)


@pytest.fixture
def timing_out(monkeypatch: pytest.MonkeyPatch) -> Callable[[int, float], _TimingOutPattern]:
    """Compile every pattern to one whose first searches time out, timed by a clock of its own."""

    def install(time_outs: int, span_s: float) -> _TimingOutPattern:
        stand_in = _TimingOutPattern(time_outs, span_s)
        monkeypatch.setattr(_proxy_addresses.regex, "compile", lambda text, flags: stand_in)
        clock = SimpleNamespace(monotonic=lambda: stand_in.now_s)
        monkeypatch.setattr(_proxy_addresses, "time", clock)
        return stand_in

    return install


class TestAQuickTimeOutIsRunOnceMore:
    """A time-out that comes back early is checked with one more run before it is reported."""

    TIMED_OUT = whole(
        r"Proxy address list: the pattern corp\.example took too long to match "
        "https://build.corp.example"
    )

    def test_a_time_out_that_comes_back_at_once_gets_one_more_run(
        self, timing_out: Callable[[int, float], _TimingOutPattern]
    ) -> None:
        stand_in = timing_out(1, 0.0)
        through_proxy = list_rule("only", [pattern(stand_in.pattern)], False)

        assert through_proxy("https", "build.corp.example", 443) is True
        assert len(stand_in.searches) == 2
        assert through_proxy("https", "b.example", 443) is False
        assert len(stand_in.searches) == 3

    def test_a_time_out_just_under_half_the_limit_gets_one_more_run(
        self, timing_out: Callable[[int, float], _TimingOutPattern]
    ) -> None:
        stand_in = timing_out(1, SHIPPED_LIMIT_S / 2 - 0.001)
        through_proxy = list_rule("except", [pattern(stand_in.pattern)], False)

        assert through_proxy("https", "build.corp.example", 443) is False
        assert len(stand_in.searches) == 2

    def test_a_second_time_out_is_reported(
        self, timing_out: Callable[[int, float], _TimingOutPattern]
    ) -> None:
        stand_in = timing_out(2, 0.0)
        through_proxy = list_rule("except", [pattern(stand_in.pattern)], False)

        with pytest.raises(ProxyError, match=self.TIMED_OUT):
            through_proxy("https", "build.corp.example", 443)

        assert len(stand_in.searches) == 2

    @pytest.mark.parametrize(
        "span_s", [SHIPPED_LIMIT_S / 2, SHIPPED_LIMIT_S], ids=["half-the-limit", "the-limit"]
    )
    def test_a_time_out_that_took_half_the_limit_or_longer_is_reported_at_once(
        self, timing_out: Callable[[int, float], _TimingOutPattern], span_s: float
    ) -> None:
        stand_in = timing_out(1, span_s)
        through_proxy = list_rule("except", [pattern(stand_in.pattern)], False)

        with pytest.raises(ProxyError, match=self.TIMED_OUT):
            through_proxy("https", "build.corp.example", 443)

        assert len(stand_in.searches) == 1

    def test_every_run_has_the_limit_in_force_and_never_gives_up_the_interpreter_lock(
        self,
        monkeypatch: pytest.MonkeyPatch,
        timing_out: Callable[[int, float], _TimingOutPattern],
    ) -> None:
        monkeypatch.setattr(_proxy_addresses, "PATTERN_MATCH_LIMIT_S", LOWERED_LIMIT_S)
        stand_in = timing_out(1, 0.0)
        through_proxy = list_rule("only", [pattern(stand_in.pattern)], False)

        assert through_proxy("https", "build.corp.example", 443) is True
        assert stand_in.searches == [(LOWERED_LIMIT_S, False), (LOWERED_LIMIT_S, False)]
