"""Config write-back: a Save changes only its own keys in the config file (REQ-4.7.16)."""

import errno
import json
import os
import re
import stat
import threading
import time
import traceback
from collections.abc import Callable, Generator
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.config.loader import ConfigValidationError, get_config
from wavecore.api.config.write_back import ConfigWriteError, write_keys
from wavecore.api.exceptions import InternalServerException, ValidationException
from wavecore.api.services import settings_file

_BOUND = 2.0
_SETTLE = 0.05
_OVERLAP = 0.02
_FLAG = "secret_masking.run_output"
_LOCK = "network.ssh_hosts.lock_trusted_hosts"
_ACTION = "network.ssh_hosts.default_block_action"
_ACTION_PROBLEM = (
    "network.ssh_hosts.default_block_action cannot be accept-new "
    "while network.ssh_hosts.lock_trusted_hosts is true"
)
_LEVEL_PROBLEM = "backup.schedule.compression_level must be a whole number from 1 to 9"
_SMALL = "# kept\nsecret_masking:\n  run_output: false\n"
_HELD_TEXT = (
    "# kept\n"
    "secret_masking:\n"
    "  run_output: false\n"
    "mcp:\n"
    "  port: 8765\n"
    '  auth_username: ""\n'
    "  auth_password: null\n"
)
_HELD: dict[str, Any] = {
    _FLAG: False,
    "mcp.port": 8765,
    "mcp.auth_username": "",
    "mcp.auth_password": None,
}
_LONG_AGO = 1_600_000_000 * 10**9
_TWICE = "security:\n  secret_key: first-secret\n  secret_key: second-secret\n"
_ENTRIES = "network.proxy.entries"
_EXACT = {"kind": "exact", "address": "https://a.example"}
_REGEX = {"kind": "regex", "address": r"^https://.*\.b\.example(:\d+)?$"}
_PORTED = {"kind": "exact", "address": "http://c.example:8080"}
_SEVERAL = [_EXACT, _REGEX, _PORTED]
_LIST_HEAD = (
    "# kept\n"
    "security:\n"
    "  cors_origins:\n"
    '    - "http://localhost:3000"\n'
    "    # second origin\n"
    '    - "http://localhost:3001"\n'
    "\n"
    "network:\n"
    "  proxy:\n"
    "    enabled: false\n"
    "    # the address list\n"
)
_AFTER_NETWORK = "\n# after the network section\nmcp:\n  port: 8765\n"
# What follows the list in the file; none of it belongs to the list.
_LIST_TAILS = {
    "key-follows": f"    proxy_local_addresses: false\n{_AFTER_NETWORK}",
    "comment-follows": (
        f"    # local addresses too\n    proxy_local_addresses: false\n{_AFTER_NETWORK}"
    ),
    "blank-line-follows": f"\n    proxy_local_addresses: false\n{_AFTER_NETWORK}",
    "last-key-of-its-section": _AFTER_NETWORK,
}
_LIST_SAVES: dict[str, tuple[list[dict[str, str]], list[dict[str, str]]]] = {
    "empty-to-one": ([], [_EXACT]),
    "empty-to-several": ([], _SEVERAL),
    "one-to-several": ([_EXACT], _SEVERAL),
    "several-to-one": (_SEVERAL, [_REGEX]),
    "several-to-empty": (_SEVERAL, []),
    "one-to-another": ([_EXACT], [_PORTED]),
    "several-reordered": (_SEVERAL, [_PORTED, _REGEX, _EXACT]),
}
# Addresses YAML would read as something else, or cut short, when written bare.
_QUOTED_ADDRESSES = {
    "anchored-regex": r"^https://[a-z0-9-]+\.corp\.example(:\d+)?$",
    "bracket-and-colon": r"[a-z]+\.example: 8080",
    "space-and-hash": r".*\.example #internal",
    "leading-hash": "# starts like a comment",
    "leading-dash": "- starts like a list item",
    "leading-star": "*.corp.example",
    "leading-brace": r"{a,b}\.example",
    "both-quotes": "https://a.example/'single'/\"double\"",
    "padded": " https://padded.example ",
    "reads-as-true": "true",
    "reads-as-null": "null",
    "reads-as-a-number": "8080",
    "reads-as-a-time": "1:30",
    "not-ascii": "https://bücher.example",
    "long-with-spaces": " ".join(rf"host{number}\.example" for number in range(30)),
}
_TYPES = "backup.schedule.entity_types"
_TYPES_HEAD = (
    "# kept\n"
    "backup:\n"
    "  schedule:\n"
    "    enabled: false\n"
    "    # null means every backup entity type\n"
)
_AFTER_BACKUP = "\n# after the backup section\nmcp:\n  port: 8765\n"
_TYPES_TAILS = {
    "comment-follows": f"    # how many backups are kept\n    max_backups: 5\n{_AFTER_BACKUP}",
    "blank-line-follows": f"\n    max_backups: 5\n{_AFTER_BACKUP}",
    "last-key-of-its-section": _AFTER_BACKUP,
}
_TYPES_SAVES: dict[str, tuple[list[str], list[str] | None]] = {
    "several-to-one": (["tests", "suites", "profiles"], ["tests"]),
    "one-to-several": (["tests"], ["tests", "suites", "profiles"]),
    "several-reordered": (["tests", "suites"], ["suites", "tests"]),
    "several-to-null": (["tests", "suites"], None),
}


def _lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def _stamp(path: Path) -> tuple[bytes, int, int]:
    """Bytes, modification time and inode: a rewrite of the file changes at least one."""
    status = path.stat()
    return path.read_bytes(), status.st_mtime_ns, status.st_ino


def _aged_stamp(path: Path) -> tuple[bytes, int, int]:
    """Date the file long ago first, so a rewrite always shows in its time."""
    os.utime(path, ns=(_LONG_AGO, _LONG_AGO))
    return _stamp(path)


def _flush_lists(text: str) -> str:
    return re.sub(r'^    (- "|# Additional ports)', r"  \1", text, flags=re.MULTILINE)


def _wide_sections(text: str) -> str:
    return re.sub(r"^ +", lambda found: found.group() * 2, text, flags=re.MULTILINE)


def _document_start(text: str) -> str:
    return f"---\n{text}"


def _changed(before: list[str], after: list[str]) -> list[int]:
    """Indexes of the lines that differ between two texts of the same length."""
    assert len(after) == len(before)
    return [
        index for index, pair in enumerate(zip(before, after, strict=True)) if pair[0] != pair[1]
    ]


def _added(before: list[str], after: list[str]) -> list[int]:
    """Indexes in ``after`` of the added lines; fails when an original line is gone."""
    added: list[int] = []
    remaining = iter(enumerate(after))
    for line in before:
        for index, candidate in remaining:
            if candidate == line:
                break
            added.append(index)
        else:
            pytest.fail(f"the save removed or changed the line {line!r}")
    added.extend(index for index, _ in remaining)
    return added


