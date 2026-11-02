"""Chain verification and hostname matching for the pure-Python TLS engine.

verify_chain validates the server-presented chain against PEM trust anchors:
path building by name, per-certificate signature verification via tlslite
primitives, validity windows, CA basic constraints, and SAN-only hostname
matching (exact, single-label wildcard, or IP address).
"""

import datetime

import pytest

from tests.plugins.http import tls_material
from wavecore.plugins import http_tls

_NOW = datetime.datetime(2026, 7, 19, tzinfo=datetime.UTC)


def _verify(ders: list[bytes], anchors_pem: str, hostname: str = "localhost") -> None:
    http_tls.verify_chain(ders, hostname, anchors_pem, _NOW)


class TestChainAcceptance:
    def test_leaf_intermediate_chain_against_root_anchor(self) -> None:
        root, intermediate, leaf = tls_material.make_server_chain()

        _verify([leaf.der, intermediate.der], root.cert_pem)

    def test_leaf_signed_directly_by_an_anchored_root(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])

        _verify([leaf.der], root.cert_pem)

    def test_self_signed_leaf_pinned_as_anchor(self) -> None:
        leaf = tls_material.make_credential("localhost", san_dns=["localhost"])

        _verify([leaf.der], leaf.cert_pem)

    def test_chain_including_the_root_itself(self) -> None:
        root, intermediate, leaf = tls_material.make_server_chain()

        _verify([leaf.der, intermediate.der, root.der], root.cert_pem)

    def test_anchor_set_with_multiple_roots(self) -> None:
        other = tls_material.make_credential("Other Root", is_ca=True)
        root, intermediate, leaf = tls_material.make_server_chain()

        _verify([leaf.der, intermediate.der], other.cert_pem + root.cert_pem)

    def test_ecdsa_chain(self) -> None:
        root = tls_material.make_credential("EC Root", key_kind="ec256", is_ca=True)
        leaf = tls_material.make_credential(
            "localhost", issuer=root, key_kind="ec256", san_dns=["localhost"]
        )

        _verify([leaf.der], root.cert_pem)

    def test_ecdsa_sha384_and_sha512_signatures(self) -> None:
        root384 = tls_material.make_credential("EC Root", key_kind="ec384", is_ca=True)
        leaf384 = tls_material.make_credential(
            "localhost", issuer=root384, key_kind="ec384", san_dns=["localhost"]
        )
        root521 = tls_material.make_credential("EC Root", key_kind="ec521", is_ca=True)
        leaf521 = tls_material.make_credential(
            "localhost", issuer=root521, key_kind="ec521", san_dns=["localhost"]
        )

        _verify([leaf384.der], root384.cert_pem)
        _verify([leaf521.der], root521.cert_pem)

    def test_ed25519_chain(self) -> None:
        root = tls_material.make_credential("Ed Root", key_kind="ed25519", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])

        _verify([leaf.der], root.cert_pem)

    def test_rsa_pss_signature(self) -> None:
        root = tls_material.make_credential("PSS Root", is_ca=True)
        leaf = tls_material.make_credential(
            "localhost", issuer=root, san_dns=["localhost"], pss=True
        )

        _verify([leaf.der], root.cert_pem)

    def test_rsa_sha384_and_sha512_signatures(self) -> None:
        from cryptography.hazmat.primitives import hashes

        for algorithm in (hashes.SHA384(), hashes.SHA512()):
            root = tls_material.make_credential("Test Root", is_ca=True)
            leaf = tls_material.make_credential(
                "localhost", issuer=root, san_dns=["localhost"], sig_hash=algorithm
            )

            _verify([leaf.der], root.cert_pem)


