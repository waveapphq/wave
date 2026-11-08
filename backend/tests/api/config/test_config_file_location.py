"""Where WAVE finds its config file, and when it refuses to load one (REQ-4.7.15).

WAVE reads one config file: ``config/config.yaml`` in the folder that holds the
``wavecore`` package, or the file ``WAVE_CONFIG_FILE`` names. The launch folder
and ``WAVE_ENV`` never select a file.
"""

import builtins
import errno
import io
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

import wavecore
from tests.conftest import EXAMPLE_CONFIG_FILE
from wavecore.api import config as config_package
from wavecore.api.config import loader
from wavecore.api.config.loader import Config, ConfigValidationError

BACKEND_DIR = Path(__file__).resolve().parents[3]

SENTINEL_FILES = (
    "config/config.yaml",
    "config.yaml",
    "config/development.yaml",
    "config.development.yaml",
    "config/production.yaml",
    "config.production.yaml",
)

BAD_YAML = (
    "server: [unclosed\n",
    "server: port: 1\n",
    "server:\n  port: 1\n bad: indent\n",
)

DUPLICATED_KEYS = (
    "server:\n  port: 4100\nserver:\n  port: 4101\n",
    "server:\n  port: 4100\n  port: 4101\n",
    '{"server": {"port": 4100, "port": 4101}}\n',
)


def _write(path: Path, data: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


def _not_found(path: Path) -> str:
    return (
        rf"^Config file not found: {re.escape(str(path))} "
        r"\(set WAVE_CONFIG_FILE to use another file\)$"
    )


def _cannot_be_read(path: Path, reason: str) -> str:
    return rf"^Config file {re.escape(str(path))} cannot be read: {reason}$"


def _not_a_mapping(path: Path) -> str:
    return rf"^Config file {re.escape(str(path))} does not hold a YAML mapping$"


def _deny_reading(monkeypatch: pytest.MonkeyPatch, target: Path) -> None:
    """Make every open of ``target`` fail the way an unreadable file does."""
    real_open = builtins.open

    def guarded(file: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(file, str | os.PathLike) and os.fspath(file) == str(target):
            raise PermissionError(errno.EACCES, "Permission denied", str(target))
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", guarded)
    monkeypatch.setattr(io, "open", guarded)


@pytest.fixture
def located_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A config file of the test's own, named by ``WAVE_CONFIG_FILE``."""
    path = _write(
        tmp_path / "etc" / "wave" / "wave.yaml",
        {"server": {"host": "located.example", "port": 4100}},
    )
    monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))
    return path


