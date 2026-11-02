"""Secret-reveal flags of the config file and a block's reveal choice (REQ-3.1.3.17)."""

import re
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest

import wavecore.core.secrets.masking_settings as masking_settings
from wavecore.api.config import get_config

_ALL_MASKED = {
    "run_output": False,
    "test_variables": False,
    "shared_variables": False,
    "credential_inputs": False,
}
_HELPERS: dict[str, Callable[[], bool]] = {
    "run_output": masking_settings.is_run_output_revealed,
    "test_variables": masking_settings.is_test_variables_revealed,
    "shared_variables": masking_settings.is_shared_variables_revealed,
    "credential_inputs": masking_settings.is_credential_inputs_revealed,
}


@pytest.fixture
def _reset_reveal_settings() -> Generator[None, None, None]:
    """Every reveal flag starts and ends off so tests never leak state."""
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )
    yield
    masking_settings.set_reveal_settings(
        run_output=False,
        test_variables=False,
        shared_variables=False,
        credential_inputs=False,
    )


@pytest.mark.usefixtures("_reset_reveal_settings")
class TestDefaults:
    """Secure-by-default: every surface starts masked."""

    def test_all_flags_default_to_false(self) -> None:
        assert masking_settings.get_reveal_settings() == {
            "run_output": False,
            "test_variables": False,
            "shared_variables": False,
            "credential_inputs": False,
        }

    def test_run_output_default_helper_is_false(self) -> None:
        assert masking_settings.is_run_output_revealed() is False

    def test_test_variables_default_helper_is_false(self) -> None:
        assert masking_settings.is_test_variables_revealed() is False

    def test_shared_variables_default_helper_is_false(self) -> None:
        assert masking_settings.is_shared_variables_revealed() is False

    def test_credential_inputs_default_helper_is_false(self) -> None:
        assert masking_settings.is_credential_inputs_revealed() is False


