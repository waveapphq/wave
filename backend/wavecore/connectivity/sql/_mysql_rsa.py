"""MySQL's caching_sha2 RSA password step on vendored tlslite, no `cryptography` (REQ-5.1.4)."""

import hashlib
import os

from tlslite.utils.keyfactory import parsePEMKey

_SCRAMBLE_LENGTH = 20
_HASH_LENGTH = hashlib.sha1().digest_size


def _mgf1(seed: bytes, length: int) -> bytes:
    blocks = range((length + _HASH_LENGTH - 1) // _HASH_LENGTH)
    stream = b"".join(hashlib.sha1(seed + n.to_bytes(4, "big")).digest() for n in blocks)
    return stream[:length]


def _xor(data: bytes, mask: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, mask, strict=True))


def _oaep(message: bytes, size: int) -> bytes:
    """RFC 8017 EME-OAEP encoding with SHA-1, MGF1-SHA-1 and an empty label."""
    padding = b"\0" * (size - len(message) - 2 * _HASH_LENGTH - 2)
    block = hashlib.sha1(b"").digest() + padding + b"\1" + message
    seed = os.urandom(_HASH_LENGTH)
    masked_block = _xor(block, _mgf1(seed, size - _HASH_LENGTH - 1))
    masked_seed = _xor(seed, _mgf1(masked_block, _HASH_LENGTH))
    return b"\0" + masked_seed + masked_block


def encrypt_password(password: bytes, salt: bytes, public_key: bytes) -> bytes:
    """RSA-OAEP of the password plus NUL, XOR the nonce's first 20 bytes in a cycle."""
    nonce = salt[:_SCRAMBLE_LENGTH]
    scrambled = bytes(b ^ nonce[i % len(nonce)] for i, b in enumerate(password + b"\0"))
    key = parsePEMKey(public_key.decode("ascii"), public=True)
    size = (int(key.n).bit_length() + 7) // 8
    encoded = int.from_bytes(_oaep(scrambled, size), "big")
    return int(key._rawPublicKeyOp(encoded)).to_bytes(size, "big")
