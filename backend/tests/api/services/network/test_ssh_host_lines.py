"""Known_hosts and ssh-keyscan line parsing and the per-addition check (REQ-4.5.14)."""

import re
from typing import Any

import asyncssh
import pytest

from wavecore.api.services.network._ssh_host_lines import (
    LineError,
    ParsedHost,
    check_addition,
    parse_host_lines,
)

NOT_A_LINE = "not a known_hosts line"
HASHED = "hashed host name, run ssh-keyscan without -H and paste again"
MARKER = "@cert-authority and @revoked lines are not supported"
WILDCARD = "wildcard host patterns are not supported"
BAD_PORT = "invalid port, use [host]:port with a port from 1 to 65535"
UNREADABLE = "unreadable key"
HASHED_NAME = "|1|JfKTdBh7rNbXkVAQCRp4OQoPfmI=|USECr3SWf1JUPsms5AqfD5QfxkM="


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _public(algorithm: str, **options: Any) -> asyncssh.SSHKey:
    return asyncssh.generate_private_key(algorithm, **options).convert_to_public()


def openssh(key: asyncssh.SSHKey) -> str:
    return key.export_public_key("openssh").decode().strip()


def blob(key: asyncssh.SSHKey) -> str:
    return openssh(key).split(" ")[1]


@pytest.fixture(scope="module")
def keys() -> dict[str, asyncssh.SSHKey]:
    return {
        "ed25519": _public("ssh-ed25519"),
        "nistp256": _public("ecdsa-sha2-nistp256"),
        "nistp384": _public("ecdsa-sha2-nistp384"),
        "nistp521": _public("ecdsa-sha2-nistp521"),
        "rsa": _public("ssh-rsa", key_size=1024),
        "dss": _public("ssh-dss"),
    }


@pytest.fixture(scope="module")
def fields(keys: dict[str, asyncssh.SSHKey]) -> dict[str, str]:
    """Template values: `{name}` is "<algorithm> <base64>", `{name_b64}` the base64 alone."""
    values = {name: openssh(key) for name, key in keys.items()}
    values.update({f"{name}_b64": blob(key) for name, key in keys.items()})
    return values


def parsed(names: tuple[str, ...], port: int, key: asyncssh.SSHKey, key_type: str) -> ParsedHost:
    return ParsedHost(
        host_names=names,
        port=port,
        key_type=key_type,
        key=openssh(key),
        fingerprint=key.get_fingerprint("sha256"),
    )