def _lookup(data: dict[str, Any], key: str) -> Any:
    value: Any = data
    for part in key.split("."):
        value = value[part]
    return value


def _nest(key: str, value: Any) -> Any:
    for part in reversed(key.split(".")):
        value = {part: value}
    return value


def _without_section(text: str, section: str) -> str:
    """The text without one top-level section and the blank line after it."""
    lines = text.splitlines(keepends=True)
    start = lines.index(f"{section}:\n")
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index][0] not in " \n#"),
        len(lines),
    )
    return "".join(lines[:start] + lines[end:])


def _copies(entries: list[dict[str, str]]) -> list[dict[str, str]]:
    return [dict(entry) for entry in entries]


def _list_text(held: list[dict[str, str]], tail: str) -> str:
    """A config file whose address list sits between comments, written as a hand would."""
    block = "    entries: []\n"
    if held:
        block = "    entries:\n" + "".join(
            f"      - kind: {entry['kind']}\n        address: {json.dumps(entry['address'])}\n"
            for entry in held
        )
    return f"{_LIST_HEAD}{block}{tail}"


def _types_text(held: list[str], tail: str) -> str:
    """A config file whose list of entity types is followed by the lines of ``tail``."""
    block = "    entity_types:\n" + "".join(f"      - {name}\n" for name in held)
    return f"{_TYPES_HEAD}{block}{tail}"


def _list_lines(text: str, head: str, tail: str) -> list[str]:
    """The lines between ``head`` and ``tail``; fails when a line of either changed."""
    lines, above, below = text.splitlines(), head.splitlines(), tail.splitlines()
    assert lines[: len(above)] == above
    assert lines[len(lines) - len(below) :] == below
    return lines[len(above) : len(lines) - len(below)]


def _named(path: Path) -> str:
    return re.escape(f"the config file {path}")


def _refusal(rest: str) -> str:
    """Anchored pattern of one write-back refusal; ``rest`` is already a pattern."""
    return f"^Settings cannot be saved: {rest}$"


def _state(config_file: Path) -> dict[str, Any]:
    """Everything a refused save must leave alone: the file, its folder, the running config."""
    config = get_config()
    return {
        "bytes": config_file.read_bytes(),
        "folder": sorted(config_file.parent.iterdir()),
        "memory": config.to_dict(include_secrets=True),
    }


def _watch_replace(monkeypatch: pytest.MonkeyPatch) -> list[tuple[Path, Path]]:
    """Record every file move and still do it."""
    real_replace = os.replace
    moves: list[tuple[Path, Path]] = []

    def spy(src: Any, dst: Any) -> None:
        moves.append((Path(src), Path(dst)))
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    return moves


