"""Common secret-aware plugin I/O logging through the workbench harness.

Covers REQ-3.1.3.5 / REQ-3.1.3.16 / REQ-4.5.3:
- The engine harness (`_execute_plugin_with_session`), not each plugin, emits
  one masked ``Inputs:`` line before a plugin runs and one masked ``Outputs:``
  line after, identical in shape for every plugin.
- Masking is declaration-driven: params declared secret and outputs declared or
  user-marked secret render only the placeholder; inside map values, the
  plugin's credential-field catalog masks matching sub-keys while the rest of
  the map stays readable. The block's per-field reveal and its run-output reveal
  bypass this exactly as for every other emission. Long values truncate.
- `_register_secret_outputs` registers a marked output's value everywhere:
  bound -> name+value, marked-but-unbound -> value only.

The empty-params / None-result / declared-output / unmarked-output cases are
preservation guards.
"""

import uuid
from collections.abc import Generator
from typing import Any

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import plugins as wb_plugins
from wavecore.core.secrets.masking import secret_param_names
from wavecore.models.plugins import OutputField

_UNSET = object()


def _make_registry() -> Any:
    from wavecore.core.secrets.registry import SecretRegistry

    return SecretRegistry()


def _prime_session(registry: Any) -> str:
    session_id = str(uuid.uuid4())
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "test_id": str(uuid.uuid4()),
        "user_id": wb_common.DEFAULT_USER_ID,
        "current_block": None,
        "block_states": {},
        "variables": {},
        "secret_variable_names": [],
        "secret_registry": registry,
    }
    return session_id


def _messages(session_id: str) -> list[str]:
    return [entry["message"] for entry in log_streaming_service.get_logs(session_id)]


def _find_line(session_id: str, prefix: str) -> str | None:
    return next((m for m in _messages(session_id) if m.startswith(prefix)), None)