@pytest.mark.usefixtures("_reset_reveal_settings")
class TestSetRevealSettings:
    """Partial writes update only the named flags and return the full state."""

    def test_set_run_output_true_returns_full_state(self) -> None:
        result = masking_settings.set_reveal_settings(run_output=True)
        assert result == {
            "run_output": True,
            "test_variables": False,
            "shared_variables": False,
            "credential_inputs": False,
        }

    def test_set_run_output_true_reflects_in_getter(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert masking_settings.is_run_output_revealed() is True

    def test_partial_set_preserves_untouched_flags(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        masking_settings.set_reveal_settings(shared_variables=True)
        assert masking_settings.get_reveal_settings() == {
            "run_output": True,
            "test_variables": False,
            "shared_variables": True,
            "credential_inputs": False,
        }

    def test_credential_inputs_flag_is_independent(self) -> None:
        masking_settings.set_reveal_settings(credential_inputs=True)
        assert masking_settings.is_credential_inputs_revealed() is True
        assert masking_settings.is_shared_variables_revealed() is False
        assert masking_settings.is_run_output_revealed() is False

    def test_empty_set_is_a_noop(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        masking_settings.set_reveal_settings()
        assert masking_settings.get_reveal_settings()["test_variables"] is True

    def test_set_flag_back_to_false(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        masking_settings.set_reveal_settings(test_variables=False)
        assert masking_settings.is_test_variables_revealed() is False

    def test_each_flag_is_independent(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True)
        assert masking_settings.is_test_variables_revealed() is True
        assert masking_settings.is_run_output_revealed() is False
        assert masking_settings.is_shared_variables_revealed() is False


@pytest.mark.usefixtures("_reset_reveal_settings")
class TestResolveBlockReveal:
    """A block's effective run-output reveal resolves its tri-state choice
    against the system `run_output` default (REQ-3.1.3.5)."""

    def test_reveal_is_true_regardless_of_system(self) -> None:
        assert masking_settings.resolve_block_reveal("reveal") is True

    def test_reveal_is_true_even_when_system_masked(self) -> None:
        masking_settings.set_reveal_settings(run_output=False)
        assert masking_settings.resolve_block_reveal("reveal") is True

    def test_mask_is_false_regardless_of_system(self) -> None:
        assert masking_settings.resolve_block_reveal("mask") is False

    def test_mask_is_false_even_when_system_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert masking_settings.resolve_block_reveal("mask") is False

    def test_system_follows_run_output_when_masked(self) -> None:
        masking_settings.set_reveal_settings(run_output=False)
        assert masking_settings.resolve_block_reveal("system") is False

    def test_system_follows_run_output_when_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert masking_settings.resolve_block_reveal("system") is True

    def test_unknown_setting_falls_back_to_system_default_masked(self) -> None:
        masking_settings.set_reveal_settings(run_output=False)
        assert masking_settings.resolve_block_reveal("bogus") is False

    def test_unknown_setting_falls_back_to_system_default_revealed(self) -> None:
        masking_settings.set_reveal_settings(run_output=True)
        assert masking_settings.resolve_block_reveal("bogus") is True

    def test_system_resolution_ignores_the_other_two_surfaces(self) -> None:
        masking_settings.set_reveal_settings(test_variables=True, shared_variables=True)
        assert masking_settings.resolve_block_reveal("system") is False


class TestFlagsReadFromTheConfig:
    """The flags are the ``secret_masking`` values of the running config (REQ-3.1.3.17)."""

    def test_empty_config_file_masks_every_surface(self) -> None:
        assert masking_settings.get_reveal_settings() == _ALL_MASKED

    def test_flags_come_from_the_config_file(self, load_config: Callable[..., Any]) -> None:
        load_config({"secret_masking": {"run_output": True, "credential_inputs": True}})

        assert masking_settings.get_reveal_settings() == {
            "run_output": True,
            "test_variables": False,
            "shared_variables": False,
            "credential_inputs": True,
        }

    @pytest.mark.parametrize("flag", list(_HELPERS))
    def test_each_helper_follows_its_own_flag(
        self, load_config: Callable[..., Any], flag: str
    ) -> None:
        load_config({"secret_masking": {flag: True}})

        assert {name: helper() for name, helper in _HELPERS.items()} == {
            **_ALL_MASKED,
            flag: True,
        }

    def test_helpers_follow_a_save_through_the_config(self) -> None:
        get_config().save({"secret_masking.test_variables": True})

        assert masking_settings.is_test_variables_revealed() is True
        assert masking_settings.get_reveal_settings() == {**_ALL_MASKED, "test_variables": True}

    def test_helpers_read_the_running_config_not_the_file(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config({"secret_masking": {"run_output": True}})
        config_file.write_text("secret_masking:\n  run_output: false\n", encoding="utf-8")

        assert masking_settings.is_run_output_revealed() is True
        assert masking_settings.resolve_block_reveal("system") is True

    def test_new_running_config_replaces_the_flags(self, load_config: Callable[..., Any]) -> None:
        masking_settings.set_reveal_settings(run_output=True, shared_variables=True)

        load_config({})

        assert masking_settings.get_reveal_settings() == _ALL_MASKED

    @pytest.mark.parametrize(
        ("run_output", "setting", "expected"),
        [
            (True, "system", True),
            (False, "system", False),
            (True, "bogus", True),
            (True, "mask", False),
            (False, "reveal", True),
        ],
    )
    def test_block_reveal_resolves_against_the_config_flag(
        self, load_config: Callable[..., Any], run_output: bool, setting: str, expected: bool
    ) -> None:
        load_config({"secret_masking": {"run_output": run_output}})

        assert masking_settings.resolve_block_reveal(setting) is expected


class TestFlagsWrittenToTheConfigFile:
    """A changed flag is written into the config file, and only that flag (REQ-3.1.3.17)."""

    def test_set_writes_only_the_named_flag(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = masking_settings.set_reveal_settings(run_output=True)

        assert result == {**_ALL_MASKED, "run_output": True}
        assert config_on_disk() == {"secret_masking": {"run_output": True}}

    def test_set_writes_every_named_flag_and_no_other(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = masking_settings.set_reveal_settings(test_variables=True, credential_inputs=False)

        assert result == {**_ALL_MASKED, "test_variables": True}
        assert config_on_disk() == {
            "secret_masking": {"test_variables": True, "credential_inputs": False}
        }

    def test_set_leaves_the_rest_of_the_file_as_it_is(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        load_config(
            {
                "logging": {"level": "DEBUG"},
                "secret_masking": {
                    "run_output": False,
                    "test_variables": True,
                    "shared_variables": False,
                    "credential_inputs": True,
                },
            }
        )

        masking_settings.set_reveal_settings(run_output=True)

        assert config_on_disk() == {
            "logging": {"level": "DEBUG"},
            "secret_masking": {
                "run_output": True,
                "test_variables": True,
                "shared_variables": False,
                "credential_inputs": True,
            },
        }

    def test_saved_flag_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        masking_settings.set_reveal_settings(shared_variables=True)

        load_config()

        assert get_config().get("secret_masking.shared_variables") is True
        assert get_config().secret_masking.shared_variables is True
        assert masking_settings.is_shared_variables_revealed() is True
        assert masking_settings.get_reveal_settings() == {**_ALL_MASKED, "shared_variables": True}

    def test_set_without_a_flag_writes_nothing(
        self, config_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config({"secret_masking": {"test_variables": True}})
        before = config_file.read_bytes()
        modified = config_file.stat().st_mtime_ns

        result = masking_settings.set_reveal_settings()

        assert result == {**_ALL_MASKED, "test_variables": True}
        assert config_file.read_bytes() == before
        assert config_file.stat().st_mtime_ns == modified

    def test_set_without_a_flag_needs_no_writable_file(
        self, read_only_config: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config({"secret_masking": {"credential_inputs": True}})

        assert masking_settings.set_reveal_settings() == {**_ALL_MASKED, "credential_inputs": True}

    def test_refused_write_changes_neither_the_file_nor_the_flags(
        self, read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        before = read_only_config.read_bytes()
        path = re.escape(str(read_only_config))

        with pytest.raises(
            ConfigWriteError,
            match=rf"^Settings cannot be saved: the config file {path} is read-only$",
        ):
            masking_settings.set_reveal_settings(run_output=True, test_variables=True)

        assert read_only_config.read_bytes() == before
        assert masking_settings.get_reveal_settings() == _ALL_MASKED
        assert masking_settings.is_run_output_revealed() is False