def _slow_replace(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hold every file move briefly, so saves without a lock would overlap."""
    real_replace = os.replace

    def slow(src: Any, dst: Any) -> None:
        time.sleep(_OVERLAP)
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", slow)


def _run_together(*jobs: Callable[[], None]) -> list[Exception]:
    """Start every job at the same moment and return what they raised."""
    barrier = threading.Barrier(len(jobs))
    errors: list[Exception] = []

    def run(job: Callable[[], None]) -> None:
        try:
            barrier.wait(_BOUND)
            job()
        except Exception as error:
            errors.append(error)

    threads = [threading.Thread(target=run, args=(job,), daemon=True) for job in jobs]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(_BOUND)
    return errors


@pytest.fixture
def linked_target(config_file: Path, load_config: Callable[..., Any], tmp_path: Path) -> Path:
    """Turn the test's config file into a link and return the file it points at."""
    target = tmp_path / "real" / "wave.yaml"
    target.parent.mkdir()
    target.write_text(_SMALL, encoding="utf-8")
    config_file.unlink()
    config_file.symlink_to(target)
    load_config()
    return target


@pytest.fixture(params=["save", "write_keys"])
def store(request: pytest.FixtureRequest, config_file: Path) -> Callable[[dict[str, Any]], None]:
    """Both ways into the file: through the running config and straight to the writer."""
    if request.param == "save":
        return lambda changes: get_config().save(changes)
    return lambda changes: write_keys(config_file, changes)


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


class TestSavedKeysOnly:
    def test_saving_one_flag_changes_exactly_that_line(self, example_config: Path) -> None:
        before = _lines(example_config)

        get_config().save({_FLAG: True})

        after = _lines(example_config)
        changed = _changed(before, after)
        assert changed == [before.index("  run_output: false")]
        assert after[changed[0]] == "  run_output: true"

    @pytest.mark.parametrize(
        "pattern",
        [
            pytest.param(r"#", id="top-level-comments"),
            pytest.param(r"\s+#", id="indented-comments"),
            pytest.param(r"$", id="blank-lines"),
            pytest.param(r'\s+- "', id="indented-quoted-list"),
            pytest.param(r"  cors_origin_regex: .{100,}", id="long-line"),
            pytest.param(r".*: null$", id="null-values"),
            pytest.param(r'.*: ""$', id="empty-quoted-values"),
            pytest.param(r".*: ~/", id="tilde-path"),
        ],
    )
    def test_layout_of_the_example_is_kept(self, pattern: str, example_config: Path) -> None:
        def found() -> list[tuple[int, str]]:
            return [
                (index, line)
                for index, line in enumerate(_lines(example_config))
                if re.match(pattern, line)
            ]

        before = found()

        get_config().save({_FLAG: True})

        assert before
        assert found() == before

    @pytest.mark.parametrize(
        ("key", "value", "line"),
        [
            ("logging.level", "DEBUG", "  level: INFO"),
            ("secret_masking.credential_inputs", True, "  credential_inputs: false"),
            (_LOCK, True, "    lock_trusted_hosts: false"),
            (
                "network.ssh_hosts.default_block_action",
                "strict",
                "    default_block_action: disabled",
            ),
            ("network.certificates.public_source", "host", "    public_source: builtin"),
            ("mcp.port", 9000, "  port: 8765"),
            ("mcp.auth_username", "alice", '  auth_username: ""'),
            ("backup.schedule.cron", "0 2 * * *", '    cron: ""'),
            ("backup.schedule.max_backups", 9, "    max_backups: 5"),
            (
                "backup.schedule.save_directory",
                "/srv/wave-backups",
                "    save_directory: ~/wave-backups",
            ),
            ("backup.schedule.last_run", "2026-10-04T10:00:00+00:00", "    last_run: null"),
            ("backup.schedule.last_run_status", "success", "    last_run_status: null"),
        ],
    )
    def test_saving_a_key_changes_only_its_own_line(
        self,
        key: str,
        value: Any,
        line: str,
        example_config: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        before = _lines(example_config)

        get_config().save({key: value})

        assert _changed(before, _lines(example_config)) == [before.index(line)]
        stored = _lookup(config_on_disk(), key)
        assert stored == value
        assert type(stored) is type(value)

    def test_saving_two_keys_changes_two_lines_in_one_write(
        self, example_config: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        before = _lines(example_config)
        moves = _watch_replace(monkeypatch)

        get_config().save({"mcp.enabled": True, "mcp.port": 9000})

        assert _changed(before, _lines(example_config)) == [
            before.index("  enabled: false"),
            before.index("  port: 8765"),
        ]
        assert len(moves) == 1

    def test_save_into_an_empty_mapping_writes_only_the_saved_key(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        get_config().save({_LOCK: True})

        assert config_on_disk() == {"network": {"ssh_hosts": {"lock_trusted_hosts": True}}}

    def test_saved_list_is_stored_as_a_list(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        get_config().save({"backup.schedule.entity_types": ["tests", "suites"]})

        assert config_on_disk() == {"backup": {"schedule": {"entity_types": ["tests", "suites"]}}}

    def test_saved_none_is_stored_as_a_null_and_the_key_stays(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        load_config({"backup": {"schedule": {"entity_types": ["tests"], "max_backups": 5}}})

        get_config().save({"backup.schedule.entity_types": None})

        assert config_on_disk() == {
            "backup": {"schedule": {"entity_types": None, "max_backups": 5}}
        }

    @pytest.mark.parametrize("value", ["no", "on", "1:30", "true", "null", "8765"])
    def test_saved_text_is_the_same_text_after_a_restart(
        self, value: str, load_config: Callable[..., Any]
    ) -> None:
        get_config().save({"mcp.auth_username": value})

        assert load_config().get("mcp.auth_username") == value


class TestSavedListOfMaps:
    """A list of maps keeps the file's comments and layout and reads back equal (REQ-4.7.16)."""

    @pytest.mark.parametrize("tail", _LIST_TAILS.values(), ids=list(_LIST_TAILS))
    @pytest.mark.parametrize(("held", "saved"), _LIST_SAVES.values(), ids=list(_LIST_SAVES))
    def test_saved_address_list_changes_only_its_own_lines(
        self,
        held: list[dict[str, str]],
        saved: list[dict[str, str]],
        tail: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(_list_text(held, tail))
        expected = config_on_disk()
        expected["network"]["proxy"]["entries"] = _copies(saved)

        store({_ENTRIES: _copies(saved)})

        assert _list_lines(config_file.read_text(encoding="utf-8"), _LIST_HEAD, tail)
        assert config_on_disk() == expected

    @pytest.mark.parametrize("tail", _LIST_TAILS.values(), ids=list(_LIST_TAILS))
    @pytest.mark.parametrize("saved", [[_EXACT], _SEVERAL], ids=["one", "several"])
    def test_address_list_saved_over_a_null_keeps_the_lines_after_the_key(
        self,
        saved: list[dict[str, str]],
        tail: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        # A start refuses a null address list, so the null is a hand edit made after loading.
        config_file.write_text(f"{_LIST_HEAD}    entries: null\n{tail}", encoding="utf-8")
        expected = config_on_disk()
        expected["network"]["proxy"]["entries"] = _copies(saved)

        store({_ENTRIES: _copies(saved)})

        written = _list_lines(config_file.read_text(encoding="utf-8"), _LIST_HEAD, tail)
        assert written[0] == "    entries:"
        assert len(written) == 1 + 2 * len(saved)
        assert config_on_disk() == expected

    @pytest.mark.parametrize("address", _QUOTED_ADDRESSES.values(), ids=list(_QUOTED_ADDRESSES))
    def test_address_that_needs_quoting_reads_back_as_the_same_text(
        self,
        address: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
    ) -> None:
        tail = _LIST_TAILS["comment-follows"]
        load_config(_list_text([], tail))
        saved = [{"kind": "regex", "address": address}, dict(_EXACT)]

        store({_ENTRIES: _copies(saved)})

        assert _list_lines(config_file.read_text(encoding="utf-8"), _LIST_HEAD, tail)
        assert load_config().get(_ENTRIES) == saved

    @pytest.mark.parametrize("held", [[], [_EXACT], _SEVERAL], ids=["empty", "one", "several"])
    def test_address_list_the_file_already_holds_is_not_written(
        self,
        held: list[dict[str, str]],
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        load_config(_list_text(held, _LIST_TAILS["comment-follows"]))
        before = _aged_stamp(config_file)
        moves = _watch_replace(monkeypatch)

        store({_ENTRIES: _copies(held)})

        assert moves == []
        assert _stamp(config_file) == before

    @pytest.mark.parametrize("saved", [[], [_EXACT], _SEVERAL], ids=["empty", "one", "several"])
    def test_address_list_saved_into_a_file_without_the_key_is_stored_as_a_list_of_maps(
        self,
        saved: list[dict[str, str]],
        store: Callable[[dict[str, Any]], None],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        store({_ENTRIES: _copies(saved)})

        assert config_on_disk() == {"network": {"proxy": {"entries": saved}}}

    def test_address_list_saved_into_the_example_file_keeps_every_other_line(
        self, example_config: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        kept = [line for line in _lines(example_config) if line.strip() != "entries: []"]
        expected = config_on_disk()
        expected["network"].setdefault("proxy", {})["entries"] = [_REGEX]

        get_config().save({_ENTRIES: _copies(_SEVERAL)})
        get_config().save({_ENTRIES: _copies([_REGEX])})

        assert _added(kept, _lines(example_config))
        assert config_on_disk() == expected

    def test_saved_address_list_is_the_running_value_and_survives_a_restart(
        self, load_config: Callable[..., Any]
    ) -> None:
        get_config().save({_ENTRIES: _copies(_SEVERAL)})

        assert get_config().get(_ENTRIES) == _SEVERAL
        assert load_config().get(_ENTRIES) == _SEVERAL


class TestSavedEntityTypes:
    """A changed list of entity types keeps the lines that follow it (REQ-4.7.16)."""

    @pytest.mark.parametrize("tail", _TYPES_TAILS.values(), ids=list(_TYPES_TAILS))
    @pytest.mark.parametrize(("held", "saved"), _TYPES_SAVES.values(), ids=list(_TYPES_SAVES))
    def test_changed_entity_types_keep_the_lines_after_the_list(
        self,
        held: list[str],
        saved: list[str] | None,
        tail: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(_types_text(held, tail))
        expected = config_on_disk()
        expected["backup"]["schedule"]["entity_types"] = saved

        store({_TYPES: None if saved is None else list(saved)})

        assert _list_lines(config_file.read_text(encoding="utf-8"), _TYPES_HEAD, tail)
        assert config_on_disk() == expected

    @pytest.mark.parametrize("tail", _TYPES_TAILS.values(), ids=list(_TYPES_TAILS))
    @pytest.mark.parametrize("null", [" null", " ~", ""], ids=["null", "tilde", "nothing"])
    @pytest.mark.parametrize(
        "saved", [["tests"], ["tests", "suites", "profiles"]], ids=["one", "several"]
    )
    def test_entity_types_saved_over_a_null_keep_the_lines_after_the_key(
        self,
        saved: list[str],
        null: str,
        tail: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(f"{_TYPES_HEAD}    entity_types:{null}\n{tail}")
        expected = config_on_disk()
        expected["backup"]["schedule"]["entity_types"] = saved

        store({_TYPES: list(saved)})

        written = _list_lines(config_file.read_text(encoding="utf-8"), _TYPES_HEAD, tail)
        assert written[0] == "    entity_types:"
        assert len(written) == 1 + len(saved)
        assert config_on_disk() == expected

    @pytest.mark.parametrize(
        ("held", "saved", "key_line"),
        [
            (
                "    entity_types: null  # every type\n",
                ["tests", "suites"],
                r"    entity_types: +# every type",
            ),
            (
                "    entity_types: [tests, suites]  # only these\n",
                ["tests"],
                r"    entity_types: +# only these",
            ),
            (
                "    entity_types:  # only these\n      - tests\n      - suites\n",
                None,
                r"    entity_types: null +# only these",
            ),
            (
                "    entity_types:\n      - tests\n      - suites  # nightly only\n",
                ["tests"],
                r"    entity_types:",
            ),
        ],
        ids=[
            "after-a-null",
            "after-a-list-on-one-line",
            "after-the-key-of-a-list",
            "after-a-replaced-item",
        ],
    )
    def test_comment_at_the_end_of_a_line_stays_with_that_line(
        self,
        held: str,
        saved: list[str] | None,
        key_line: str,
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        tail = _TYPES_TAILS["comment-follows"]
        load_config(f"{_TYPES_HEAD}{held}{tail}")
        expected = config_on_disk()
        expected["backup"]["schedule"]["entity_types"] = saved

        store({_TYPES: None if saved is None else list(saved)})

        written = _list_lines(config_file.read_text(encoding="utf-8"), _TYPES_HEAD, tail)
        assert re.fullmatch(key_line, written[0])
        assert not any("#" in line for line in written[1:])
        assert config_on_disk() == expected


class TestMissingSections:
    @pytest.mark.parametrize(
        ("section", "key"),
        [("backup", "backup.schedule.enabled"), ("secret_masking", _FLAG)],
        ids=["last-section", "middle-section"],
    )
    def test_missing_section_is_appended_at_the_end_of_the_file(
        self, section: str, key: str, example_config: Path, load_config: Callable[..., Any]
    ) -> None:
        before = _without_section(example_config.read_text(encoding="utf-8"), section)
        load_config(before)

        get_config().save({key: True})

        after = example_config.read_text(encoding="utf-8")
        assert after.startswith(before)
        assert yaml.safe_load(after[len(before) :]) == _nest(key, True)

    def test_missing_nested_section_is_added_at_the_end_of_its_parent(
        self, example_config: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        before = _lines(example_config)
        expected = config_on_disk()
        expected["network"]["future_section"] = {"enabled": True}

        get_config().save({"network.future_section.enabled": True})

        after = _lines(example_config)
        added = _added(before, after)
        assert added
        assert after.index("    public_source: builtin") < added[0]
        assert added[-1] < after.index("mcp:")
        assert config_on_disk() == expected
        assert get_config().get("network.future_section.enabled") is True

    def test_missing_key_in_an_existing_section_adds_lines_only(
        self,
        example_config: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        text = example_config.read_text(encoding="utf-8").replace("  bind: local\n", "")
        load_config(text)
        expected = config_on_disk()
        expected["mcp"]["bind"] = "network"

        get_config().save({"mcp.bind": "network"})

        assert len(_added(text.splitlines(), _lines(example_config))) == 1
        assert config_on_disk() == expected


class TestHandEdits:
    def test_hand_edit_made_after_loading_survives_a_save_of_another_key(
        self, example_config: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        text = example_config.read_text(encoding="utf-8")
        edited = text.replace(
            "  level: INFO\n", "  level: INFO\n  # hand edit after load\n  my_unknown_key: 7\n"
        )
        assert edited != text
        example_config.write_text(edited, encoding="utf-8")
        before = edited.splitlines()

        get_config().save({_FLAG: True})

        after = _lines(example_config)
        assert _changed(before, after) == [before.index("  run_output: false")]
        assert "  # hand edit after load" in after
        assert config_on_disk()["logging"]["my_unknown_key"] == 7

    def test_hand_edited_value_is_not_overwritten_from_memory(
        self, example_config: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        text = example_config.read_text(encoding="utf-8")
        edited = text.replace("  port: 8765\n", "  port: 9100\n")
        assert edited != text
        example_config.write_text(edited, encoding="utf-8")

        get_config().save({_FLAG: True})

        assert config_on_disk()["mcp"]["port"] == 9100

    @pytest.mark.parametrize(
        "restyle",
        [_flush_lists, _wide_sections, _document_start],
        ids=["flush-lists", "four-space-sections", "leading-document-start"],
    )
    def test_style_of_a_hand_edited_file_is_kept(
        self,
        restyle: Callable[[str], str],
        example_config: Path,
        load_config: Callable[..., Any],
    ) -> None:
        original = example_config.read_text(encoding="utf-8")
        text = restyle(original)
        assert text != original
        load_config(text)
        before = text.splitlines()
        flag = next(
            index for index, line in enumerate(before) if line.strip() == "run_output: false"
        )

        get_config().save({_FLAG: True})

        after = _lines(example_config)
        assert _changed(before, after) == [flag]
        assert after[flag] == before[flag].replace("false", "true")


class TestFilesWithoutKeys:
    @pytest.mark.parametrize(
        "text",
        ["", "# WAVE config file.\n# Nothing set yet.\n"],
        ids=["empty", "comments-only"],
    )
    def test_save_writes_its_key_and_keeps_every_comment(
        self,
        text: str,
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(text)

        get_config().save({_FLAG: True})

        assert config_on_disk() == {"secret_masking": {"run_output": True}}
        assert _added(text.splitlines(), _lines(config_file))
        assert get_config().get(_FLAG) is True

    @pytest.mark.parametrize(
        "text",
        [
            "# kept\nnetwork:\nmcp:\n  port: 8765\n",
            "# kept\nnetwork:\n  # ssh_hosts:\n  #   lock_trusted_hosts: false\n"
            "mcp:\n  port: 8765\n",
        ],
        ids=["bare", "keys-commented-out"],
    )
    def test_section_key_with_nothing_under_it_is_filled_by_a_save(
        self,
        text: str,
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(text)

        get_config().save({_LOCK: True})

        assert config_on_disk() == {
            "network": {"ssh_hosts": {"lock_trusted_hosts": True}},
            "mcp": {"port": 8765},
        }
        assert _added(text.splitlines(), _lines(config_file))
        assert get_config().get(_LOCK) is True


class TestNothingToChange:
    @pytest.mark.parametrize("changes", [_HELD, {}], ids=["held-values", "no-keys"])
    def test_values_the_file_already_holds_are_not_written(
        self,
        changes: dict[str, Any],
        store: Callable[[dict[str, Any]], None],
        config_file: Path,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        load_config(_HELD_TEXT)
        before = _aged_stamp(config_file)
        moves = _watch_replace(monkeypatch)

        store(changes)

        assert moves == []
        assert _stamp(config_file) == before

    @pytest.mark.parametrize("changes", [_HELD, {}], ids=["held-values", "no-keys"])
    def test_nothing_to_change_is_not_refused_on_a_read_only_file(
        self,
        changes: dict[str, Any],
        store: Callable[[dict[str, Any]], None],
        read_only_config: Path,
        load_config: Callable[..., Any],
    ) -> None:
        load_config(_HELD_TEXT)
        before = _aged_stamp(read_only_config)

        store(changes)

        assert _stamp(read_only_config) == before

    def test_changed_key_beside_an_unchanged_one_is_refused_on_a_read_only_file(
        self,
        store: Callable[[dict[str, Any]], None],
        read_only_config: Path,
        load_config: Callable[..., Any],
    ) -> None:
        load_config(_HELD_TEXT)
        before = _aged_stamp(read_only_config)
        memory = get_config().to_dict(include_secrets=True)

        with pytest.raises(
            ConfigWriteError, match=_refusal(f"{_named(read_only_config)} is read-only")
        ):
            store({_FLAG: False, "mcp.port": 9000})

        assert _stamp(read_only_config) == before
        assert get_config().to_dict(include_secrets=True) == memory

    def test_unchanged_is_judged_against_the_file_not_the_running_config(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_HELD_TEXT)
        config_file.write_text(_HELD_TEXT.replace("port: 8765", "port: 9100"), encoding="utf-8")

        get_config().save({"mcp.port": 8765})

        assert config_file.read_text(encoding="utf-8") == _HELD_TEXT

    def test_value_only_the_file_holds_reaches_the_running_config_without_a_write(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_HELD_TEXT)
        config_file.write_text(_HELD_TEXT.replace("port: 8765", "port: 9100"), encoding="utf-8")
        before = _aged_stamp(config_file)

        get_config().save({"mcp.port": 9100})

        assert _stamp(config_file) == before
        assert get_config().get("mcp.port") == 9100


class TestRunningConfig:
    def test_saved_value_is_the_running_value(self) -> None:
        get_config().save({_FLAG: True})

        assert get_config().get(_FLAG) is True
        assert get_config().secret_masking.run_output is True

    def test_every_saved_key_reaches_the_running_config(self) -> None:
        get_config().save({"mcp.enabled": True, "mcp.port": 9000})

        assert get_config().get("mcp.enabled") is True
        assert get_config().get("mcp.port") == 9000

    def test_running_value_stays_the_old_one_while_the_file_is_written(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real_replace = os.replace
        seen: list[Any] = []

        def watching(src: Any, dst: Any) -> None:
            seen.append(get_config().get(_FLAG))
            real_replace(src, dst)
            seen.append(get_config().get(_FLAG))

        monkeypatch.setattr(os, "replace", watching)

        get_config().save({_FLAG: True})

        assert seen == [False, False]
        assert get_config().get(_FLAG) is True

    def test_saved_value_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        get_config().save({_FLAG: True, "mcp.port": 9000})

        restarted = load_config()

        assert restarted.get(_FLAG) is True
        assert restarted.get("mcp.port") == 9000

    def test_write_keys_alone_leaves_the_running_config_alone(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        write_keys(config_file, {_FLAG: True})

        assert config_on_disk() == {"secret_masking": {"run_output": True}}
        assert get_config().get(_FLAG) is False


class TestRefusals:
    def test_read_only_file_is_refused_before_anything_is_written(
        self, read_only_config: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        before = _state(read_only_config)
        moves = _watch_replace(monkeypatch)

        with pytest.raises(
            ConfigWriteError, match=_refusal(f"{_named(read_only_config)} is read-only")
        ):
            get_config().save({_FLAG: True})

        assert moves == []
        assert _state(read_only_config) == before
        assert get_config().get(_FLAG) is False

    def test_refusal_is_an_internal_server_error_carrying_the_message(
        self, read_only_config: Path
    ) -> None:
        with pytest.raises(ConfigWriteError) as caught:
            get_config().save({_FLAG: True})

        error = caught.value
        assert isinstance(error, InternalServerException)
        assert (error.status_code, error.error_code) == (500, "INTERNAL_ERROR")
        assert error.message == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert str(error) == error.message

    def test_file_that_no_longer_parses_is_refused(self, config_file: Path) -> None:
        config_file.write_text("logging: [unclosed\n", encoding="utf-8")
        before = _state(config_file)

        with pytest.raises(
            ConfigWriteError, match=_refusal(f"{_named(config_file)} cannot be read: .+")
        ) as caught:
            get_config().save({_FLAG: True})

        assert "\n" not in caught.value.message
        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False

    @pytest.mark.parametrize(
        "content",
        [b"mcp:\n  auth_username: \xff\xfe\n", b"mcp:\n  port: 1\n  port: 2\n"],
        ids=["not-utf8", "duplicated-key"],
    )
    def test_file_that_is_no_longer_valid_is_refused_as_unreadable(
        self, content: bytes, config_file: Path
    ) -> None:
        config_file.write_bytes(content)
        before = _state(config_file)

        with pytest.raises(
            ConfigWriteError, match=_refusal(f"{_named(config_file)} cannot be read: .+")
        ) as caught:
            get_config().save({_FLAG: True})

        assert "\n" not in caught.value.message
        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False

    def test_file_holding_a_duplicated_key_is_refused_with_its_line_and_name(
        self, config_file: Path
    ) -> None:
        config_file.write_bytes(b"mcp:\n  port: 1\n  port: 2\n")
        before = _state(config_file)

        with pytest.raises(ConfigWriteError) as caught:
            get_config().save({_FLAG: True})

        assert caught.value.message == (
            f"Settings cannot be saved: the config file {config_file} cannot be read: "
            'line 3: found duplicate key "port"'
        )
        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False

    def test_file_deleted_after_loading_is_refused_as_unreadable(self, config_file: Path) -> None:
        config_file.unlink()

        with pytest.raises(
            ConfigWriteError,
            match=_refusal(f"{_named(config_file)} cannot be read: No such file or directory"),
        ):
            get_config().save({_FLAG: True})

        assert list(config_file.parent.iterdir()) == []
        assert get_config().get(_FLAG) is False

    def test_file_that_cannot_be_read_is_refused(self, config_file: Path) -> None:
        config_file.chmod(0o200)

        try:
            with pytest.raises(
                ConfigWriteError, match=_refusal(f"{_named(config_file)} cannot be read: .+")
            ):
                get_config().save({_FLAG: True})
        finally:
            config_file.chmod(0o600)

        assert config_file.read_bytes() == b"{}\n"
        assert sorted(config_file.parent.iterdir()) == [config_file]
        assert get_config().get(_FLAG) is False

    @pytest.mark.parametrize("text", ["- a\n- b\n", "just text\n"], ids=["list", "text"])
    def test_file_that_no_longer_holds_a_mapping_is_refused(
        self, text: str, config_file: Path
    ) -> None:
        config_file.write_text(text, encoding="utf-8")
        before = _state(config_file)

        with pytest.raises(
            ConfigWriteError,
            match=_refusal(f"{_named(config_file)} does not hold a YAML mapping"),
        ):
            get_config().save({_FLAG: True})

        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False

    @pytest.mark.parametrize(
        ("text", "prefix"),
        [
            ("network: 5\n", "network"),
            ("network:\n  - a\n", "network"),
            ("network:\n  ssh_hosts: strict\n", "network.ssh_hosts"),
        ],
        ids=["number", "list", "nested-text"],
    )
    def test_key_under_a_value_that_is_not_a_section_is_refused(
        self, text: str, prefix: str, config_file: Path
    ) -> None:
        config_file.write_text(text, encoding="utf-8")
        before = _state(config_file)

        with pytest.raises(
            ConfigWriteError,
            match=_refusal(f"{re.escape(prefix)} in {_named(config_file)} is not a section"),
        ):
            get_config().save({_FLAG: True, _LOCK: True})

        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False
        assert get_config().get(_LOCK) is False

    def test_failed_write_is_refused_and_leaves_no_temp_file(
        self, config_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        before = _state(config_file)
        temp_files: list[Path] = []

        def refuse(src: Any, dst: Any) -> None:
            temp_files.append(Path(src))
            raise OSError(errno.ENOSPC, "No space left on device")

        monkeypatch.setattr(os, "replace", refuse)

        with pytest.raises(
            ConfigWriteError,
            match=_refusal(f"{_named(config_file)} cannot be written: No space left on device"),
        ):
            get_config().save({_FLAG: True})

        assert len(temp_files) == 1
        assert not temp_files[0].exists()
        assert list(config_file.parent.glob(".config.yaml.*.tmp")) == []
        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False

    def test_folder_that_cannot_be_written_is_refused(self, config_file: Path) -> None:
        before = _state(config_file)
        folder = config_file.parent
        folder.chmod(0o500)

        try:
            with pytest.raises(
                ConfigWriteError,
                match=_refusal(f"{_named(config_file)} cannot be written: Permission denied"),
            ):
                get_config().save({_FLAG: True})
        finally:
            folder.chmod(0o700)

        assert _state(config_file) == before
        assert get_config().get(_FLAG) is False


class TestSettingTheNextStartWouldRefuse:
    @pytest.mark.parametrize(
        ("key", "value", "problem"),
        [
            (
                "logging.level",
                "LOUD",
                "logging.level must be one of DEBUG, INFO, WARN, ERROR, FATAL",
            ),
            ("mcp.enabled", "yes", "mcp.enabled must be true or false"),
            ("mcp.port", "+8765", "mcp.port must be a whole number from 1024 to 65535"),
            ("mcp.auth_username", 5, "mcp.auth_username must be text"),
            (
                "backup.schedule.entity_types",
                {"tests": True},
                "backup.schedule.entity_types must be a list of entity type names or null",
            ),
            ("backup.schedule.compression_level", 99, _LEVEL_PROBLEM),
            ("backup.schedule.compression_level", 6.5, _LEVEL_PROBLEM),
            (
                "network.proxy.port",
                70000,
                "network.proxy.port must be a whole number from 1 to 65535 or empty",
            ),
            (
                "network.proxy.password",
                "plain",
                "network.proxy.password must be set from Settings > Network > Proxy, "
                "where it is stored sealed",
            ),
            (
                _ENTRIES,
                [{"kind": "exact"}],
                "network.proxy.entries must be a list of entries "
                "with a kind (exact or regex) and an address",
            ),
        ],
        ids=[
            "unknown-level",
            "switch-as-text",
            "port-as-text-with-a-plus",
            "username-as-number",
            "entity-types-as-mapping",
            "level-out-of-range",
            "level-not-whole",
            "proxy-port-out-of-range",
            "proxy-password-as-plain-text",
            "address-list-entry-without-an-address",
        ],
    )
    def test_save_refuses_it_with_the_words_of_the_start_and_writes_nothing(
        self,
        config_file: Path,
        load_config: Callable[..., Any],
        key: str,
        value: Any,
        problem: str,
    ) -> None:
        before = _state(config_file)

        with pytest.raises(ValidationException, match=f"^{re.escape(problem)}$"):
            get_config().save({key: value})

        assert _state(config_file) == before
        with pytest.raises(
            ConfigValidationError,
            match=f"^Config file {re.escape(str(config_file))}: {re.escape(problem)}$",
        ):
            load_config(_nest(key, value))

    def test_refusal_is_a_validation_error_carrying_the_rule(self) -> None:
        with pytest.raises(ValidationException) as caught:
            get_config().save({"mcp.enabled": "yes"})

        error = caught.value
        assert (error.status_code, error.error_code) == (400, "VALIDATION_ERROR")
        assert error.message == "mcp.enabled must be true or false"

    def test_valid_setting_saved_beside_a_refused_one_is_not_written(
        self, config_file: Path
    ) -> None:
        before = _state(config_file)

        with pytest.raises(ValidationException, match="^mcp.enabled must be true or false$"):
            get_config().save({_FLAG: True, "mcp.enabled": "yes"})

        assert _state(config_file) == before

    def test_rule_that_reads_another_setting_sees_the_values_being_saved(
        self, config_file: Path
    ) -> None:
        before = _state(config_file)

        with pytest.raises(ValidationException, match=f"^{_ACTION_PROBLEM}$"):
            get_config().save({_LOCK: True, _ACTION: "accept-new"})

        assert _state(config_file) == before

    def test_rule_that_reads_another_setting_sees_the_running_value(
        self, config_file: Path
    ) -> None:
        get_config().save({_LOCK: True, _ACTION: "strict"})
        before = _state(config_file)

        with pytest.raises(ValidationException, match=f"^{_ACTION_PROBLEM}$"):
            get_config().save({_ACTION: "accept-new"})

        assert _state(config_file) == before


class TestSaveChanged:
    """Config.save_changed saves the values that differ from the running section."""

    @pytest.mark.parametrize(
        "values",
        [
            {"port": 8765, "auth_username": "", "auth_password": None},
            {"enabled": False, "bind": "local"},
            {},
        ],
        ids=["held-by-the-file", "running-defaults", "no-keys"],
    )
    def test_nothing_differs_writes_nothing_and_returns_false(
        self,
        values: dict[str, Any],
        config_file: Path,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        load_config(_HELD_TEXT)
        stamp = _aged_stamp(config_file)
        before = _state(config_file)
        moves = _watch_replace(monkeypatch)

        saved = get_config().save_changed("mcp", values)

        assert saved is False
        assert moves == []
        assert _stamp(config_file) == stamp
        assert _state(config_file) == before

    def test_nothing_differs_is_not_refused_on_a_read_only_file(
        self, read_only_config: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_HELD_TEXT)
        stamp = _aged_stamp(read_only_config)

        saved = get_config().save_changed("mcp", {"port": 8765, "bind": "local"})

        assert saved is False
        assert _stamp(read_only_config) == stamp

    def test_unchanged_is_judged_against_the_running_config_not_the_file(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_HELD_TEXT)
        config_file.write_text(_HELD_TEXT.replace("port: 8765", "port: 9100"), encoding="utf-8")
        stamp = _aged_stamp(config_file)

        saved = get_config().save_changed("mcp", {"port": 8765})

        assert saved is False
        assert _stamp(config_file) == stamp

    def test_only_the_key_that_differs_is_written_and_true_is_returned(
        self, config_on_disk: Callable[[], dict[str, Any]], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        moves = _watch_replace(monkeypatch)

        saved = get_config().save_changed("mcp", {"enabled": True, "port": 8765, "bind": "local"})

        assert saved is True
        assert len(moves) == 1
        assert config_on_disk() == {"mcp": {"enabled": True}}
        assert get_config().get("mcp.enabled") is True

    def test_every_key_that_differs_is_written_in_one_write(
        self, config_on_disk: Callable[[], dict[str, Any]], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        moves = _watch_replace(monkeypatch)

        saved = get_config().save_changed("mcp", {"enabled": True, "port": 9000, "bind": "local"})

        assert saved is True
        assert len(moves) == 1
        assert config_on_disk() == {"mcp": {"enabled": True, "port": 9000}}

    def test_saved_values_are_the_running_values(self) -> None:
        get_config().save_changed("mcp", {"enabled": True, "port": 9000})

        assert get_config().get("mcp.enabled") is True
        assert get_config().get("mcp.port") == 9000
        assert get_config().get("mcp.bind") == "local"

    @pytest.mark.parametrize(
        ("prefix", "values", "written"),
        [
            (
                "network.ssh_hosts",
                {"lock_trusted_hosts": True, "default_block_action": "disabled"},
                {"network": {"ssh_hosts": {"lock_trusted_hosts": True}}},
            ),
            (
                "backup.schedule",
                {"cron": "0 2 * * *", "max_backups": 5, "entity_types": None},
                {"backup": {"schedule": {"cron": "0 2 * * *"}}},
            ),
        ],
        ids=["network.ssh_hosts", "backup.schedule"],
    )
    def test_nested_prefix_writes_only_the_keys_that_differ(
        self,
        prefix: str,
        values: dict[str, Any],
        written: dict[str, Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        saved = get_config().save_changed(prefix, values)

        assert saved is True
        assert config_on_disk() == written

    def test_changed_key_changes_only_its_own_line_of_the_example(
        self, example_config: Path
    ) -> None:
        before = _lines(example_config)

        saved = get_config().save_changed(
            "mcp", {"enabled": False, "port": 9000, "bind": "local", "auth_username": ""}
        )

        assert saved is True
        assert _changed(before, _lines(example_config)) == [before.index("  port: 8765")]

    def test_hand_edit_of_an_unchanged_key_survives_a_save_of_another_key(
        self,
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(_HELD_TEXT)
        config_file.write_text(_HELD_TEXT.replace("port: 8765", "port: 9100"), encoding="utf-8")

        saved = get_config().save_changed("mcp", {"port": 8765, "auth_username": "alice"})

        assert saved is True
        assert config_on_disk()["mcp"] == {
            "port": 9100,
            "auth_username": "alice",
            "auth_password": None,
        }

    def test_equal_address_list_is_not_a_change(self, config_file: Path) -> None:
        get_config().save({_ENTRIES: _copies(_SEVERAL)})
        stamp = _aged_stamp(config_file)

        saved = get_config().save_changed("network.proxy", {"entries": _copies(_SEVERAL)})

        assert saved is False
        assert _stamp(config_file) == stamp

    def test_changed_address_list_is_written(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        get_config().save({_ENTRIES: _copies(_SEVERAL)})

        saved = get_config().save_changed("network.proxy", {"entries": _copies([_REGEX])})

        assert saved is True
        assert config_on_disk() == {"network": {"proxy": {"entries": [_REGEX]}}}
        assert get_config().get(_ENTRIES) == [_REGEX]

    def test_read_only_file_is_refused_as_a_save_is(self, read_only_config: Path) -> None:
        before = _state(read_only_config)

        with pytest.raises(
            ConfigWriteError, match=_refusal(f"{_named(read_only_config)} is read-only")
        ):
            get_config().save_changed("mcp", {"enabled": True, "port": 8765})

        assert _state(read_only_config) == before
        assert get_config().get("mcp.enabled") is False

    def test_setting_the_next_start_would_refuse_is_refused_as_a_save_is(
        self, config_file: Path
    ) -> None:
        before = _state(config_file)

        with pytest.raises(
            ValidationException, match="^mcp\\.port must be a whole number from 1024 to 65535$"
        ):
            get_config().save_changed("mcp", {"enabled": True, "port": "8765.0"})

        assert _state(config_file) == before

    def test_a_whole_number_sent_as_its_digits_is_saved_as_the_number(
        self, config_on_disk: Callable[[], dict[str, Any]], load_config: Callable[..., Any]
    ) -> None:
        saved = get_config().save_changed("mcp", {"port": "09100"})

        assert saved is True
        assert config_on_disk() == {"mcp": {"port": 9100}}
        assert get_config().get("mcp.port") == 9100
        assert load_config().get("mcp.port") == 9100

    def test_the_digits_of_the_number_in_force_change_nothing(self, config_file: Path) -> None:
        get_config().save({"mcp.port": 9100})
        before = _state(config_file)

        assert get_config().save_changed("mcp", {"port": "9100"}) is False
        assert _state(config_file) == before

    def test_text_that_is_not_digits_is_compared_as_it_is(self) -> None:
        with pytest.raises(ValidationException, match="^mcp\\.port must be a whole number"):
            get_config().save_changed("mcp", {"port": "port"})


class TestFileIdentity:
    def test_save_moves_a_temp_file_beside_the_config_file_into_place(
        self, config_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        moves = _watch_replace(monkeypatch)

        get_config().save({_FLAG: True})

        assert len(moves) == 1
        source, target = moves[0]
        assert target == config_file.resolve()
        assert source.parent == target.parent
        assert fnmatch(source.name, ".config.yaml.*.tmp")
        assert sorted(config_file.parent.iterdir()) == [config_file]

    def test_file_mode_is_kept(self, config_file: Path) -> None:
        config_file.chmod(0o640)

        get_config().save({_FLAG: True})

        assert stat.S_IMODE(config_file.stat().st_mode) == 0o640

    def test_symlinked_config_file_updates_its_target_and_stays_a_link(
        self, config_file: Path, linked_target: Path
    ) -> None:
        get_config().save({_FLAG: True})

        assert config_file.is_symlink()
        assert config_file.readlink() == linked_target
        assert linked_target.read_text(encoding="utf-8") == _SMALL.replace("false", "true")
        assert not linked_target.is_symlink()
        assert sorted(linked_target.parent.iterdir()) == [linked_target]
        assert sorted(config_file.parent.iterdir()) == [config_file]

    def test_mode_of_a_symlinked_config_file_is_the_mode_of_its_target(
        self, config_file: Path, linked_target: Path
    ) -> None:
        linked_target.chmod(0o640)

        get_config().save({_FLAG: True})

        assert stat.S_IMODE(linked_target.stat().st_mode) == 0o640

    def test_refusal_names_the_link_and_not_its_target(
        self, config_file: Path, linked_target: Path
    ) -> None:
        linked_target.write_text("- a\n", encoding="utf-8")

        with pytest.raises(
            ConfigWriteError,
            match=_refusal(f"{_named(config_file)} does not hold a YAML mapping"),
        ):
            get_config().save({_FLAG: True})

        assert config_file.is_symlink()
        assert linked_target.read_text(encoding="utf-8") == "- a\n"

    def test_non_ascii_value_is_written_as_utf8_and_read_back(
        self,
        config_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config('# Grüße\nmcp:\n  auth_username: ""\n')

        get_config().save({"mcp.auth_username": "zoë-日本"})

        raw = config_file.read_bytes()
        assert "zoë-日本".encode() in raw
        assert "# Grüße".encode() in raw
        assert config_on_disk() == {"mcp": {"auth_username": "zoë-日本"}}
        assert load_config().get("mcp.auth_username") == "zoë-日本"

    def test_windows_line_ends_are_kept(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        before = b"# kept\r\nsecret_masking:\r\n  run_output: false\r\nmcp:\r\n  port: 8765\r\n"
        config_file.write_bytes(before)
        load_config()

        get_config().save({_FLAG: True})

        raw = config_file.read_bytes()
        assert raw.count(b"\n") == raw.count(b"\r\n")
        assert raw == before.replace(b"run_output: false", b"run_output: true")
        assert raw.startswith(b"# kept\r\n")

    def test_windows_line_ends_of_a_file_without_keys_are_kept(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        config_file.write_bytes(b"# WAVE config file.\r\n# Nothing set yet.\r\n")
        load_config()

        get_config().save({_FLAG: True})

        assert config_file.read_bytes() == (
            b"# WAVE config file.\r\n# Nothing set yet.\r\n"
            b"secret_masking:\r\n  run_output: true\r\n"
        )

    def test_mixed_line_ends_are_written_as_windows_line_ends(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        config_file.write_bytes(b"# kept\r\nsecret_masking:\n  run_output: false\n")
        load_config()

        get_config().save({_FLAG: True})

        assert config_file.read_bytes() == b"# kept\r\nsecret_masking:\r\n  run_output: true\r\n"

    def test_unix_line_ends_are_kept(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_SMALL)

        get_config().save({_FLAG: True})

        raw = config_file.read_bytes()
        assert b"\r" not in raw
        assert raw == _SMALL.replace("false", "true").encode()


class TestConcurrentSaves:
    def test_two_threads_saving_different_keys_both_land(
        self, config_on_disk: Callable[[], dict[str, Any]], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _slow_replace(monkeypatch)
        config = get_config()

        errors = _run_together(
            lambda: config.save({_FLAG: True}),
            lambda: config.save({"mcp.port": 9000}),
        )

        assert errors == []
        assert config_on_disk() == {"secret_masking": {"run_output": True}, "mcp": {"port": 9000}}
        assert config.get(_FLAG) is True
        assert config.get("mcp.port") == 9000

    def test_two_threads_writing_keys_directly_both_land(
        self,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _slow_replace(monkeypatch)

        errors = _run_together(
            lambda: write_keys(config_file, {_FLAG: True}),
            lambda: write_keys(config_file, {"mcp.port": 9000}),
        )

        assert errors == []
        assert config_on_disk() == {"secret_masking": {"run_output": True}, "mcp": {"port": 9000}}

    def test_write_waits_for_the_lock_of_the_config_file(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        held = threading.Event()
        release = threading.Event()

        def hold() -> None:
            with settings_file.locked(config_file):
                held.set()
                release.wait(_BOUND)

        holder = threading.Thread(target=hold, daemon=True)
        holder.start()
        assert held.wait(_BOUND)
        writer = threading.Thread(
            target=lambda: write_keys(config_file, {_FLAG: True}), daemon=True
        )
        writer.start()
        try:
            writer.join(_SETTLE)
            assert config_file.read_bytes() == b"{}\n"
        finally:
            release.set()
            holder.join(_BOUND)

        writer.join(_BOUND)
        assert config_on_disk() == {"secret_masking": {"run_output": True}}


class TestRefusedSaveKeepsTheFileValuesToItself:
    def test_refusal_does_not_carry_the_values_of_a_duplicated_key(self, config_file: Path) -> None:
        config_file.write_text(_TWICE, encoding="utf-8")

        with pytest.raises(ConfigWriteError) as caught:
            get_config().save({_FLAG: True})

        trace = "".join(traceback.format_exception(caught.value))
        assert "found duplicate key" in trace
        assert "first-secret" not in trace
        assert "second-secret" not in trace

    def test_route_puts_the_values_in_neither_the_answer_nor_the_log(
        self, client: TestClient, config_file: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        config_file.write_text(_TWICE, encoding="utf-8")

        with caplog.at_level("DEBUG"):
            response = client.put("/admin/secret-masking", json={"run_output": True})

        assert response.status_code == 500
        assert "found duplicate key" in response.json()["error"]["message"]
        for value in ("first-secret", "second-secret"):
            assert value not in response.text
            assert value not in caplog.text


class TestRefusedSaveOnARoute:
    def test_read_only_config_answers_500_with_the_message_in_the_envelope(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        before = _state(read_only_config)

        response = client.put("/admin/secret-masking", json={"run_output": True})

        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "INTERNAL_ERROR"
        assert error["message"] == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert _state(read_only_config) == before
        assert get_config().get(_FLAG) is False
        assert client.get("/admin/secret-masking").json()["run_output"] is False