class TestChainRejection:
    def test_empty_chain(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match="^Certificate verification failed: server presented no certificate chain$",
        ):
            _verify([], root.cert_pem)

    def test_untrusted_root(self) -> None:
        other = tls_material.make_credential("Other Root", is_ca=True)
        _root, intermediate, leaf = tls_material.make_server_chain()

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: no trusted issuer found "
                'for certificate "CN=Test Intermediate"$'
            ),
        ):
            _verify([leaf.der, intermediate.der], other.cert_pem)

    def test_self_signed_leaf_not_in_anchors(self) -> None:
        other = tls_material.make_credential("Other Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: no trusted issuer found "
                'for certificate "CN=localhost"$'
            ),
        ):
            _verify([leaf.der], other.cert_pem)

    def test_empty_anchor_set(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: no trusted issuer found "
                'for certificate "CN=localhost"$'
            ),
        ):
            _verify([leaf.der], "")

    def test_expired_leaf(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential(
            "localhost",
            issuer=root,
            san_dns=["localhost"],
            not_after=_NOW - datetime.timedelta(days=1),
        )

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match='^Certificate verification failed: certificate "CN=localhost" has expired$',
        ):
            _verify([leaf.der], root.cert_pem)

    def test_not_yet_valid_leaf(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential(
            "localhost",
            issuer=root,
            san_dns=["localhost"],
            not_before=_NOW + datetime.timedelta(days=1),
            not_after=_NOW + datetime.timedelta(days=365),
        )

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: certificate "CN=localhost" ' "is not yet valid$"
            ),
        ):
            _verify([leaf.der], root.cert_pem)

    def test_expired_intermediate(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        intermediate = tls_material.make_credential(
            "Test Intermediate",
            issuer=root,
            is_ca=True,
            not_after=_NOW - datetime.timedelta(days=1),
        )
        leaf = tls_material.make_credential("localhost", issuer=intermediate, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: certificate "CN=Test Intermediate" '
                "has expired$"
            ),
        ):
            _verify([leaf.der, intermediate.der], root.cert_pem)

    def test_expired_anchor(self) -> None:
        root = tls_material.make_credential(
            "Test Root", is_ca=True, not_after=_NOW - datetime.timedelta(days=1)
        )
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match='^Certificate verification failed: certificate "CN=Test Root" has expired$',
        ):
            _verify([leaf.der], root.cert_pem)

    def test_intermediate_that_is_not_a_ca(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        middle = tls_material.make_credential("Test Intermediate", issuer=root, is_ca=False)
        leaf = tls_material.make_credential("localhost", issuer=middle, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: issuer certificate "CN=Test Intermediate" '
                "is not a certificate authority$"
            ),
        ):
            _verify([leaf.der, middle.der], root.cert_pem)

    def test_anchor_that_is_not_a_ca(self) -> None:
        pinned = tls_material.make_credential("Pinned Signer", is_ca=False)
        leaf = tls_material.make_credential("localhost", issuer=pinned, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: issuer certificate "CN=Pinned Signer" '
                "is not a certificate authority$"
            ),
        ):
            _verify([leaf.der], pinned.cert_pem)

    def test_wrong_issuer_key_fails_the_signature(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        real = tls_material.make_credential("Test Intermediate", issuer=root, is_ca=True)
        impostor = tls_material.make_credential("Test Intermediate", issuer=root, is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=real, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: signature verification failed "
                'for certificate "CN=localhost"$'
            ),
        ):
            _verify([leaf.der, impostor.der], root.cert_pem)

    def test_anchor_with_wrong_key_fails_the_signature(self) -> None:
        real_root = tls_material.make_credential("Test Root", is_ca=True)
        impostor_root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=real_root, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: signature verification failed "
                'for certificate "CN=localhost"$'
            ),
        ):
            _verify([leaf.der], impostor_root.cert_pem)

    def test_unsupported_signature_algorithm(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])
        sha256_rsa_oid = bytes.fromhex("06092a864886f70d01010b")
        md5_rsa_oid = bytes.fromhex("06092a864886f70d010104")
        tampered = leaf.der.replace(sha256_rsa_oid, md5_rsa_oid)

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: unsupported signature algorithm "
                'on certificate "CN=localhost"$'
            ),
        ):
            _verify([tampered], root.cert_pem)

    def test_overlong_chain(self) -> None:
        current = tls_material.make_credential("CA 0", is_ca=True)
        anchor = current
        chain: list[bytes] = []
        for index in range(1, 12):
            issued = tls_material.make_credential(f"CA {index}", issuer=current, is_ca=True)
            chain.insert(0, issued.der)
            current = issued
        leaf = tls_material.make_credential("localhost", issuer=current, san_dns=["localhost"])
        chain.insert(0, leaf.der)

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match="^Certificate verification failed: certificate chain is too long$",
        ):
            _verify(chain, anchor.cert_pem)