class TestGoodLines:
    def test_bare_host_is_port_22(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, errors = parse_host_lines(f"db1 {openssh(keys['ed25519'])}")

        assert entries == [parsed(("db1",), 22, keys["ed25519"], "ED25519")]
        assert errors == []

    def test_bracket_form_sets_the_port(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, errors = parse_host_lines(f"[db1]:2222 {openssh(keys['ed25519'])}")

        assert entries == [parsed(("db1",), 2222, keys["ed25519"], "ED25519")]
        assert errors == []

    def test_bracket_form_with_port_22(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, _ = parse_host_lines(f"[db1]:22 {openssh(keys['ed25519'])}")

        assert entries == [parsed(("db1",), 22, keys["ed25519"], "ED25519")]

    def test_comma_separated_names_make_one_entry(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, errors = parse_host_lines(f"jump-02,10.20.4.40 {openssh(keys['ed25519'])}")

        assert entries == [parsed(("jump-02", "10.20.4.40"), 22, keys["ed25519"], "ED25519")]
        assert errors == []

    def test_comma_separated_bracket_names_keep_their_port(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entries, _ = parse_host_lines(
            f"[jump-02]:2222,[10.20.4.40]:2222 {openssh(keys['nistp256'])}"
        )

        assert entries == [parsed(("jump-02", "10.20.4.40"), 2222, keys["nistp256"], "ECDSA")]

    def test_names_on_different_ports_make_one_entry_per_port(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entries, errors = parse_host_lines(
            f"jump-02,[jump-02]:2222,10.20.4.40 {openssh(keys['ed25519'])}"
        )

        assert entries == [
            parsed(("jump-02", "10.20.4.40"), 22, keys["ed25519"], "ED25519"),
            parsed(("jump-02",), 2222, keys["ed25519"], "ED25519"),
        ]
        assert errors == []

    def test_fields_after_the_key_are_ignored(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, errors = parse_host_lines(f"db1 {openssh(keys['rsa'])} root@db1 extra field")

        assert entries == [parsed(("db1",), 22, keys["rsa"], "RSA")]
        assert errors == []

    def test_fields_split_on_any_whitespace(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        line = f"  db1\tssh-ed25519   {blob(keys['ed25519'])}  "

        entries, errors = parse_host_lines(line)

        assert entries == [parsed(("db1",), 22, keys["ed25519"], "ED25519")]
        assert errors == []

    @pytest.mark.parametrize(
        ("name", "key_type"),
        [
            ("ed25519", "ED25519"),
            ("nistp256", "ECDSA"),
            ("nistp384", "ECDSA"),
            ("nistp521", "ECDSA"),
            ("rsa", "RSA"),
        ],
    )
    def test_key_type_labels(
        self, keys: dict[str, asyncssh.SSHKey], name: str, key_type: str
    ) -> None:
        entries, errors = parse_host_lines(f"db1 {openssh(keys[name])}")

        assert [entry.key_type for entry in entries] == [key_type]
        assert errors == []

    def test_fingerprint_matches_asyncssh(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        entries, _ = parse_host_lines(f"db1 {openssh(keys['nistp384'])}")

        assert entries[0].fingerprint == keys["nistp384"].get_fingerprint("sha256")
        assert entries[0].fingerprint.startswith("SHA256:")
        assert "=" not in entries[0].fingerprint

    def test_ssh_keyscan_output(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        text = (
            "# db1:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\n"
            f"db1 {openssh(keys['rsa'])}\n"
            "# db1:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\n"
            f"db1 {openssh(keys['nistp256'])}\n"
            "# db1:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\n"
            f"db1 {openssh(keys['ed25519'])}\n"
        )

        entries, errors = parse_host_lines(text)

        assert entries == [
            parsed(("db1",), 22, keys["rsa"], "RSA"),
            parsed(("db1",), 22, keys["nistp256"], "ECDSA"),
            parsed(("db1",), 22, keys["ed25519"], "ED25519"),
        ]
        assert errors == []

    def test_exact_repeat_of_an_earlier_line_collapses(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        line = f"jump-02,10.20.4.40 {openssh(keys['ed25519'])}"

        entries, errors = parse_host_lines(f"{line}\n{line}\n{line} root@jump-02\n")

        assert entries == [parsed(("jump-02", "10.20.4.40"), 22, keys["ed25519"], "ED25519")]
        assert errors == []

    def test_same_names_on_another_port_are_not_a_repeat(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        key = openssh(keys["ed25519"])

        entries, _ = parse_host_lines(f"db1 {key}\n[db1]:2222 {key}\n")

        assert entries == [
            parsed(("db1",), 22, keys["ed25519"], "ED25519"),
            parsed(("db1",), 2222, keys["ed25519"], "ED25519"),
        ]

    @pytest.mark.parametrize("text", ["", "\n\n", "   \n\t\n", "# only a comment\n\n"])
    def test_blank_text_gives_nothing(self, text: str) -> None:
        assert parse_host_lines(text) == ([], [])


class TestBadLines:
    @pytest.mark.parametrize(
        ("template", "message"),
        [
            ("db1", NOT_A_LINE),
            ("db1 ssh-ed25519", NOT_A_LINE),
            ("HostName ci-02.lab.internal", NOT_A_LINE),
            ("    HostName ci-02.lab.internal", NOT_A_LINE),
            ("db1 notakeytype {ed25519_b64}", NOT_A_LINE),
            (HASHED_NAME + " {ed25519}", HASHED),
            ("@cert-authority *.lab.internal {ed25519}", MARKER),
            ("@revoked db1 {ed25519}", MARKER),
            ("*.lab.internal {ed25519}", WILDCARD),
            ("db? {ed25519}", WILDCARD),
            ("!db1 {ed25519}", WILDCARD),
            ("db1,*.lab.internal {ed25519}", WILDCARD),
            ("[db1]:ssh {ed25519}", BAD_PORT),
            ("[db1]:0 {ed25519}", BAD_PORT),
            ("[db1]:65536 {ed25519}", BAD_PORT),
            ("db1 {dss}", "unsupported key type ssh-dss"),
            (
                "db1 sk-ssh-ed25519@openssh.com {ed25519_b64}",
                "unsupported key type sk-ssh-ed25519@openssh.com",
            ),
            ("db1 ssh-ed25519 AAAAnotakey", UNREADABLE),
            ("db1 ssh-ed25519 %%%%", UNREADABLE),
            ("db1 ssh-rsa {ed25519_b64}", "key type ssh-rsa does not match the key"),
            (
                "db1 ecdsa-sha2-nistp256 {nistp384_b64}",
                "key type ecdsa-sha2-nistp256 does not match the key",
            ),
        ],
        ids=[
            "one-field",
            "two-fields",
            "ssh-config-line",
            "indented-ssh-config-line",
            "second-field-not-a-key-type",
            "hashed",
            "cert-authority",
            "revoked",
            "star",
            "question-mark",
            "negation",
            "wildcard-in-name-list",
            "port-not-a-number",
            "port-0",
            "port-65536",
            "ssh-dss",
            "security-key",
            "not-a-key",
            "not-base64",
            "ssh-rsa-names-ed25519-key",
            "nistp256-names-nistp384-key",
        ],
    )
    def test_reason(self, fields: dict[str, str], template: str, message: str) -> None:
        entries, errors = parse_host_lines(template.format(**fields))

        assert entries == []
        assert errors == [LineError(line=1, message=message)]
        assert re.fullmatch(exact(message), errors[0].message)


class TestLineNumbers:
    def test_blank_and_comment_lines_are_counted(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        text = (
            "# db1:22 SSH-2.0-OpenSSH_9.6\n"
            "\n"
            f"db1 {openssh(keys['ed25519'])}\n"
            "HostName ci-02.lab.internal\n"
            "\n"
            "# a note\n"
            f"{HASHED_NAME} {openssh(keys['rsa'])}\n"
        )

        entries, errors = parse_host_lines(text)

        assert entries == [parsed(("db1",), 22, keys["ed25519"], "ED25519")]
        assert errors == [
            LineError(line=4, message=NOT_A_LINE),
            LineError(line=7, message=HASHED),
        ]

    def test_good_lines_are_returned_beside_bad_ones(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        text = "\n".join(
            [
                f"[db1]:65536 {openssh(keys['ed25519'])}",
                f"db2 {openssh(keys['rsa'])}",
                f"*.lab {openssh(keys['rsa'])}",
                f"[db3]:2222 {openssh(keys['nistp521'])}",
            ]
        )

        entries, errors = parse_host_lines(text)

        assert entries == [
            parsed(("db2",), 22, keys["rsa"], "RSA"),
            parsed(("db3",), 2222, keys["nistp521"], "ECDSA"),
        ]
        assert errors == [
            LineError(line=1, message=BAD_PORT),
            LineError(line=3, message=WILDCARD),
        ]


def new_host(host: str, port: int, key_type: str, key: str) -> dict[str, Any]:
    return {"host": host, "port": port, "key_type": key_type, "key": key}


class TestCheckAddition:
    @pytest.mark.parametrize(
        ("name", "key_type"),
        [
            ("ed25519", "ED25519"),
            ("nistp256", "ECDSA"),
            ("nistp384", "ECDSA"),
            ("nistp521", "ECDSA"),
            ("rsa", "RSA"),
        ],
    )
    def test_valid_addition_passes(
        self, keys: dict[str, asyncssh.SSHKey], name: str, key_type: str
    ) -> None:
        assert check_addition(1, new_host("db1", 22, key_type, openssh(keys[name]))) is None

    @pytest.mark.parametrize("port", [1, 22, 65535])
    def test_port_bounds_are_accepted(self, keys: dict[str, asyncssh.SSHKey], port: int) -> None:
        assert check_addition(1, new_host("db1", port, "ED25519", openssh(keys["ed25519"]))) is None

    @pytest.mark.parametrize("host", ["", "   "])
    def test_host_is_required(self, keys: dict[str, asyncssh.SSHKey], host: str) -> None:
        with pytest.raises(ValueError, match=exact("Addition 2: host is required")):
            check_addition(2, new_host(host, 22, "ED25519", openssh(keys["ed25519"])))

    def test_hashed_host(self, keys: dict[str, asyncssh.SSHKey]) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Addition 1: hashed host name, run ssh-keyscan without -H and paste again"),
        ):
            check_addition(1, new_host(HASHED_NAME, 22, "ED25519", openssh(keys["ed25519"])))

    @pytest.mark.parametrize("host", ["*.lab.internal", "db?", "!db1"])
    def test_wildcard_host(self, keys: dict[str, asyncssh.SSHKey], host: str) -> None:
        with pytest.raises(
            ValueError, match=exact("Addition 3: wildcard host patterns are not supported")
        ):
            check_addition(3, new_host(host, 22, "ED25519", openssh(keys["ed25519"])))

    @pytest.mark.parametrize("port", ["22", "022", "65535"])
    def test_a_port_sent_as_its_digits_is_accepted(
        self, keys: dict[str, asyncssh.SSHKey], port: str
    ) -> None:
        assert check_addition(1, new_host("db1", port, "ED25519", openssh(keys["ed25519"]))) is None

    @pytest.mark.parametrize(
        "port", [0, 65536, -22, True, 22.0, "22.0", "+22", " 22", "1_000", "65536", None]
    )
    def test_port_outside_the_range(self, keys: dict[str, asyncssh.SSHKey], port: Any) -> None:
        with pytest.raises(ValueError, match=exact("Addition 1: port must be from 1 to 65535")):
            check_addition(1, new_host("db1", port, "ED25519", openssh(keys["ed25519"])))

    @pytest.mark.parametrize("key_type", ["DSA", "ed25519", "ssh-ed25519"])
    def test_unsupported_key_type(self, keys: dict[str, asyncssh.SSHKey], key_type: str) -> None:
        with pytest.raises(ValueError, match=exact(f"Addition 1: unsupported key type {key_type}")):
            check_addition(1, new_host("db1", 22, key_type, openssh(keys["ed25519"])))

    @pytest.mark.parametrize("key", ["ssh-ed25519 AAAAnotakey", "", "not a key"])
    def test_unreadable_key(self, key: str) -> None:
        with pytest.raises(ValueError, match=exact("Addition 1: unreadable key")):
            check_addition(1, new_host("db1", 22, "ED25519", key))

    @pytest.mark.parametrize(
        ("key_type", "name"),
        [("RSA", "ed25519"), ("ED25519", "nistp256"), ("ECDSA", "rsa")],
    )
    def test_key_type_does_not_match_the_key(
        self, keys: dict[str, asyncssh.SSHKey], key_type: str, name: str
    ) -> None:
        with pytest.raises(
            ValueError, match=exact(f"Addition 1: key type {key_type} does not match the key")
        ):
            check_addition(1, new_host("db1", 22, key_type, openssh(keys[name])))