@pytest.fixture
def launch_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The current folder, holding a sentinel file at every name WAVE must not read."""
    launch = tmp_path / "launch"
    for index, name in enumerate(SENTINEL_FILES):
        _write(
            launch / name,
            {
                "server": {"host": f"sentinel-{index}.example", "port": 4200 + index},
                "logging": {"level": "DEBUG"},
                "security": {"cors_origins": [f"http://sentinel-{index}.example"]},
            },
        )
    monkeypatch.chdir(launch)
    return launch


def _assert_only_the_located_file_was_read(config: Config) -> None:
    assert config.server.host == "located.example"
    assert config.server.port == 4100
    assert config.logging.level == "INFO"
    assert config.security.cors_origins == []


class TestWaveDir:
    def test_wave_dir_is_the_folder_holding_the_wavecore_package(self) -> None:
        result = loader.wave_dir()

        assert result == Path(wavecore.__file__).resolve().parent.parent
        assert (result / "wavecore").is_dir()

    def test_wave_dir_is_the_backend_folder_in_the_repository(self) -> None:
        assert loader.wave_dir() == BACKEND_DIR

    def test_wave_dir_is_absolute(self) -> None:
        assert loader.wave_dir().is_absolute()

    def test_wave_dir_does_not_follow_the_launch_folder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)

        assert loader.wave_dir() == BACKEND_DIR


class TestLocateConfigFile:
    def test_variable_name_is_wave_config_file(self) -> None:
        assert loader.CONFIG_FILE_ENV == "WAVE_CONFIG_FILE"

    def test_default_is_config_yaml_in_the_wave_folder(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_CONFIG_FILE")

        result = loader.locate_config_file()

        assert isinstance(result, Path)
        assert result == loader.wave_dir() / "config" / "config.yaml"
        assert result == BACKEND_DIR / "config" / "config.yaml"

    def test_empty_variable_counts_as_not_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WAVE_CONFIG_FILE", "")

        assert loader.locate_config_file() == loader.wave_dir() / "config" / "config.yaml"

    def test_absolute_variable_is_used(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = _write(tmp_path / "etc" / "wave" / "wave.yaml", {})
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))

        result = loader.locate_config_file()

        assert isinstance(result, Path)
        assert result == path

    def test_located_path_is_not_symlink_resolved(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = _write(tmp_path / "real" / "wave.yaml", {})
        link = tmp_path / "link.yaml"
        link.symlink_to(target)
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(link))

        assert loader.locate_config_file() == link

    def test_relative_variable_is_refused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("WAVE_CONFIG_FILE", "conf/wave.yaml")

        with pytest.raises(
            ConfigValidationError,
            match=r"^WAVE_CONFIG_FILE must be an absolute path: conf/wave\.yaml$",
        ):
            loader.locate_config_file()

    def test_package_exports_the_location_functions(self) -> None:
        assert config_package.locate_config_file is loader.locate_config_file
        assert config_package.wave_dir is loader.wave_dir
        assert {"locate_config_file", "wave_dir"} <= set(config_package.__all__)


class TestConfigLoadsTheLocatedFile:
    def test_config_without_an_argument_loads_the_located_file(self, located_file: Path) -> None:
        config = Config()

        assert config.server.host == "located.example"
        assert config.server.port == 4100

    def test_explicit_file_wins_over_the_variable(self, located_file: Path, tmp_path: Path) -> None:
        explicit = _write(tmp_path / "explicit.yaml", {"server": {"port": 4101}})

        config = Config(config_file=str(explicit))

        assert config.server.port == 4101
        assert config.server.host == "0.0.0.0"

    def test_singleton_loads_the_located_file(self, located_file: Path) -> None:
        loader._config_instance = None

        config = loader.get_config()

        assert config.server.port == 4100
        assert config.config_file == located_file

    def test_config_file_is_the_located_path(self, located_file: Path) -> None:
        result = Config().config_file

        assert isinstance(result, Path)
        assert result.is_absolute()
        assert result == located_file

    def test_config_file_is_the_explicit_path(self, tmp_path: Path) -> None:
        explicit = _write(tmp_path / "explicit.yaml", {})

        assert Config(config_file=str(explicit)).config_file == explicit

    def test_config_file_is_not_symlink_resolved(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = _write(tmp_path / "real" / "wave.yaml", {"server": {"port": 4102}})
        link = tmp_path / "link.yaml"
        link.symlink_to(target)
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(link))

        config = Config()

        assert config.server.port == 4102
        assert config.config_file == link

    @pytest.mark.parametrize("name", ["wave.json", "wave.yaml", "wave.conf"])
    def test_json_syntax_file_loads(
        self, name: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / name
        document = {
            "server": {"host": "json.example.com", "port": 6000},
            "security": {"cors_origins": ["http://localhost:3000"]},
        }
        path.write_text(json.dumps(document), encoding="utf-8")
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))

        config = Config()

        assert config.server.host == "json.example.com"
        assert config.server.port == 6000
        assert config.security.cors_origins == ["http://localhost:3000"]


class TestLaunchFolderIsNeverRead:
    def test_launch_folder_files_are_not_read(
        self, launch_folder: Path, located_file: Path
    ) -> None:
        _assert_only_the_located_file_was_read(Config())

    @pytest.mark.parametrize("environment", ["development", "production"])
    def test_wave_env_selects_no_file(
        self,
        environment: str,
        launch_folder: Path,
        located_file: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("WAVE_ENV", environment)

        _assert_only_the_located_file_was_read(Config())

    def test_wave_env_changes_nothing(
        self, launch_folder: Path, located_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_ENV", raising=False)
        without = Config().to_dict(include_secrets=True)
        monkeypatch.setenv("WAVE_ENV", "production")

        assert Config().to_dict(include_secrets=True) == without
        assert loader.locate_config_file() == located_file

    def test_per_environment_file_lookup_is_gone(self) -> None:
        assert not hasattr(Config, "_find_env_config_file")

    def test_default_location_is_not_in_the_launch_folder(
        self, launch_folder: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("WAVE_CONFIG_FILE")
        monkeypatch.setenv("WAVE_ENV", "production")

        result = loader.locate_config_file()

        assert result == BACKEND_DIR / "config" / "config.yaml"
        assert launch_folder not in result.parents

    def test_relative_variable_is_not_resolved_against_the_launch_folder(
        self, launch_folder: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _write(launch_folder / "conf" / "wave.yaml", {"server": {"port": 4300}})
        monkeypatch.setenv("WAVE_CONFIG_FILE", "conf/wave.yaml")

        with pytest.raises(
            ConfigValidationError,
            match=r"^WAVE_CONFIG_FILE must be an absolute path: conf/wave\.yaml$",
        ):
            Config()


class TestMissingFile:
    def test_missing_located_file_is_refused(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "missing.yaml"
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))

        with pytest.raises(ConfigValidationError, match=_not_found(path)):
            Config()

    def test_missing_explicit_file_is_refused(self, tmp_path: Path) -> None:
        path = tmp_path / "absent" / "missing.yaml"

        with pytest.raises(ConfigValidationError, match=_not_found(path)):
            Config(config_file=str(path))

    def test_missing_file_is_not_replaced_by_a_launch_folder_file(
        self, launch_folder: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "etc" / "config.yaml"
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))

        with pytest.raises(ConfigValidationError, match=_not_found(path)):
            Config()

    def test_missing_file_is_refused_by_the_singleton(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "missing.yaml"
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))
        loader._config_instance = None

        with pytest.raises(ConfigValidationError, match=_not_found(path)):
            loader.get_config()

        assert loader._config_instance is None


class TestUnreadableFile:
    def test_read_error_is_refused_with_the_os_error_text(
        self, located_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _deny_reading(monkeypatch, located_file)

        with pytest.raises(
            ConfigValidationError, match=_cannot_be_read(located_file, "Permission denied")
        ):
            Config()

    @pytest.mark.parametrize("text", BAD_YAML)
    def test_file_that_does_not_parse_is_refused_in_one_line(
        self, text: str, located_file: Path
    ) -> None:
        located_file.write_text(text, encoding="utf-8")

        with pytest.raises(
            ConfigValidationError, match=_cannot_be_read(located_file, ".+")
        ) as refusal:
            Config()

        assert "\n" not in str(refusal.value)

    def test_json_syntax_file_that_does_not_parse_is_refused_the_same_way(
        self, tmp_path: Path
    ) -> None:
        path = tmp_path / "wave.json"
        path.write_text('{"server": {"port": 6000}', encoding="utf-8")

        with pytest.raises(ConfigValidationError, match=_cannot_be_read(path, ".+")) as refusal:
            Config(config_file=str(path))

        assert "\n" not in str(refusal.value)

    @pytest.mark.parametrize("text", DUPLICATED_KEYS, ids=["top-level", "nested", "json-syntax"])
    def test_duplicated_key_is_refused_in_one_line(self, text: str, located_file: Path) -> None:
        located_file.write_text(text, encoding="utf-8")

        with pytest.raises(
            ConfigValidationError, match=_cannot_be_read(located_file, ".+")
        ) as refusal:
            Config()

        assert "\n" not in str(refusal.value)

    def test_duplicated_key_is_refused_with_its_line_and_name(self, located_file: Path) -> None:
        located_file.write_text("mcp:\n  port: 1024\n  port: 2048\n", encoding="utf-8")

        with pytest.raises(ConfigValidationError) as refusal:
            Config()

        assert str(refusal.value) == (
            f'Config file {located_file} cannot be read: line 3: found duplicate key "port"'
        )

    def test_duplicated_key_is_refused_without_its_values(self, located_file: Path) -> None:
        located_file.write_text(
            "security:\n  secret_key: first-secret\n  secret_key: second-secret\n",
            encoding="utf-8",
        )

        with pytest.raises(ConfigValidationError) as refusal:
            Config()

        message = str(refusal.value)
        assert message == (
            f'Config file {located_file} cannot be read: line 3: found duplicate key "secret_key"'
        )
        assert "first-secret" not in message
        assert "second-secret" not in message

    def test_duplicated_key_holding_a_line_break_is_refused_in_one_line(
        self, located_file: Path
    ) -> None:
        located_file.write_text('"a\\nb": 1\n"a\\nb": 2\n', encoding="utf-8")

        with pytest.raises(ConfigValidationError) as refusal:
            Config()

        assert str(refusal.value) == (
            f'Config file {located_file} cannot be read: line 2: found duplicate key "a'
        )

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            (
                "logging:\n  level: INFO\n  file: a: b\n",
                "line 3: mapping values are not allowed here",
            ),
            (
                "logging:\n  level: INFO\n bad: indent\n",
                "line 3: expected <block end>, but found '<block mapping start>'",
            ),
        ],
        ids=["scanner", "parser"],
    )
    def test_syntax_error_is_refused_with_its_line_and_the_parser_problem(
        self, text: str, reason: str, located_file: Path
    ) -> None:
        located_file.write_text(text, encoding="utf-8")

        with pytest.raises(ConfigValidationError) as refusal:
            Config()

        assert str(refusal.value) == f"Config file {located_file} cannot be read: {reason}"

    def test_file_that_is_not_utf8_is_refused_in_one_line(self, located_file: Path) -> None:
        located_file.write_bytes(b"server:\n  host: cafe\xe9.example\n")

        with pytest.raises(
            ConfigValidationError, match=_cannot_be_read(located_file, ".+")
        ) as refusal:
            Config()

        assert "\n" not in str(refusal.value)

    @pytest.mark.parametrize(
        "text", ["- a\n- b\n", "just text\n", "5\n"], ids=["list", "text", "number"]
    )
    def test_top_level_that_is_not_a_mapping_is_refused(
        self, text: str, located_file: Path
    ) -> None:
        located_file.write_text(text, encoding="utf-8")

        with pytest.raises(ConfigValidationError, match=_not_a_mapping(located_file)):
            Config()

    def test_refusal_names_the_path_as_located(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = tmp_path / "real" / "wave.yaml"
        target.parent.mkdir()
        target.write_text("- a\n- b\n", encoding="utf-8")
        link = tmp_path / "link.yaml"
        link.symlink_to(target)
        monkeypatch.setenv("WAVE_CONFIG_FILE", str(link))

        with pytest.raises(ConfigValidationError, match=_not_a_mapping(link)):
            Config()


def _loader_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == loader.__name__ and record.levelno == logging.WARNING
    ]


class TestUnknownSection:
    def test_misspelled_section_is_named_in_a_warning_and_ignored(
        self, located_file: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        _write(
            located_file,
            {"secret_maskng": {"run_output": True}, "server": {"port": 4100}},
        )

        with caplog.at_level(logging.WARNING, logger=loader.__name__):
            config = Config()

        assert _loader_warnings(caplog) == [
            f"Config file {located_file}: unknown section 'secret_maskng' is ignored"
        ]
        assert config.server.port == 4100
        assert config.secret_masking.run_output is False

    def test_each_unknown_section_is_named_in_file_order(
        self, located_file: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        located_file.write_text(
            "Server:\n  port: 4101\nlogging:\n  level: INFO\nbackups:\n  enabled: true\n",
            encoding="utf-8",
        )

        with caplog.at_level(logging.WARNING, logger=loader.__name__):
            config = Config()

        assert _loader_warnings(caplog) == [
            f"Config file {located_file}: unknown section 'Server' is ignored",
            f"Config file {located_file}: unknown section 'backups' is ignored",
        ]
        assert config.server.port == 8000

    def test_unknown_section_is_named_when_the_file_is_refused(
        self, located_file: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        _write(located_file, {"servr": {"port": 4102}, "logging": {"level": "verbose"}})

        with caplog.at_level(logging.WARNING, logger=loader.__name__):
            with pytest.raises(ConfigValidationError):
                Config()

        assert _loader_warnings(caplog) == [
            f"Config file {located_file}: unknown section 'servr' is ignored"
        ]

    def test_example_file_names_no_unknown_section(
        self, located_file: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        located_file.write_text(EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8"), encoding="utf-8")

        with caplog.at_level(logging.WARNING, logger=loader.__name__):
            Config()

        assert _loader_warnings(caplog) == []


class TestRemovedLoggingVariable:
    def test_wave_logging_level_does_not_set_the_level(
        self, located_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _write(located_file, {"logging": {"level": "DEBUG"}})
        monkeypatch.setenv("WAVE_LOGGING_LEVEL", "ERROR")

        assert Config().logging.level == "DEBUG"

    def test_wave_logging_level_does_not_replace_the_default(
        self, located_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_LOGGING_LEVEL", "ERROR")

        assert Config().logging.level == "INFO"

    def test_unknown_wave_logging_level_is_not_checked(
        self, located_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("WAVE_LOGGING_LEVEL", "verbose")

        assert Config().logging.level == "INFO"
