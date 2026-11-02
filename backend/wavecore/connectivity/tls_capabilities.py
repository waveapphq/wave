"""Fixed, host-independent TLS cipher-suite catalog.

The HTTP plugin's cipher contract: a static list of common ECDHE/DHE suites
(TLS 1.0-1.2) and the three TLS 1.3 AEADs, each carried under its OpenSSL
and IANA names with its code point and version span. Pure stdlib - this
module ships inside Remote Execution bundles.
"""

from typing import Any

_FIELDS = ("openssl", "iana", "codepoint", "min_version", "max_version")

# (openssl, iana, codepoint, min_version, max_version) in preference order.
_SUITES: tuple[tuple[str, str, int, str, str], ...] = (
    (
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
        0xC02C,
        "1.2",
        "1.2",
    ),
    ("ECDHE-RSA-AES256-GCM-SHA384", "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384", 0xC030, "1.2", "1.2"),
    (
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
        0xC02B,
        "1.2",
        "1.2",
    ),
    ("ECDHE-RSA-AES128-GCM-SHA256", "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", 0xC02F, "1.2", "1.2"),
    (
        "ECDHE-ECDSA-CHACHA20-POLY1305",
        "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
        0xCCA9,
        "1.2",
        "1.2",
    ),
    (
        "ECDHE-RSA-CHACHA20-POLY1305",
        "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        0xCCA8,
        "1.2",
        "1.2",
    ),
    ("DHE-RSA-AES256-GCM-SHA384", "TLS_DHE_RSA_WITH_AES_256_GCM_SHA384", 0x009F, "1.2", "1.2"),
    ("DHE-RSA-AES128-GCM-SHA256", "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256", 0x009E, "1.2", "1.2"),
    (
        "DHE-RSA-CHACHA20-POLY1305",
        "TLS_DHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        0xCCAA,
        "1.2",
        "1.2",
    ),
    ("ECDHE-ECDSA-AES256-SHA384", "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384", 0xC024, "1.2", "1.2"),
    ("ECDHE-RSA-AES256-SHA384", "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384", 0xC028, "1.2", "1.2"),
    ("ECDHE-ECDSA-AES128-SHA256", "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256", 0xC023, "1.2", "1.2"),
    ("ECDHE-RSA-AES128-SHA256", "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256", 0xC027, "1.2", "1.2"),
    ("DHE-RSA-AES256-SHA256", "TLS_DHE_RSA_WITH_AES_256_CBC_SHA256", 0x006B, "1.2", "1.2"),
    ("DHE-RSA-AES128-SHA256", "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256", 0x0067, "1.2", "1.2"),
    ("ECDHE-ECDSA-AES256-SHA", "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA", 0xC00A, "1.0", "1.2"),
    ("ECDHE-RSA-AES256-SHA", "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA", 0xC014, "1.0", "1.2"),
    ("ECDHE-ECDSA-AES128-SHA", "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA", 0xC009, "1.0", "1.2"),
    ("ECDHE-RSA-AES128-SHA", "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA", 0xC013, "1.0", "1.2"),
    ("DHE-RSA-AES256-SHA", "TLS_DHE_RSA_WITH_AES_256_CBC_SHA", 0x0039, "1.0", "1.2"),
    ("DHE-RSA-AES128-SHA", "TLS_DHE_RSA_WITH_AES_128_CBC_SHA", 0x0033, "1.0", "1.2"),
    ("TLS_AES_128_GCM_SHA256", "TLS_AES_128_GCM_SHA256", 0x1301, "1.3", "1.3"),
    ("TLS_AES_256_GCM_SHA384", "TLS_AES_256_GCM_SHA384", 0x1302, "1.3", "1.3"),
    ("TLS_CHACHA20_POLY1305_SHA256", "TLS_CHACHA20_POLY1305_SHA256", 0x1303, "1.3", "1.3"),
)

_ROWS: tuple[dict[str, Any], ...] = tuple(
    dict(zip(_FIELDS, suite, strict=True)) for suite in _SUITES
)
TLS_VERSIONS: tuple[str, ...] = ("1.0", "1.1", "1.2", "1.3")
_RANKS = {version: rank for rank, version in enumerate(TLS_VERSIONS)}
# Blocks whose unset Cipher Suites offers every catalog suite of the TLS range.
_CIPHER_SUITE_BLOCKS = ("http-client", "k8s-connect")
_BY_OPENSSL: dict[str, dict[str, Any]] = {row["openssl"]: row for row in _ROWS}
_CANONICAL_BY_EITHER: dict[str, str] = {row["iana"]: row["openssl"] for row in _ROWS} | {
    row["openssl"]: row["openssl"] for row in _ROWS
}


def catalog() -> tuple[dict[str, Any], ...]:
    """The full catalog rows, preference-ordered."""
    return _ROWS


def tls13_suites() -> tuple[str, ...]:
    """TLS 1.3 suite names (OpenSSL and IANA forms coincide), preference order."""
    return tuple(row["openssl"] for row in _ROWS if row["min_version"] == "1.3")


def version_rank(version: str) -> int:
    """Rank of a TLS version, oldest first (1.0 is 0); the one rank table."""
    return _RANKS[version]


def _row_in_range(row: dict[str, Any], min_version: str, max_version: str) -> bool:
    return version_rank(row["min_version"]) <= version_rank(max_version) and version_rank(
        row["max_version"]
    ) >= version_rank(min_version)


def suite_in_range(name: str, min_version: str, max_version: str) -> bool:
    """Whether a suite (either name form) has a version span that meets the range."""
    canonical = normalize(name)
    row = _BY_OPENSSL.get(canonical) if canonical else None
    return row is not None and _row_in_range(row, min_version, max_version)


def suites_for_range(min_version: str, max_version: str) -> list[str]:
    """OpenSSL names of every suite whose version span intersects the range, catalog order."""
    return [row["openssl"] for row in _ROWS if _row_in_range(row, min_version, max_version)]


def normalize(name: str) -> str | None:
    """Canonical OpenSSL name for an either-format cipher name; None when unknown."""
    return _CANONICAL_BY_EITHER.get(name)


def lookup(canonical_name: str) -> dict[str, Any] | None:
    """The catalog row for a canonical OpenSSL name; None when unknown."""
    return _BY_OPENSSL.get(canonical_name)


def _range_defaults() -> dict[str, list[str]]:
    return {
        f"{low}-{high}": suites_for_range(low, high)
        for index, low in enumerate(TLS_VERSIONS)
        for high in TLS_VERSIONS[index:]
    }


def capabilities() -> dict[str, Any]:
    """The GET /system/tls-capabilities payload (code points are internal)."""
    return {
        "ciphers": [
            {key: row[key] for key in ("openssl", "iana", "min_version", "max_version")}
            for row in _ROWS
        ],
        "defaults": {block: _range_defaults() for block in _CIPHER_SUITE_BLOCKS},
    }
