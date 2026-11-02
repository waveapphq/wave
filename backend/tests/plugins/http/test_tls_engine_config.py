"""Handshake configuration for the pure-Python TLS engine.

TLSClientConfig maps the plugin's TLS parameters onto tlslite: version pins
become HandshakeSettings min/max/versions, cipher pins become the exact
ordered wire list of catalog code points (TLS 1.3 family first, out-of-range
suites dropped), an unset list offers every catalog suite of the range, and
the handshake settings never offer legacy 3DES.
"""

import datetime

import pytest
from tlslite.handshakesettings import TLS13_PERMITTED_GROUPS

from wavecore.connectivity import tls_capabilities
from wavecore.plugins import http_tls

_NOW = datetime.datetime(2026, 7, 19, tzinfo=datetime.UTC)


class TestTLSClientConfigDefaults:
    def test_defaults(self) -> None:
        config = http_tls.TLSClientConfig()

        assert config.min_version == "1.2"
        assert config.max_version == "1.3"
        assert config.cipher_names is None
        assert config.verify is True
        assert config.anchors_pem is None
        assert config.client_cert_pem is None
        assert config.client_key_pem is None


class TestWireCipherCodepoints:
    @pytest.mark.parametrize(("low", "high"), [("1.2", "1.3"), ("1.3", "1.3"), ("1.0", "1.2")])
    def test_none_offers_every_catalog_suite_of_the_range(self, low: str, high: str) -> None:
        in_range = set(tls_capabilities.suites_for_range(low, high))
        rows = [row for row in tls_capabilities.catalog() if row["openssl"] in in_range]
        expected = [row["codepoint"] for row in rows if row["min_version"] == "1.3"] + [
            row["codepoint"] for row in rows if row["min_version"] != "1.3"
        ]
        config = http_tls.TLSClientConfig(min_version=low, max_version=high)

        assert http_tls.wire_cipher_codepoints(config) == expected

    def test_explicit_zero_stays_empty(self) -> None:
        config = http_tls.TLSClientConfig(cipher_names=[])

        assert http_tls.wire_cipher_codepoints(config) == []

    def test_tls13_family_leads_the_wire_list(self) -> None:
        config = http_tls.TLSClientConfig(
            min_version="1.0",
            max_version="1.3",
            cipher_names=[
                "ECDHE-RSA-AES128-GCM-SHA256",
                "TLS_AES_256_GCM_SHA384",
                "DHE-RSA-AES128-SHA",
                "TLS_AES_128_GCM_SHA256",
            ],
        )

        assert http_tls.wire_cipher_codepoints(config) == [0x1302, 0x1301, 0xC02F, 0x0033]

    def test_iana_names_are_accepted(self) -> None:
        config = http_tls.TLSClientConfig(cipher_names=["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"])

        assert http_tls.wire_cipher_codepoints(config) == [0xC02F]

    def test_out_of_range_suites_are_dropped(self) -> None:
        config = http_tls.TLSClientConfig(
            min_version="1.2",
            max_version="1.2",
            cipher_names=["TLS_AES_256_GCM_SHA384", "ECDHE-RSA-AES128-GCM-SHA256"],
        )
        tls13_only = http_tls.TLSClientConfig(
            min_version="1.3",
            max_version="1.3",
            cipher_names=["TLS_AES_256_GCM_SHA384", "ECDHE-RSA-AES128-GCM-SHA256"],
        )

        assert http_tls.wire_cipher_codepoints(config) == [0xC02F]
        assert http_tls.wire_cipher_codepoints(tls13_only) == [0x1302]

    def test_legacy_span_suites_stay_in_range_at_every_version(self) -> None:
        config = http_tls.TLSClientConfig(
            min_version="1.0", max_version="1.1", cipher_names=["ECDHE-RSA-AES128-SHA"]
        )

        assert http_tls.wire_cipher_codepoints(config) == [0xC013]

    def test_unknown_name_is_rejected(self) -> None:
        config = http_tls.TLSClientConfig(cipher_names=["NOT-A-CIPHER"])

        with pytest.raises(http_tls.TLSSetupError, match='^Unknown cipher suite "NOT-A-CIPHER"$'):
            http_tls.wire_cipher_codepoints(config)

    def test_a_null_name_is_rejected_by_its_row(self) -> None:
        config = http_tls.TLSClientConfig(cipher_names=["TLS_AES_128_GCM_SHA256", None])

        with pytest.raises(http_tls.TLSSetupError, match=r"^Row 2 in 'cipher_suites' is null$"):
            http_tls.wire_cipher_codepoints(config)


class TestBuildHandshakeSettings:
    def test_version_pins_map_to_wire_tuples(self) -> None:
        config = http_tls.TLSClientConfig(min_version="1.0", max_version="1.2")

        settings = http_tls.build_handshake_settings(config)

        assert settings.minVersion == (3, 1)
        assert settings.maxVersion == (3, 3)
        assert settings.versions == [(3, 3), (3, 2), (3, 1)]

    def test_full_range_offers_all_versions_descending(self) -> None:
        config = http_tls.TLSClientConfig(min_version="1.0", max_version="1.3")

        settings = http_tls.build_handshake_settings(config)

        assert settings.versions == [(3, 4), (3, 3), (3, 2), (3, 1)]

    def test_tls13_only_range_restricts_ecc_groups(self) -> None:
        config = http_tls.TLSClientConfig(min_version="1.3", max_version="1.3")

        settings = http_tls.build_handshake_settings(config)

        assert settings.versions == [(3, 4)]
        assert settings.eccCurves
        assert all(curve in TLS13_PERMITTED_GROUPS for curve in settings.eccCurves)

    def test_defaults_never_offer_3des(self) -> None:
        settings = http_tls.build_handshake_settings(http_tls.TLSClientConfig())

        assert "3des" not in settings.cipherNames
        assert "aes128gcm" in settings.cipherNames

    def test_client_certificate_compression_is_disabled(self) -> None:
        # tlslite-ng 0.8.2 compresses the client cert off its own ClientHello
        # advertisement (RFC 8879 gate bug), which servers reject; never send it.
        settings = http_tls.build_handshake_settings(http_tls.TLSClientConfig())

        assert settings.certificate_compression_send == []


class TestClientIdentityErrors:
    def test_unparsable_client_material_is_a_setup_error(self) -> None:
        config = http_tls.TLSClientConfig(
            client_cert_pem="-----BEGIN CERTIFICATE-----\nnot-base64\n-----END CERTIFICATE-----",
            client_key_pem="-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----",
        )

        with pytest.raises(
            http_tls.TLSSetupError, match="^Could not load the client certificate or key$"
        ):
            http_tls.tls_handshake(object(), config, "host.test", _NOW)


class TestIpLiteral:
    def test_ip_literals_are_detected(self) -> None:
        assert http_tls._is_ip_literal("127.0.0.1") is True
        assert http_tls._is_ip_literal("::1") is True

    def test_dns_names_are_not_ip_literals(self) -> None:
        assert http_tls._is_ip_literal("example.com") is False
