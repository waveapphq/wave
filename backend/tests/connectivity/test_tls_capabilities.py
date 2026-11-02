"""Fixed TLS cipher-suite catalog: membership, name forms, normalization.

The catalog is static and host-independent: the same rows on every OS, no
OpenSSL probe. Rows carry both name forms, the IANA code point, and the
TLS-version span each suite applies to. normalize() accepts either name
format case-sensitively and returns the canonical OpenSSL name, or None
for names outside the catalog.
"""

from typing import Any

import pytest

from wavecore.connectivity import tls_capabilities

_VERSIONS = ("1.0", "1.1", "1.2", "1.3")
_RANKS = {"1.0": 0, "1.1": 1, "1.2": 2, "1.3": 3}
_RANGES = [(low, high) for i, low in enumerate(_VERSIONS) for high in _VERSIONS[i:]]


def _range_key(low: str, high: str) -> str:
    return f"{low}-{high}"


_EXPECTED_OPENSSL_ORDER = [
    "ECDHE-ECDSA-AES256-GCM-SHA384",
    "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-CHACHA20-POLY1305",
    "ECDHE-RSA-CHACHA20-POLY1305",
    "DHE-RSA-AES256-GCM-SHA384",
    "DHE-RSA-AES128-GCM-SHA256",
    "DHE-RSA-CHACHA20-POLY1305",
    "ECDHE-ECDSA-AES256-SHA384",
    "ECDHE-RSA-AES256-SHA384",
    "ECDHE-ECDSA-AES128-SHA256",
    "ECDHE-RSA-AES128-SHA256",
    "DHE-RSA-AES256-SHA256",
    "DHE-RSA-AES128-SHA256",
    "ECDHE-ECDSA-AES256-SHA",
    "ECDHE-RSA-AES256-SHA",
    "ECDHE-ECDSA-AES128-SHA",
    "ECDHE-RSA-AES128-SHA",
    "DHE-RSA-AES256-SHA",
    "DHE-RSA-AES128-SHA",
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
]

_TLS13_SUITES = [
    "TLS_AES_128_GCM_SHA256",
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
]

# CBC/SHA-1 suites reach back to TLS 1.0; everything else in the 1.0-1.2
# family is 1.2-only; the 1.3 AEADs are 1.3-only.
_LEGACY_SPAN_SUITES = {
    "ECDHE-ECDSA-AES256-SHA",
    "ECDHE-RSA-AES256-SHA",
    "ECDHE-ECDSA-AES128-SHA",
    "ECDHE-RSA-AES128-SHA",
    "DHE-RSA-AES256-SHA",
    "DHE-RSA-AES128-SHA",
}


def _row(openssl: str) -> dict[str, Any]:
    for row in tls_capabilities.catalog():
        if row["openssl"] == openssl:
            return row
    raise AssertionError(f"suite {openssl} not in catalog")


class TestCatalog:
    def test_rows_carry_both_names_codepoint_and_version_span(self) -> None:
        rows = tls_capabilities.catalog()

        assert rows
        for row in rows:
            assert set(row) == {"openssl", "iana", "codepoint", "min_version", "max_version"}
            assert row["openssl"]
            assert row["iana"].startswith("TLS_")
            assert isinstance(row["codepoint"], int)

    def test_membership_and_preference_order_are_pinned(self) -> None:
        assert [row["openssl"] for row in tls_capabilities.catalog()] == _EXPECTED_OPENSSL_ORDER

    def test_catalog_is_static_and_stable(self) -> None:
        assert tls_capabilities.catalog() is tls_capabilities.catalog()

    def test_codepoints_match_the_iana_registry(self) -> None:
        from tlslite.constants import CipherSuite

        for row in tls_capabilities.catalog():
            assert row["codepoint"] == getattr(CipherSuite, row["iana"])
            assert CipherSuite.ietfNames[row["codepoint"]] == row["iana"]

    def test_version_spans(self) -> None:
        for row in tls_capabilities.catalog():
            if row["openssl"] in _TLS13_SUITES:
                assert (row["min_version"], row["max_version"]) == ("1.3", "1.3")
            elif row["openssl"] in _LEGACY_SPAN_SUITES:
                assert (row["min_version"], row["max_version"]) == ("1.0", "1.2")
            else:
                assert (row["min_version"], row["max_version"]) == ("1.2", "1.2")

    def test_tls13_suite_names_coincide_in_both_formats(self) -> None:
        assert list(tls_capabilities.tls13_suites()) == _TLS13_SUITES
        for name in _TLS13_SUITES:
            assert _row(name)["iana"] == name

    def test_no_legacy_or_exotic_suites(self) -> None:
        for row in tls_capabilities.catalog():
            for banned in ("RC4", "3DES", "DES", "NULL", "EXPORT", "anon", "GOST", "MD5"):
                assert banned not in row["openssl"]
                assert banned not in row["iana"]