class _IOStubPlugin:
    """Data stub: one secret-declared param, a map param, one secret-declared
    output, a credential-field catalog. ``execute`` returns a caller-chosen
    value (a fixed dict by default). No business logic."""

    def __init__(self, result: Any = _UNSET) -> None:
        self._result: Any = (
            {"session_key": "sk-s3cr3t-value", "status": 200} if result is _UNSET else result
        )
        self.context: dict[str, Any] | None = None

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "io-stub",
            "version": "1.0.0",
            "parameters": [
                {"name": "token", "type": "string", "secret": True},
                {"name": "conn", "type": "map"},
                {"name": "plain", "type": "string"},
            ],
            "output_schema": [
                {"name": "session_key", "type": "string", "secret": True},
                {"name": "api_token", "type": "string"},
                {"name": "resp_headers", "type": "map"},
                {"name": "status", "type": "integer"},
            ],
            "secret_mask_fields": ["authorization", "cookie", "set-cookie"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        pass

    async def initialize(self, context: dict[str, Any]) -> None:
        self.context = context

    async def execute(self, context: dict[str, Any]) -> Any:
        return self._result

    async def cleanup(self) -> None:
        pass


async def _run_harness(
    plugin: Any,
    parameters: dict[str, Any],
    *,
    reveal_secrets: bool = False,
    unmasked_secret_fields: list[str] | None = None,
    output_secret_fields: Any = _UNSET,
    pre_registered_values: list[str] | None = None,
) -> str:
    """Prime a session and run the plugin through the harness; return the id."""
    registry = _make_registry()
    for value in pre_registered_values or []:
        registry.register_value(value, "var")
    session_id = _prime_session(registry)
    kwargs: dict[str, Any] = {}
    if output_secret_fields is not _UNSET:
        kwargs["output_secret_fields"] = output_secret_fields
    await wb_plugins._execute_plugin_with_session(
        plugin,
        "io-stub",
        parameters,
        {},
        session_id,
        None,
        None,
        None,
        None,
        reveal_secrets=reveal_secrets,
        unmasked_secret_fields=unmasked_secret_fields,
        **kwargs,
    )
    return session_id


class TestSecretSetExtractors:
    """The harness derives its secret sets from plugin metadata."""

    def test_secret_param_names_extracts_declared_secret_params(self) -> None:
        names = secret_param_names(_IOStubPlugin().metadata)
        assert names == {"token"}

    def test_secret_param_names_empty_when_none_declared(self) -> None:
        metadata = {"parameters": [{"name": "plain", "type": "string"}]}
        assert secret_param_names(metadata) == set()

    def test_secret_param_names_handles_missing_parameters_key(self) -> None:
        assert secret_param_names({}) == set()

    def test_secret_output_names_from_metadata_extracts_declared(self) -> None:
        names = wb_plugins._secret_output_names_from_metadata(_IOStubPlugin().metadata)
        assert names == {"session_key"}

    def test_secret_output_names_from_metadata_empty_when_none_declared(self) -> None:
        metadata = {"output_schema": [{"name": "status", "type": "integer"}]}
        assert wb_plugins._secret_output_names_from_metadata(metadata) == set()

    def test_secret_output_names_from_metadata_reads_output_field_objects(self) -> None:
        # A plugin may declare its outputs as OutputField objects instead of dicts.
        metadata = {
            "output_schema": [
                OutputField(name="session_key", type="string", secret=True),
                OutputField(name="status", type="integer"),
            ]
        }
        assert wb_plugins._secret_output_names_from_metadata(metadata) == {"session_key"}


class TestFormatIoValue:
    """`_format_io_value` truncates a long value for display; truncation is a
    display bound, not a masking mechanism."""

    def test_long_string_truncates_to_2048_with_exact_suffix(self) -> None:
        result = wb_plugins._format_io_value("x" * 2500)
        assert result == "x" * 2048 + "... (2500 chars total)"

    def test_string_at_the_limit_is_unchanged(self) -> None:
        value = "y" * 2048
        assert wb_plugins._format_io_value(value) == value

    def test_short_string_is_unchanged(self) -> None:
        assert wb_plugins._format_io_value("hello world") == "hello world"

    def test_non_string_value_passes_through(self) -> None:
        assert wb_plugins._format_io_value(200) == 200
        assert wb_plugins._format_io_value({"a": 1}) == {"a": 1}


class TestHarnessInputsLine:
    """The harness emits a masked ``Inputs:`` line before execute."""

    async def test_declared_secret_param_masked_in_inputs_line(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(), {"token": "tok-s3cr3t-l1teral", "plain": "hello world"}
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "tok-s3cr3t-l1teral" not in line
        assert "********" in line
        assert "hello world" in line

    async def test_catalog_subkey_masked_inside_map_param(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(),
            {"conn": {"Authorization": "Bearer c0nn-s3cr3t", "Content-Type": "application/json"}},
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "c0nn-s3cr3t" not in line
        assert "application/json" in line
        assert "********" in line

    async def test_revealed_catalog_field_left_raw_in_inputs_line(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(),
            {"conn": {"Authorization": "Bearer c0nn-s3cr3t"}},
            unmasked_secret_fields=["authorization"],
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "c0nn-s3cr3t" in line

    async def test_reveal_matches_catalog_field_case_insensitively(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(),
            {"conn": {"Authorization": "Bearer c0nn-s3cr3t"}},
            unmasked_secret_fields=["AUTHORIZATION"],
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "c0nn-s3cr3t" in line

    async def test_reveal_secrets_renders_inputs_raw(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(),
            {
                "token": "tok-s3cr3t-l1teral",
                "conn": {"Authorization": "Bearer c0nn-s3cr3t"},
            },
            reveal_secrets=True,
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "tok-s3cr3t-l1teral" in line
        assert "c0nn-s3cr3t" in line

    async def test_inputs_line_present_when_params_non_empty(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(), {"plain": "hello world"})
        assert _find_line(session_id, "Inputs: ") is not None

    async def test_no_inputs_line_when_resolved_params_empty(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(), {})
        assert _find_line(session_id, "Inputs: ") is None

    async def test_a_float_input_prints_in_plain_digits(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(), {"conn": {"delay": 1e-07, "ratios": [1e-05, 1e22], "count": 30}}
        )

        assert _find_line(session_id, "Inputs: ") == (
            'Inputs: {"conn":{"delay":0.0000001,"ratios":[0.00001,10000000000000000000000],'
            '"count":30}}'
        )

    async def test_long_param_value_truncated_in_inputs_line(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(), {"plain": "x" * 2500})

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "... (2500 chars total)" in line
        assert "x" * 2500 not in line


class TestHarnessOutputsLine:
    """The harness emits a masked ``Outputs:`` line after execute."""

    async def test_declared_secret_output_masked_in_outputs_line(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin({"session_key": "sk-s3cr3t-value", "status": 200}), {}
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "sk-s3cr3t-value" not in line
        assert "********" in line
        assert "200" in line

    async def test_user_marked_output_masked_in_outputs_line(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin({"api_token": "at-s3cr3t-value", "status": 200}),
            {},
            output_secret_fields=["api_token"],
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "at-s3cr3t-value" not in line
        assert "********" in line

    async def test_catalog_subkey_masked_inside_map_output(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(
                {
                    "resp_headers": {
                        "Authorization": "Bearer leak-h3ader",
                        "Content-Type": "application/json",
                    },
                    "status": 200,
                }
            ),
            {},
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "leak-h3ader" not in line
        assert "application/json" in line
        assert "********" in line

    async def test_engine_signal_keys_are_not_shown_as_outputs(self) -> None:
        session_id = await _run_harness(_IOStubPlugin({"status": 200, "__block_warning": True}), {})

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "__block_warning" not in line
        assert "200" in line

    async def test_a_float_output_prints_in_plain_digits(self) -> None:
        session_id = await _run_harness(_IOStubPlugin({"elapsed": 1e-07}), {})
        assert _find_line(session_id, "Outputs: ") == 'Outputs: {"elapsed":0.0000001}'

        single = await _run_harness(_IOStubPlugin(2.5e-06), {})
        assert _find_line(single, "Output: ") == "Output: 0.0000025"

    async def test_non_dict_result_logged_as_singular_output(self) -> None:
        session_id = await _run_harness(_IOStubPlugin("plain-result-value"), {})

        line = _find_line(session_id, "Output: ")
        assert line is not None
        assert "plain-result-value" in line

    async def test_no_output_line_when_result_is_none(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(None), {})
        assert _find_line(session_id, "Outputs: ") is None
        assert _find_line(session_id, "Output: ") is None


class TestRegisterSecretOutputs:
    """`_register_secret_outputs` honors the stored outputs-table choice.

    A marked output's value is registered everywhere so it cannot leak:
    bound outputs flag the receiving variable AND
    scrub the value; marked-but-unbound outputs scrub the value only. A present
    stored list is the complete truth; declared names left out are revealed.
    """

    @pytest.fixture(autouse=True)
    def _register_plugin(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_IOStubPlugin())
        yield
        clear_registry()

    @staticmethod
    def _node_fields(
        *, output_bindings: dict[str, str], output_secret_fields: list[str]
    ) -> dict[str, Any]:
        return {
            "output_bindings": output_bindings,
            "output_secret_fields": output_secret_fields,
            "element_type": "io-stub",
            "version": "1.0.0",
        }

    def test_marked_bound_output_flags_and_scrubs(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(
            output_bindings={"api_token": "cap_token"}, output_secret_fields=["api_token"]
        )

        wb_plugins._register_secret_outputs(
            node_fields, {"api_token": "at-s3cr3t-value", "status": 200}, session_id
        )

        assert registry.is_secret_name("cap_token") is True
        assert "at-s3cr3t-value" in registry.scan_values()

    def test_marked_unbound_output_scrubs_value_only(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(output_bindings={}, output_secret_fields=["api_token"])

        wb_plugins._register_secret_outputs(
            node_fields, {"api_token": "at-s3cr3t-value"}, session_id
        )

        assert "at-s3cr3t-value" in registry.scan_values()
        assert registry.is_secret_name("api_token") is False

    def test_declared_secret_output_unchecked_does_not_register(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(
            output_bindings={"session_key": "cap_sk"}, output_secret_fields=[]
        )

        wb_plugins._register_secret_outputs(
            node_fields, {"session_key": "sk-s3cr3t-value", "status": 200}, session_id
        )

        assert registry.is_secret_name("cap_sk") is False
        assert "sk-s3cr3t-value" not in registry.scan_values()

    def test_marked_name_absent_from_result_is_skipped(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(
            output_bindings={"api_token": "cap_token"}, output_secret_fields=["api_token"]
        )

        wb_plugins._register_secret_outputs(node_fields, {"status": 200}, session_id)

        assert registry.is_secret_name("cap_token") is False
        assert registry.scan_values() == ()

    def test_unmarked_undeclared_output_never_registers(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(output_bindings={"status": "code"}, output_secret_fields=[])

        wb_plugins._register_secret_outputs(node_fields, {"status": 200}, session_id)

        assert registry.is_secret_name("code") is False
        assert registry.scan_values() == ()


class TestIoDisplayDictValueScrub:
    """`_io_display_dict` value-scrubs registered secret byte-forms from each
    field BEFORE truncation, so a value the name/catalog mask misses (or a
    repr-escaped or truncated form) cannot survive the display line."""

    def test_scrubs_registered_value_missed_by_name_mask(self) -> None:
        display = wb_plugins._io_display_dict(
            {"plain": "Bearer s3cr3t-t0ken-99"}, set(), set(), False, ("s3cr3t-t0ken-99",)
        )

        assert display == {"plain": "Bearer ********"}

    def test_scrubs_whole_value_before_truncation(self) -> None:
        secret = "s3cr3t-" + "A" * 3000
        display = wb_plugins._io_display_dict({"plain": secret}, set(), set(), False, (secret,))

        assert display == {"plain": "********"}

    def test_reveal_all_skips_value_scrub(self) -> None:
        display = wb_plugins._io_display_dict(
            {"plain": "Bearer s3cr3t-t0ken-99"}, set(), set(), True, ("s3cr3t-t0ken-99",)
        )

        assert display == {"plain": "Bearer s3cr3t-t0ken-99"}

    def test_empty_scan_values_leaves_values_readable(self) -> None:
        display = wb_plugins._io_display_dict({"plain": "hello world"}, set(), set(), False, ())

        assert display == {"plain": "hello world"}

    def test_reveal_key_shown_raw_even_when_value_is_a_scan_value(self) -> None:
        # A per-field-revealed param is shown raw by the name mask; the value-scrub
        # must not re-mask it even though its value is a registered scan value.
        display = wb_plugins._io_display_dict(
            {"password": "pw-s3cr3t-value"},
            set(),
            set(),
            False,
            ("pw-s3cr3t-value",),
            frozenset({"password"}),
        )

        assert display == {"password": "pw-s3cr3t-value"}


class TestValueScrubInIoLines:
    """A registered secret VALUE the name/catalog mask misses must still be
    scrubbed from the Inputs/Outputs lines - even when the value contains chars a
    dict repr escapes (newline/tab/quote/backslash) or exceeds the display
    truncation bound. Guards the repr-escaping / truncation value-scrub leak."""

    async def test_multiline_secret_value_masked_in_inputs_line(self) -> None:
        secret = "-----BEGIN-s3cr3t\nMIID-body-line\n-----END-s3cr3t"
        session_id = await _run_harness(
            _IOStubPlugin(), {"plain": secret}, pre_registered_values=[secret]
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "BEGIN-s3cr3t" not in line
        assert "MIID-body-line" not in line
        assert "END-s3cr3t" not in line
        assert "********" in line

    async def test_tab_and_quote_secret_value_masked_in_inputs_line(self) -> None:
        secret = "col1\tval\t'quoted'-s3cr3t-value"
        session_id = await _run_harness(
            _IOStubPlugin(), {"plain": secret}, pre_registered_values=[secret]
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "quoted'-s3cr3t-value" not in line
        assert "********" in line

    async def test_long_multiline_secret_masked_before_truncation(self) -> None:
        secret = "-----BEGIN-s3cr3t\n" + "A" * 3000 + "\n-----END-s3cr3t"
        session_id = await _run_harness(
            _IOStubPlugin(), {"plain": secret}, pre_registered_values=[secret]
        )

        line = _find_line(session_id, "Inputs: ")
        assert line is not None
        assert "BEGIN-s3cr3t" not in line
        assert "chars total" not in line
        assert "********" in line

    async def test_multiline_secret_value_masked_in_outputs_line(self) -> None:
        secret = "resp-line1\nresp-s3cr3t-line2"
        session_id = await _run_harness(
            _IOStubPlugin({"echoed": secret, "status": 200}),
            {},
            pre_registered_values=[secret],
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "resp-s3cr3t-line2" not in line
        assert "********" in line

    async def test_long_scalar_secret_masked_before_truncation(self) -> None:
        secret = "scalar-s3cr3t-" + "B" * 3000
        session_id = await _run_harness(_IOStubPlugin(secret), {}, pre_registered_values=[secret])

        line = _find_line(session_id, "Output: ")
        assert line is not None
        assert "scalar-s3cr3t-" not in line
        assert "chars total" not in line
        assert "********" in line

    async def test_reveal_secrets_shows_scalar_output_raw(self) -> None:
        secret = "scalar-s3cr3t-revealed-value"
        session_id = await _run_harness(
            _IOStubPlugin(secret), {}, reveal_secrets=True, pre_registered_values=[secret]
        )

        line = _find_line(session_id, "Output: ")
        assert line is not None
        assert secret in line


class TestOutputSecretOverrideSemantics:
    """The stored outputs-table choice is the authority: an absent stored list
    falls back to the schema-declared secret outputs (the seed); a present list
    (even empty) is the complete truth and reveals declared names left out."""

    @staticmethod
    async def _run_with_registry(
        plugin: Any, output_secret_fields: Any = _UNSET
    ) -> tuple[str, Any]:
        registry = _make_registry()
        session_id = _prime_session(registry)
        kwargs: dict[str, Any] = {}
        if output_secret_fields is not _UNSET:
            kwargs["output_secret_fields"] = output_secret_fields
        await wb_plugins._execute_plugin_with_session(
            plugin, "io-stub", {}, {}, session_id, None, None, None, None, **kwargs
        )
        return session_id, registry

    async def test_declared_output_with_empty_stored_list_unmasked_and_unregistered(
        self,
    ) -> None:
        session_id, registry = await self._run_with_registry(
            _IOStubPlugin(), output_secret_fields=[]
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "sk-s3cr3t-value" in line
        assert "sk-s3cr3t-value" not in registry.scan_values()

    async def test_declared_output_with_absent_stored_list_stays_masked(self) -> None:
        session_id, registry = await self._run_with_registry(
            _IOStubPlugin(), output_secret_fields=None
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "sk-s3cr3t-value" not in line
        assert "********" in line
        assert "sk-s3cr3t-value" in registry.scan_values()

    async def test_marked_undeclared_masks_while_unchecked_declared_reveals(self) -> None:
        session_id, registry = await self._run_with_registry(
            _IOStubPlugin({"session_key": "sk-s3cr3t-value", "api_token": "at-s3cr3t-value"}),
            output_secret_fields=["api_token"],
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "at-s3cr3t-value" not in line
        assert "sk-s3cr3t-value" in line
        assert "at-s3cr3t-value" in registry.scan_values()
        assert "sk-s3cr3t-value" not in registry.scan_values()


class TestRegisterSecretOutputsOverride:
    """`_register_secret_outputs` honors the stored outputs-table choice: an
    unchecked declared output is neither variable-flagged nor value-registered;
    an absent stored list keeps the schema seed."""

    @pytest.fixture(autouse=True)
    def _register_plugin(self) -> Generator[None, None, None]:
        from wavecore.core.plugin_registry import clear_registry, register_plugin

        clear_registry()
        register_plugin(_IOStubPlugin())
        yield
        clear_registry()

    @staticmethod
    def _node_fields(
        *, output_bindings: dict[str, str], output_secret_fields: list[str] | None
    ) -> dict[str, Any]:
        return {
            "output_bindings": output_bindings,
            "output_secret_fields": output_secret_fields,
            "element_type": "io-stub",
            "version": "1.0.0",
        }

    def test_unchecked_declared_output_not_flagged_not_scrubbed(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(
            output_bindings={"session_key": "cap_sk"}, output_secret_fields=[]
        )

        wb_plugins._register_secret_outputs(
            node_fields, {"session_key": "sk-s3cr3t-value", "status": 200}, session_id
        )

        assert registry.is_secret_name("cap_sk") is False
        assert registry.scan_values() == ()

    def test_absent_stored_list_keeps_declared_seed(self) -> None:
        registry = _make_registry()
        session_id = _prime_session(registry)
        node_fields = self._node_fields(
            output_bindings={"session_key": "cap_sk"}, output_secret_fields=None
        )

        wb_plugins._register_secret_outputs(
            node_fields, {"session_key": "sk-s3cr3t-value", "status": 200}, session_id
        )

        assert registry.is_secret_name("cap_sk") is True
        assert "sk-s3cr3t-value" in registry.scan_values()


def _shell_script() -> Any:
    from wavecore.plugins.shell_script import ShellScriptPlugin

    return ShellScriptPlugin()


def _shell_exec() -> Any:
    from wavecore.plugins.shell_exec import ShellExecPlugin

    return ShellExecPlugin()


async def _run_local_block(
    plugin: Any,
    plugin_type: str,
    parameters: dict[str, Any],
    *,
    output_bindings: dict[str, str] | None = None,
    output_secret_fields: list[str] | None = None,
    secret_variables: dict[str, str] | None = None,
) -> tuple[str, Any, Any]:
    """Run a local-process block through the harness with console scrubbing wired.

    Returns the session id, the run's secret registry and the plugin result.
    """
    registry = _make_registry()
    for name, value in (secret_variables or {}).items():
        registry.register(name, value, "declared")
    session_id = _prime_session(registry)
    log_streaming_service.register_secret_registry(session_id, registry)
    result = await wb_plugins._execute_plugin_with_session(
        plugin,
        plugin_type,
        parameters,
        {},
        session_id,
        None,
        None,
        None,
        None,
        output_secret_fields=output_secret_fields,
        output_bindings=output_bindings or {},
    )
    return session_id, registry, result


class TestScriptVariableMasking:
    """SHRUN-6 / REQ-3.1.3.16: a script variable marked secret is masked in the harness
    echo, registered with the run's registry and flags the variable it binds to. An
    unmarked one stays readable and binds under its own name."""

    _SECRET_SCRIPT = {
        "script": 'TOKEN="sk-s3cr3t-value"',
        "script_variables": ["TOKEN"],
        "timeout": 60,
    }
    _COUNT_SCRIPT = {"script": "COUNT=7", "script_variables": ["COUNT"], "timeout": 60}

    async def test_marked_script_variable_is_masked_in_the_outputs_line(self) -> None:
        session_id, _registry, _result = await _run_local_block(
            _shell_script(),
            "shell-script",
            dict(self._SECRET_SCRIPT),
            output_bindings={"TOKEN": "tok_var"},
            output_secret_fields=["TOKEN"],
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "sk-s3cr3t-value" not in line
        assert "********" in line

    async def test_marked_script_variable_registers_with_the_run_registry(self) -> None:
        _session_id, registry, _result = await _run_local_block(
            _shell_script(),
            "shell-script",
            dict(self._SECRET_SCRIPT),
            output_bindings={"TOKEN": "tok_var"},
            output_secret_fields=["TOKEN"],
        )

        assert "sk-s3cr3t-value" in registry.scan_values()

    async def test_marked_script_variable_flags_the_variable_it_binds_to(self) -> None:
        session_id, registry, result = await _run_local_block(
            _shell_script(),
            "shell-script",
            dict(self._SECRET_SCRIPT),
            output_bindings={"TOKEN": "tok_var"},
            output_secret_fields=["TOKEN"],
        )

        wb_plugins._register_secret_outputs(
            {
                "output_bindings": {"TOKEN": "tok_var"},
                "output_secret_fields": ["TOKEN"],
                "element_type": "shell-script",
                "version": "1.0.0",
            },
            result,
            session_id,
        )

        assert registry.is_secret_name("tok_var") is True

    async def test_unmarked_script_variable_stays_readable_in_the_outputs_line(self) -> None:
        session_id, _registry, _result = await _run_local_block(
            _shell_script(),
            "shell-script",
            dict(self._COUNT_SCRIPT),
            output_bindings={"COUNT": "count_var"},
            output_secret_fields=[],
        )

        line = _find_line(session_id, "Outputs: ")
        assert line is not None
        assert "COUNT" in line
        assert "********" not in line

    async def test_unmarked_script_variable_binds_to_its_variable_by_name(self) -> None:
        from wavecore.api.services.workbench.signals import _assign_output_bindings

        session_id, _registry, result = await _run_local_block(
            _shell_script(),
            "shell-script",
            dict(self._COUNT_SCRIPT),
            output_bindings={"COUNT": "count_var"},
        )
        variables: dict[str, Any] = {}

        _assign_output_bindings(
            result, {"COUNT": "count_var"}, variables, session_id, "Shell Script", "node-1"
        )

        assert variables["count_var"] == "7"


class TestLocalBlockConsoleLines:
    """SHRUN-12 / SHRUN-17 / REQ-3.4.1.18: live lines carry the block's own source label,
    and a secret input value is masked in them."""

    async def test_shell_exec_lines_carry_the_shell_exec_source(self) -> None:
        session_id, _registry, _result = await _run_local_block(
            _shell_exec(),
            "shell-exec",
            {"command": "echo visible-line", "stream_output": True, "timeout": 60},
        )

        sources = {entry["source"] for entry in log_streaming_service.get_logs(session_id)}
        assert sources == {"Shell Exec"}
        assert "visible-line" in _messages(session_id)

    async def test_shell_script_lines_carry_the_shell_script_source(self) -> None:
        session_id, _registry, _result = await _run_local_block(
            _shell_script(),
            "shell-script",
            {"script": "echo visible-line", "stream_output": True, "timeout": 60},
        )

        sources = {entry["source"] for entry in log_streaming_service.get_logs(session_id)}
        assert sources == {"Shell Script"}
        assert "visible-line" in _messages(session_id)

    async def test_a_secret_input_value_is_masked_in_a_live_line(self) -> None:
        session_id, _registry, _result = await _run_local_block(
            _shell_exec(),
            "shell-exec",
            {
                "command": 'echo "$TOKEN"',
                "env_vars": {"TOKEN": "sk-l1ve-s3cr3t-value"},
                "stream_output": True,
                "timeout": 60,
            },
            secret_variables={"token": "sk-l1ve-s3cr3t-value"},
        )

        messages = _messages(session_id)
        assert "********" in messages
        assert not any("sk-l1ve-s3cr3t-value" in message for message in messages)


class TestUrlPasswordsInIoLines:
    """REQ-3.1.3.5: a password written inside a URL is masked in every echo of a block's
    inputs and outputs, wherever the echo scrubs secret values; a reveal shows it raw."""

    _URL = "https://wave:url-s3cr3t@opensearch.internal:9477"
    _SHOWN = "https://wave:********@opensearch.internal:9477"

    def test_display_masks_a_url_password_in_text_maps_and_lists(self) -> None:
        display = wb_plugins._io_display_dict(
            {"url": self._URL, "conn": {"proxy": self._URL}, "hosts": [self._URL], "n": 3},
            set(),
            set(),
            False,
        )

        assert display == {
            "url": self._SHOWN,
            "conn": {"proxy": self._SHOWN},
            "hosts": [self._SHOWN],
            "n": 3,
        }

    def test_display_masks_before_truncation(self) -> None:
        value = "x" * 2030 + "https://u:longpassword@h.internal"

        display = wb_plugins._io_display_dict({"plain": value}, set(), set(), False)

        assert display == {"plain": "x" * 2030 + "https://u:********... (2059 chars total)"}

    def test_reveal_all_shows_the_url_password(self) -> None:
        display = wb_plugins._io_display_dict({"url": self._URL}, set(), set(), True)

        assert display == {"url": self._URL}

    def test_a_revealed_field_shows_the_url_password(self) -> None:
        display = wb_plugins._io_display_dict(
            {"url": self._URL}, set(), set(), False, (), frozenset({"url"})
        )

        assert display == {"url": self._URL}

    async def test_inputs_line_masks_a_url_password_in_a_plain_row(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(), {"plain": self._URL})

        assert _find_line(session_id, "Inputs: ") == f'Inputs: {{"plain":"{self._SHOWN}"}}'

    async def test_outputs_lines_mask_a_url_password(self) -> None:
        dict_run = await _run_harness(_IOStubPlugin({"status": 200, "location": self._URL}), {})
        scalar_run = await _run_harness(_IOStubPlugin(self._URL), {})

        assert _find_line(dict_run, "Outputs: ") == (
            f'Outputs: {{"status":200,"location":"{self._SHOWN}"}}'
        )
        assert _find_line(scalar_run, "Output: ") == f"Output: {self._SHOWN}"

    async def test_reveal_secrets_shows_the_url_password_in_the_output_line(self) -> None:
        session_id = await _run_harness(_IOStubPlugin(self._URL), {}, reveal_secrets=True)

        assert _find_line(session_id, "Output: ") == f"Output: {self._URL}"

    async def _run_template(self, value: str, *, reveal_secrets: bool = False) -> str:
        session_id = _prime_session(_make_registry())
        await wb_plugins._execute_plugin_with_session(
            _IOStubPlugin(None),
            "io-stub",
            {"plain": value},
            {"pw": "url-s3cr3t"},
            session_id,
            None,
            None,
            None,
            {"plain"},
            reveal_secrets=reveal_secrets,
        )
        return session_id

    async def test_template_and_rendered_lines_mask_a_url_password(self) -> None:
        literal = await self._run_template(self._URL)
        rendered = await self._run_template("https://wave:{{ pw }}@opensearch.internal:9477")

        assert _find_line(literal, "Template 'plain': ") == f"Template 'plain': {self._SHOWN}"
        assert _find_line(rendered, "Template 'plain': ") == (
            "Template 'plain': https://wave:{{ pw }}@opensearch.internal:9477"
        )
        assert _find_line(rendered, "Rendered 'plain': ") == f"Rendered 'plain': {self._SHOWN}"
        assert not any("url-s3cr3t" in message for message in _messages(rendered))

    async def test_reveal_secrets_shows_the_url_password_in_template_lines(self) -> None:
        session_id = await self._run_template(
            "https://wave:{{ pw }}@opensearch.internal:9477", reveal_secrets=True
        )

        assert _find_line(session_id, "Rendered 'plain': ") == f"Rendered 'plain': {self._URL}"


class TestIoLinesPrintForm:
    """REQ-3.1.3.23: the ``Inputs:`` / ``Outputs:`` lines print their map as compact JSON
    text, and the ``Output:`` line prints its value in WAVE's print form."""

    async def test_inputs_line_prints_null_and_booleans_inside_json(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(), {"plain": None, "conn": {"proxy": {"host": None}, "verify": True}}
        )

        assert _find_line(session_id, "Inputs: ") == (
            'Inputs: {"plain":null,"conn":{"proxy":{"host":null},"verify":true}}'
        )

    async def test_inputs_line_prints_a_masked_value_as_json_text(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin(), {"token": "tok-s3cr3t-l1teral", "plain": "hello world"}
        )

        assert _find_line(session_id, "Inputs: ") == (
            'Inputs: {"token":"********","plain":"hello world"}'
        )

    async def test_outputs_line_prints_null_and_booleans_inside_json(self) -> None:
        session_id = await _run_harness(
            _IOStubPlugin({"status": 200, "location": None, "ok": True}), {}
        )

        assert _find_line(session_id, "Outputs: ") == (
            'Outputs: {"status":200,"location":null,"ok":true}'
        )

    @pytest.mark.parametrize(
        ("result", "line"),
        [
            (True, "Output: true"),
            (False, "Output: false"),
            ([1, None, "x"], 'Output: [1,null,"x"]'),
            (7, "Output: 7"),
        ],
    )
    async def test_singular_output_line_prints_the_print_form(self, result: Any, line: str) -> None:
        session_id = await _run_harness(_IOStubPlugin(result), {})

        assert _find_line(session_id, "Output: ") == line

    async def test_singular_output_line_prints_a_decimal_exactly(self) -> None:
        from decimal import Decimal

        session_id = await _run_harness(_IOStubPlugin(Decimal("1.50")), {})

        assert _find_line(session_id, "Output: ") == "Output: 1.50"


class TestLogMessageThroughTheHarness:
    """REQ-3.1.3.22 / REQ-3.1.3.23: the run path fills a Log message with its own null
    marks, so a null piece prints null in the console instead of failing the block."""

    async def test_a_null_piece_in_a_log_message_prints_null(self) -> None:
        from wavecore.plugins.log import LogPlugin

        session_id = _prime_session(_make_registry())
        await wb_plugins._execute_plugin_with_session(
            LogPlugin(),
            "log",
            {"message": "Value: {{ x }}"},
            {"x": None},
            session_id,
            None,
            None,
            None,
            {"message"},
        )

        assert _find_line(session_id, "Value: ") == "Value: null"
        assert _find_line(session_id, "Rendered 'message': ") == "Rendered 'message': Value: null"


async def _log_whole_value(value: Any, registry: Any) -> list[str]:
    """Run a Log whose message is the expression ``value`` with console scrubbing wired."""
    from wavecore.plugins.log import LogPlugin

    session_id = _prime_session(registry)
    log_streaming_service.register_secret_registry(session_id, registry)
    await wb_plugins._execute_plugin_with_session(
        LogPlugin(),
        "log",
        {"message": "value"},
        {"value": value},
        session_id,
        None,
        None,
        {"message"},
        None,
    )
    return _messages(session_id)


class TestLogMessageOfAnyTypeThroughTheHarness:
    """REQ-3.4.2.2 / REQ-3.1.3.23: the Log message accepts a whole value of any type and
    the run console prints it in WAVE's print form, masked like any other line."""

    @pytest.mark.parametrize(
        ("value", "line"),
        [
            (True, "true"),
            (False, "false"),
            (42, "42"),
            ([1, None], "[1,null]"),
            ({"a": None}, '{"a":null}'),
        ],
    )
    async def test_a_whole_value_prints_in_the_print_form(self, value: Any, line: str) -> None:
        messages = await _log_whole_value(value, _make_registry())

        assert line in messages
        assert not any("expects string" in message for message in messages)

    async def test_a_secret_inside_a_whole_list_prints_masked(self) -> None:
        registry = _make_registry()
        registry.register_value("s3cr3t-t0ken-99", "var")

        messages = await _log_whole_value(["s3cr3t-t0ken-99", None], registry)

        assert '["********",null]' in messages
        assert not any("s3cr3t-t0ken-99" in message for message in messages)


class _QueryStubPlugin(_IOStubPlugin):
    """Data stub: a Query DSL query field that fills its markers escaped for JSON."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "query-stub",
            "version": "1.0.0",
            "parameters": [
                {"name": "query_language", "type": "string"},
                {
                    "name": "query",
                    "type": ["string", "map"],
                    "template_escape": {
                        "by": "query_language",
                        "rules": {"dql": "dql", "query_dsl": "json"},
                        "default": "dql",
                    },
                },
            ],
            "output_schema": [],
        }


class TestSecretTableInAJsonQuery:
    """REQ-3.3.2.6 / REQ-3.1.3.5: a secret table filled alone in a Query DSL query shows
    masked in the run output, never its column names or cells."""

    async def test_the_run_output_masks_the_whole_table(self) -> None:
        from wavecore.core.table import Table

        rows = Table.from_list([{"name": "alpha", "qty": 1}])
        registry = _make_registry()
        registry.register("rows", rows, "declared")
        session_id = _prime_session(registry)
        log_streaming_service.register_secret_registry(session_id, registry)
        await wb_plugins._execute_plugin_with_session(
            _QueryStubPlugin(None),
            "query-stub",
            {"query_language": "query_dsl", "query": '{"terms": {{ rows }}}'},
            {"rows": rows},
            session_id,
            None,
            None,
            None,
            {"query"},
        )

        assert _find_line(session_id, "Rendered 'query': ") == (
            "Rendered 'query': {\"terms\": ********}"
        )
        assert _find_line(session_id, "Inputs: ") == (
            'Inputs: {"query_language":"query_dsl","query":"{\\"terms\\": ********}"}'
        )
        assert not any("alpha" in message for message in _messages(session_id))
