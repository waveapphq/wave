"""Per-surface secret-reveal flags of the config file; every flag defaults off (masked)."""

from wavecore.api.config import get_config


def get_reveal_settings() -> dict[str, bool]:
    """The reveal flags as a fresh dict."""
    return get_config().section("secret_masking")


def set_reveal_settings(
    *,
    run_output: bool | None = None,
    test_variables: bool | None = None,
    shared_variables: bool | None = None,
    credential_inputs: bool | None = None,
) -> dict[str, bool]:
    """Save only the named flags (a ``None`` leaves that flag untouched)."""
    given = {
        "run_output": run_output,
        "test_variables": test_variables,
        "shared_variables": shared_variables,
        "credential_inputs": credential_inputs,
    }
    current = get_reveal_settings()
    named = {name: value for name, value in given.items() if value is not None}
    # Nothing is written when no named flag changes.
    if any(current[name] != value for name, value in named.items()):
        get_config().save({f"secret_masking.{name}": value for name, value in named.items()})
    return get_reveal_settings()


def is_run_output_revealed() -> bool:
    """Whether run logs / console / reports reveal secret values."""
    return bool(get_config().secret_masking.run_output)


def is_test_variables_revealed() -> bool:
    """Whether the workbench Variable Manager panel and its watchers reveal a test's
    secret variable values."""
    return bool(get_config().secret_masking.test_variables)


def is_shared_variables_revealed() -> bool:
    """Whether the global / regression / suite variable editors reveal secret values."""
    return bool(get_config().secret_masking.shared_variables)


def is_credential_inputs_revealed() -> bool:
    """Whether plugin credential input fields reveal their stored values on read."""
    return bool(get_config().secret_masking.credential_inputs)


def resolve_block_reveal(setting: str) -> bool:
    """A block's effective run-output reveal: ``reveal``/``mask`` override; anything
    else (``system`` or an unknown value) inherits the system ``run_output`` default."""
    if setting == "reveal":
        return True
    if setting == "mask":
        return False
    return is_run_output_revealed()