class TestNormalize:
    def test_openssl_name_is_returned_canonically(self) -> None:
        assert (
            tls_capabilities.normalize("ECDHE-RSA-AES128-GCM-SHA256")
            == "ECDHE-RSA-AES128-GCM-SHA256"
        )

    def test_iana_name_resolves_to_the_openssl_name(self) -> None:
        assert (
            tls_capabilities.normalize("TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256")
            == "ECDHE-RSA-AES128-GCM-SHA256"
        )

    def test_tls13_names_normalize_to_themselves(self) -> None:
        assert tls_capabilities.normalize("TLS_AES_128_GCM_SHA256") == "TLS_AES_128_GCM_SHA256"

    def test_unknown_name_returns_none(self) -> None:
        assert tls_capabilities.normalize("NOT-A-CIPHER") is None

    def test_legacy_suites_outside_the_catalog_are_unknown(self) -> None:
        assert tls_capabilities.normalize("AES128-GCM-SHA256") is None
        assert tls_capabilities.normalize("TLS_RSA_WITH_AES_128_GCM_SHA256") is None

    def test_matching_is_case_sensitive_per_format(self) -> None:
        assert tls_capabilities.normalize("ecdhe-rsa-aes128-gcm-sha256") is None
        assert tls_capabilities.normalize("tls_ecdhe_rsa_with_aes_128_gcm_sha256") is None


class TestLookup:
    def test_lookup_returns_the_row_for_a_canonical_name(self) -> None:
        row = tls_capabilities.lookup("ECDHE-RSA-AES128-SHA")

        assert row is not None
        assert row["iana"] == "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA"
        assert row["codepoint"] == 0xC013
        assert (row["min_version"], row["max_version"]) == ("1.0", "1.2")

    def test_lookup_is_canonical_form_only(self) -> None:
        assert tls_capabilities.lookup("TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA") is None
        assert tls_capabilities.lookup("NOT-A-CIPHER") is None


class TestCapabilitiesPayload:
    def test_payload_serves_the_public_catalog_rows_and_the_defaults(self) -> None:
        payload = tls_capabilities.capabilities()

        assert set(payload) == {"ciphers", "defaults"}
        assert [row["openssl"] for row in payload["ciphers"]] == _EXPECTED_OPENSSL_ORDER
        for row in payload["ciphers"]:
            assert set(row) == {"openssl", "iana", "min_version", "max_version"}

    def test_payload_is_stable_across_calls(self) -> None:
        assert tls_capabilities.capabilities() == tls_capabilities.capabilities()


class TestCipherSuiteDefaults:
    """The default Cipher Suites list per Block and TLS range, the one the run uses unset."""

    def test_the_defaults_cover_both_blocks_with_a_cipher_suites_field(self) -> None:
        defaults = tls_capabilities.capabilities()["defaults"]

        assert set(defaults) == {"http-client", "k8s-connect"}

    @pytest.mark.parametrize("block", ["http-client", "k8s-connect"])
    def test_every_ordered_tls_range_has_its_own_default(self, block: str) -> None:
        defaults = tls_capabilities.capabilities()["defaults"][block]

        assert set(defaults) == {_range_key(low, high) for low, high in _RANGES}

    @pytest.mark.parametrize("block", ["http-client", "k8s-connect"])
    @pytest.mark.parametrize(("low", "high"), _RANGES)
    def test_each_block_defaults_to_every_suite_of_the_range(
        self, block: str, low: str, high: str
    ) -> None:
        defaults = tls_capabilities.capabilities()["defaults"][block]

        assert defaults[_range_key(low, high)] == tls_capabilities.suites_for_range(low, high)


class TestVersionRank:
    """The one TLS version-rank table: the engine, the save check and the catalog read it."""

    @pytest.mark.parametrize(("version", "rank"), list(_RANKS.items()))
    def test_each_version_has_its_rank(self, version: str, rank: int) -> None:
        assert tls_capabilities.version_rank(version) == rank

    def test_the_ranks_order_the_versions_oldest_first(self) -> None:
        newest_first = ["1.3", "1.2", "1.1", "1.0"]

        assert sorted(newest_first, key=tls_capabilities.version_rank) == list(_VERSIONS)


class TestSuiteInRange:
    """A suite is in a TLS range when its version span meets the range."""

    @pytest.mark.parametrize(("low", "high"), _RANGES)
    def test_every_catalog_suite_follows_the_span_rule(self, low: str, high: str) -> None:
        for row in tls_capabilities.catalog():
            meets = _RANKS[row["min_version"]] <= _RANKS[high] and (
                _RANKS[row["max_version"]] >= _RANKS[low]
            )

            assert tls_capabilities.suite_in_range(row["openssl"], low, high) is meets

    @pytest.mark.parametrize(("low", "high"), _RANGES)
    def test_the_suites_in_range_are_the_suites_for_the_range(self, low: str, high: str) -> None:
        names = [
            row["openssl"]
            for row in tls_capabilities.catalog()
            if tls_capabilities.suite_in_range(row["openssl"], low, high)
        ]

        assert names == tls_capabilities.suites_for_range(low, high)

    @pytest.mark.parametrize(
        ("name", "low", "high", "expected"),
        [
            ("TLS_AES_128_GCM_SHA256", "1.0", "1.2", False),
            ("TLS_AES_128_GCM_SHA256", "1.2", "1.3", True),
            ("ECDHE-RSA-AES128-GCM-SHA256", "1.3", "1.3", False),
            ("ECDHE-RSA-AES128-GCM-SHA256", "1.0", "1.1", False),
            ("ECDHE-RSA-AES128-SHA", "1.0", "1.1", True),
            ("ECDHE-RSA-AES128-SHA", "1.3", "1.3", False),
        ],
    )
    def test_named_examples(self, name: str, low: str, high: str, expected: bool) -> None:
        assert tls_capabilities.suite_in_range(name, low, high) is expected