class TestHostnameMatching:
    def test_exact_and_case_insensitive_dns_match(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("Leaf", issuer=root, san_dns=["Leaf.Example.Test"])

        _verify([leaf.der], root.cert_pem, hostname="leaf.example.test")

    def test_hostname_mismatch(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: hostname "other.test" does not match '
                "the server certificate$"
            ),
        ):
            _verify([leaf.der], root.cert_pem, hostname="other.test")

    def test_common_name_alone_never_matches(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root)

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                '^Certificate verification failed: hostname "localhost" does not match '
                "the server certificate$"
            ),
        ):
            _verify([leaf.der], root.cert_pem, hostname="localhost")

    def test_wildcard_matches_exactly_one_label(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("wild", issuer=root, san_dns=["*.example.test"])

        _verify([leaf.der], root.cert_pem, hostname="a.example.test")
        for hostname in ("a.b.example.test", "example.test"):
            with pytest.raises(http_tls.TLSVerificationFailure):
                _verify([leaf.der], root.cert_pem, hostname=hostname)

    def test_wildcard_must_be_the_whole_leftmost_label(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        partial = tls_material.make_credential("wild", issuer=root, san_dns=["a*.example.test"])
        inner = tls_material.make_credential("wild", issuer=root, san_dns=["a.*.test"])

        with pytest.raises(http_tls.TLSVerificationFailure):
            _verify([partial.der], root.cert_pem, hostname="ab.example.test")
        with pytest.raises(http_tls.TLSVerificationFailure):
            _verify([inner.der], root.cert_pem, hostname="a.b.test")

    def test_ip_address_match_and_mismatch(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("ip", issuer=root, san_ips=["127.0.0.1", "::1"])

        _verify([leaf.der], root.cert_pem, hostname="127.0.0.1")
        _verify([leaf.der], root.cert_pem, hostname="::1")
        with pytest.raises(http_tls.TLSVerificationFailure):
            _verify([leaf.der], root.cert_pem, hostname="10.0.0.1")

    def test_ip_hostname_never_matches_dns_entries(self) -> None:
        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("ip", issuer=root, san_dns=["127.0.0.1"])

        with pytest.raises(http_tls.TLSVerificationFailure):
            _verify([leaf.der], root.cert_pem, hostname="127.0.0.1")


class TestVerifyInternals:
    def test_peer_chain_der_is_empty_without_a_server_certificate(self) -> None:
        class _Session:
            serverCertChain = None

        class _Conn:
            session = _Session()

        assert http_tls._peer_chain_der(_Conn()) == []

    def test_signature_verification_error_is_a_verification_failure(self) -> None:
        from unittest.mock import Mock

        root = tls_material.make_credential("Test Root", is_ca=True)
        leaf = tls_material.make_credential("localhost", issuer=root, san_dns=["localhost"])
        cert = http_tls.parse_certificate(leaf.der)
        issuer = http_tls.parse_certificate(root.der)
        issuer.public_key = Mock(hashAndVerify=Mock(side_effect=ValueError("boom")))

        with pytest.raises(
            http_tls.TLSVerificationFailure,
            match=(
                "^Certificate verification failed: signature verification failed "
                'for certificate "CN=localhost"$'
            ),
        ):
            http_tls._verify_signature(cert, issuer)
