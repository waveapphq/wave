"""Pure-Python certificate parsing for the TLS engine.

parse_certificate extracts, without any OpenSSL involvement, the fields the
verifier and the wire trace need: rendered subject/issuer, raw name DER,
validity window, SANs, the CA flag, the signature scheme, and the signed
tbs/signature bytes. certificate_summary renders the trace-facing facts.
"""

import datetime

import pytest
from cryptography.x509.oid import NameOID

from tests.plugins.http import tls_material
from wavecore.plugins import http_tls


class TestParseCertificate:
    def test_subject_and_issuer_render_with_short_names(self) -> None:
        credential = tls_material.make_credential(
            "leaf.test",
            extra_name_attrs=[
                (NameOID.ORGANIZATION_NAME, "WAVE"),
                (NameOID.ORGANIZATIONAL_UNIT_NAME, "QA"),
                (NameOID.COUNTRY_NAME, "US"),
                (NameOID.LOCALITY_NAME, "Springfield"),
                (NameOID.STATE_OR_PROVINCE_NAME, "IL"),
            ],
        )

        facts = http_tls.parse_certificate(credential.der)

        assert facts.subject == "CN=leaf.test, O=WAVE, OU=QA, C=US, L=Springfield, ST=IL"
        assert facts.issuer == facts.subject
        assert facts.subject_der == facts.issuer_der

    def test_unknown_name_attribute_renders_as_dotted_oid(self) -> None:
        credential = tls_material.make_credential(
            "leaf.test", extra_name_attrs=[(NameOID.SERIAL_NUMBER, "12345")]
        )

        facts = http_tls.parse_certificate(credential.der)

        assert facts.subject == "CN=leaf.test, 2.5.4.5=12345"

    def test_issuer_fields_differ_from_subject_on_issued_certs(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("leaf.test", issuer=root)

        facts = http_tls.parse_certificate(leaf.der)
        root_facts = http_tls.parse_certificate(root.der)

        assert facts.issuer == "CN=Test Root"
        assert facts.issuer_der == root_facts.subject_der

    def test_validity_window_utc_time(self) -> None:
        not_before = datetime.datetime(2026, 6, 1, 8, 0, 0, tzinfo=datetime.UTC)
        not_after = datetime.datetime(2027, 6, 1, 8, 0, 0, tzinfo=datetime.UTC)
        credential = tls_material.make_credential(
            "leaf.test", not_before=not_before, not_after=not_after
        )

        facts = http_tls.parse_certificate(credential.der)

        assert facts.not_before == not_before
        assert facts.not_after == not_after

    def test_parse_works_without_the_datetime_utc_alias(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # datetime.UTC is 3.11+; the remote bundle runs on 3.10 hosts, so the engine
        # must not reference it.
        credential = tls_material.make_credential("leaf.test")
        monkeypatch.delattr(datetime, "UTC", raising=False)

        facts = http_tls.parse_certificate(credential.der)

        assert facts.not_before.tzinfo is not None

    def test_validity_window_generalized_time(self) -> None:
        not_after = datetime.datetime(2055, 1, 2, 3, 4, 5, tzinfo=datetime.UTC)
        credential = tls_material.make_credential("leaf.test", not_after=not_after)

        facts = http_tls.parse_certificate(credential.der)

        assert facts.not_after == not_after

    def test_san_dns_and_ip_entries(self) -> None:
        credential = tls_material.make_credential(
            "leaf.test",
            san_dns=["leaf.test", "alt.test"],
            san_ips=["127.0.0.1", "::1"],
        )

        facts = http_tls.parse_certificate(credential.der)

        assert facts.san_dns == ["leaf.test", "alt.test"]
        assert facts.san_ips == [bytes([127, 0, 0, 1]), bytes(15) + b"\x01"]

    def test_certificate_without_san_has_empty_entries(self) -> None:
        credential = tls_material.make_credential("leaf.test")

        facts = http_tls.parse_certificate(credential.der)

        assert facts.san_dns == []
        assert facts.san_ips == []

    def test_ca_flag(self) -> None:
        ca = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("leaf.test")
        bare = tls_material.make_credential("leaf.test", include_basic_constraints=False)

        assert http_tls.parse_certificate(ca.der).is_ca is True
        assert http_tls.parse_certificate(leaf.der).is_ca is False
        assert http_tls.parse_certificate(bare.der).is_ca is False

    def test_signature_scheme_names(self) -> None:
        rsa_cred = tls_material.make_credential("leaf.test")
        ec_root = tls_material.make_credential("EC Root", key_kind="ec256", is_ca=True)
        ec_leaf = tls_material.make_credential("leaf.test", issuer=ec_root, key_kind="ec256")
        ed_root = tls_material.make_credential("Ed Root", key_kind="ed25519", is_ca=True)
        ed_leaf = tls_material.make_credential("leaf.test", issuer=ed_root)
        pss_cred = tls_material.make_credential("leaf.test", pss=True)

        assert http_tls.parse_certificate(rsa_cred.der).scheme == "rsa_pkcs1_sha256"
        assert http_tls.parse_certificate(ec_leaf.der).scheme == "ecdsa_secp256r1_sha256"
        assert http_tls.parse_certificate(ed_leaf.der).scheme == "ed25519"
        assert http_tls.parse_certificate(pss_cred.der).scheme == "rsa_pss_rsae_sha256"

    def test_tbs_and_signature_are_extracted(self) -> None:
        credential = tls_material.make_credential("leaf.test")

        facts = http_tls.parse_certificate(credential.der)

        assert facts.tbs
        assert bytes(facts.tbs) in credential.der
        assert facts.signature
        assert facts.public_key is not None

    def test_invalid_der_is_rejected(self) -> None:
        with pytest.raises(http_tls.TLSSetupError, match="^Could not parse the certificate$"):
            http_tls.parse_certificate(b"\x30\x03\x02\x01\x01")


class TestRenderCertTime:
    def test_single_digit_day_is_space_padded(self) -> None:
        moment = datetime.datetime(2025, 6, 1, 8, 0, 0, tzinfo=datetime.UTC)

        assert http_tls.render_cert_time(moment) == "Jun  1 08:00:00 2025 GMT"

    def test_double_digit_day(self) -> None:
        moment = datetime.datetime(2026, 12, 31, 23, 59, 59, tzinfo=datetime.UTC)

        assert http_tls.render_cert_time(moment) == "Dec 31 23:59:59 2026 GMT"


class TestCertificateSummary:
    def test_summary_renders_trace_facts(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential(
            "leaf.test",
            issuer=root,
            not_before=datetime.datetime(2026, 6, 1, 8, 0, 0, tzinfo=datetime.UTC),
            not_after=datetime.datetime(2027, 6, 1, 8, 0, 0, tzinfo=datetime.UTC),
        )
        now = datetime.datetime(2026, 7, 19, 8, 0, 0, tzinfo=datetime.UTC)

        summary = http_tls.certificate_summary(leaf.der, now)

        assert summary == {
            "peer_subject": "CN=leaf.test",
            "peer_issuer": "CN=Test Root",
            "not_before": "Jun  1 08:00:00 2026 GMT",
            "not_after": "Jun  1 08:00:00 2027 GMT",
            "days_to_expiry": 317,
        }
