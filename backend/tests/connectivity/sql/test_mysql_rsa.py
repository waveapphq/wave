"""MySQL password RSA step tests (REQ-5.1.4).

encrypt_password stands in for PyMySQL's sha2_rsa_encrypt, taking the same arguments in the
same order: RSA-OAEP (SHA-1, MGF1-SHA-1, no label) of the password plus a NUL, XOR the
server's 20-byte nonce, under the server's PEM public key. It runs on vendored tlslite, so a
remote host needs no `cryptography`; the test's own key decrypts what it produced.
"""

import ast
import importlib
import inspect
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from wavecore.connectivity.sql import _mysql_rsa
from wavecore.connectivity.sql._mysql_rsa import encrypt_password

_PASSWORD = b"s3cr3t-pass"
_LONG_PASSWORD = b"a-password-longer-than-the-nonce-01"
_NONCE = bytes(range(1, 21))
_SCRAMBLE_LENGTH = 20


@pytest.fixture(scope="module")
def server_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def public_pem(server_key: rsa.RSAPrivateKey) -> bytes:
    """The server's key as MySQL sends it: a SubjectPublicKeyInfo PEM."""
    return server_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def _decrypt(key: rsa.RSAPrivateKey, ciphertext: bytes) -> bytes:
    return key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()), algorithm=hashes.SHA1(), label=None
        ),
    )


def _scramble(password: bytes, nonce: bytes) -> bytes:
    """What the server decrypts to: password + NUL, XOR the first 20 nonce bytes in a cycle."""
    salt = nonce[:_SCRAMBLE_LENGTH]
    return bytes(byte ^ salt[i % len(salt)] for i, byte in enumerate(password + b"\0"))


class TestEncryptPassword:
    """The output is what the server's private key decrypts to its own scramble."""

    def test_the_server_key_decrypts_the_scrambled_password(
        self, server_key: rsa.RSAPrivateKey, public_pem: bytes
    ) -> None:
        ciphertext = encrypt_password(_PASSWORD, _NONCE, public_pem)

        assert _decrypt(server_key, ciphertext) == _scramble(_PASSWORD, _NONCE)

    def test_the_output_is_one_key_length_block(self, public_pem: bytes) -> None:
        ciphertext = encrypt_password(_PASSWORD, _NONCE, public_pem)

        assert len(ciphertext) == 2048 // 8

    def test_two_calls_differ_because_the_padding_is_random(self, public_pem: bytes) -> None:
        first = encrypt_password(_PASSWORD, _NONCE, public_pem)
        second = encrypt_password(_PASSWORD, _NONCE, public_pem)

        assert first != second

    def test_a_password_longer_than_the_nonce_reuses_the_nonce_in_a_cycle(
        self, server_key: rsa.RSAPrivateKey, public_pem: bytes
    ) -> None:
        ciphertext = encrypt_password(_LONG_PASSWORD, _NONCE, public_pem)

        assert _decrypt(server_key, ciphertext) == _scramble(_LONG_PASSWORD, _NONCE)

    def test_a_nonce_longer_than_20_bytes_uses_its_first_20(
        self, server_key: rsa.RSAPrivateKey, public_pem: bytes
    ) -> None:
        nonce = _NONCE + b"\x00EXTRA"

        ciphertext = encrypt_password(_LONG_PASSWORD, nonce, public_pem)

        assert _decrypt(server_key, ciphertext) == _scramble(_LONG_PASSWORD, _NONCE)


class TestNoCryptography:
    """The RSA step rides to a remote host that has no `cryptography`."""

    def test_it_imports_and_runs_with_cryptography_absent(
        self,
        monkeypatch: pytest.MonkeyPatch,
        server_key: rsa.RSAPrivateKey,
        public_pem: bytes,
    ) -> None:
        with monkeypatch.context() as patch:
            for name in [n for n in sys.modules if n.split(".")[0] == "cryptography"]:
                patch.setitem(sys.modules, name, None)
            patch.delitem(sys.modules, _mysql_rsa.__name__)
            patch.setattr(sys.modules["wavecore.connectivity.sql"], "_mysql_rsa", _mysql_rsa)
            fresh = importlib.import_module(_mysql_rsa.__name__)
            ciphertext = fresh.encrypt_password(_PASSWORD, _NONCE, public_pem)

        assert fresh is not _mysql_rsa
        assert _decrypt(server_key, ciphertext) == _scramble(_PASSWORD, _NONCE)

    def test_the_module_source_imports_no_cryptography(self) -> None:
        tree = ast.parse(Path(inspect.getfile(_mysql_rsa)).read_text(encoding="utf-8"))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {alias.name for alias in node.names}
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")

        assert not {name for name in imported if name.split(".")[0] == "cryptography"}
