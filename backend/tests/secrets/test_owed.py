"""What a person still owes: every secret place that holds nothing (REQ-3.1.3.20, REQ-4.5.19)."""

from collections.abc import Generator
from typing import Any

import pytest

from wavecore.core.secrets.owed import (
    OwedSecret,
    owed_fields,
    owed_in_function,
    owed_in_test,
    owed_in_workflow,
    owed_variables,
)
from wavecore.plugins.base import PluginBase

_CRED_PLUGIN = "stub-owed-cred-plugin"


class _CredPlugin(PluginBase):
    """Stub plugin declaring one secret setting and one plain setting."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": _CRED_PLUGIN,
            "version": "1.0.0",
            "parameters": [
                {"name": "password", "type": "string", "secret": True},
                {"name": "host", "type": "string"},
            ],
        }

    async def execute(self, context: dict[str, Any]) -> Any:
        return None

    async def validate(self, params: dict[str, Any]) -> None:
        return None


@pytest.fixture
def _cred_plugin() -> Generator[None, None, None]:
    from wavecore.core.plugin_registry import clear_registry, register_plugin

    clear_registry()
    register_plugin(_CredPlugin())
    yield
    clear_registry()


def _credential_block(block_id: str, values: dict[str, Any], **data: Any) -> dict[str, Any]:
    return {
        "id": block_id,
        "data": {
            "elementType": _CRED_PLUGIN,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": values},
            **data,
        },
    }


def _setter_block(block_id: str, rows: dict[str, Any], secret: list[str]) -> dict[str, Any]:
    return {
        "id": block_id,
        "data": {
            "elementType": "variable-setter",
            "nodeType": "control",
            "config": {"values": {"variables": rows}, "variableSecretKeys": secret},
        },
    }


def _function_block(block_id: str, definition: dict[str, Any], **data: Any) -> dict[str, Any]:
    return {
        "id": block_id,
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": definition,
            **data,
        },
    }


def _workflow(*blocks: dict[str, Any]) -> dict[str, Any]:
    return {"nodes": list(blocks), "edges": []}


def _writer(block_id: str, target: str) -> dict[str, Any]:
    """A block whose output binding writes ``target``."""
    return {
        "id": block_id,
        "data": {"nodeType": "plugin", "config": {"values": {}, "outputBindings": {"x": target}}},
    }


class TestOwedVariables:
    def test_a_secret_holding_null_or_empty_text_is_owed(self) -> None:
        variables = {
            "nulled": {"type": "string", "secret": True, "value": None},
            "empty": {"type": "string", "secret": True, "value": ""},
            "undeclared_value": {"type": "string", "secret": True},
        }

        assert owed_variables(variables) == [
            OwedSecret("nulled", "variables.nulled"),
            OwedSecret("empty", "variables.empty"),
            OwedSecret("undeclared_value", "variables.undeclared_value"),
        ]

    def test_a_held_secret_a_plain_variable_and_a_written_secret_owe_nothing(self) -> None:
        variables = {
            "held": {"type": "string", "secret": True, "value": "hunter2"},
            "plain": {"type": "string", "value": None},
            "captured": {"type": "string", "secret": True, "value": None},
        }

        assert owed_variables(variables, written={"captured"}) == []

    def test_the_prefix_names_the_place(self) -> None:
        variables = {"tok": {"type": "string", "secret": True, "value": None}}

        assert owed_variables(variables, prefix="system") == [OwedSecret("tok", "system.tok")]

    def test_no_variables_owe_nothing(self) -> None:
        assert owed_variables(None) == []


class TestOwedFields:
    def test_a_secret_field_holding_null_and_a_typed_secret_holding_nothing_are_owed(self) -> None:
        values = {
            "auth_password": None,
            "token": {"type": "string", "secret": True, "value": ""},
        }

        assert owed_fields(values, {"auth_password"}, prefix="config") == [
            OwedSecret("auth_password", "config.auth_password", field=True),
            OwedSecret("token", "config.token", field=True),
        ]

    def test_an_empty_secret_field_a_plain_null_and_a_held_secret_owe_nothing(self) -> None:
        values = {
            "auth_password": "",
            "base_url": None,
            "auth_key": "wave:enc:v1:c2VhbGVk",
            "typed": {"type": "string", "secret": True, "value": "held"},
        }

        assert owed_fields(values, {"auth_password", "auth_key"}, prefix="config") == []

    def test_an_environment_value_names_its_environment(self) -> None:
        owed = owed_fields(
            {"auth_password": None},
            {"auth_password"},
            prefix="environment_values.Staging",
            environment="Staging",
        )

        assert owed == [
            OwedSecret(
                "auth_password",
                "environment_values.Staging.auth_password",
                field=True,
                environment="Staging",
            )
        ]

    def test_no_values_owe_nothing(self) -> None:
        assert owed_fields(None, {"auth_password"}, prefix="config") == []


@pytest.mark.usefixtures("_cred_plugin")
class TestOwedInWorkflow:
    def test_a_credential_holding_null_is_an_owed_field(self) -> None:
        workflow = _workflow(_credential_block("http", {"password": None, "host": None}))

        assert owed_in_workflow(workflow) == [
            OwedSecret("password", "blocks.http.password", field=True)
        ]

    def test_an_empty_credential_and_an_expression_credential_owe_nothing(self) -> None:
        workflow = _workflow(
            _credential_block("typed", {"password": ""}),
            _credential_block("expr", {"password": None}, expressionFields=["password"]),
        )

        assert owed_in_workflow(workflow) == []

    def test_a_secret_setter_row_holding_null_is_an_owed_variable(self) -> None:
        workflow = _workflow(
            _setter_block("set", {"api_tok": None, "plain": None, "kept": ""}, ["api_tok", "kept"])
        )

        assert owed_in_workflow(workflow) == [OwedSecret("api_tok", "blocks.set.variables.api_tok")]

    def test_a_secret_function_input_holding_null_is_an_owed_field(self) -> None:
        definition = {"inputs": [{"name": "tok", "secret": True}, {"name": "plain"}]}
        block = _function_block("fn", definition, config={"values": {"tok": None, "plain": None}})

        assert owed_in_workflow(_workflow(block)) == [
            OwedSecret("tok", "blocks.fn.tok", field=True)
        ]

    def test_a_shared_function_block_names_its_secret_inputs_through_the_lookup(self) -> None:
        block = {
            "id": "lib",
            "data": {
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": "fn-1",
                "functionVersion": "1.0.0",
                "config": {"values": {"tok": None}},
            },
        }

        owed = owed_in_workflow(_workflow(block), secret_inputs=lambda data: {"tok"})

        assert owed == [OwedSecret("tok", "blocks.lib.tok", field=True)]

    def test_a_secret_function_input_two_functions_deep_names_both_blocks(self) -> None:
        inner = _function_block(
            "inner",
            {"inputs": [{"name": "tok", "secret": True}]},
            config={"values": {"tok": None}},
        )
        outer = _function_block("outer", {"workflow": _workflow(inner)})

        assert owed_in_workflow(_workflow(outer)) == [
            OwedSecret("tok", "blocks.outer.blocks.inner.tok", field=True)
        ]

    def test_an_empty_or_expression_secret_function_input_owes_nothing(self) -> None:
        definition = {"inputs": [{"name": "tok", "secret": True}]}
        workflow = _workflow(
            _function_block("typed", definition, config={"values": {"tok": ""}}),
            _function_block(
                "expr", definition, config={"values": {"tok": None}}, expressionFields=["tok"]
            ),
            _function_block(
                "tmpl", definition, config={"values": {"tok": None}}, templateFields=["tok"]
            ),
        )

        assert owed_in_workflow(workflow) == []

    def test_an_input_bindings_entry_is_not_a_secret_place(self) -> None:
        definition = {"inputs": [{"name": "tok", "secret": True}]}
        block = _function_block("fn", definition, inputBindings={"tok": None})

        assert owed_in_workflow(_workflow(block)) == []

    def test_a_local_functions_secrets_owe_unless_its_body_writes_them(self) -> None:
        definition = {
            "variables": [
                {"name": "local_tok", "secret": True, "value": None},
                {"name": "filled_tok", "secret": True, "value": None},
            ],
            "outputs": [
                {"name": "out_tok", "secret": True, "default": None},
                {"name": "written_out", "secret": True},
            ],
            "workflow": _workflow(_writer("w1", "filled_tok"), _writer("w2", "written_out")),
        }

        assert owed_in_workflow(_workflow(_function_block("fn", definition))) == [
            OwedSecret("local_tok", "blocks.fn.variables.local_tok"),
            OwedSecret("out_tok", "blocks.fn.outputs.out_tok"),
        ]

    def test_a_secret_two_functions_deep_names_both_blocks(self) -> None:
        inner = _function_block(
            "inner",
            {
                "variables": [{"name": "deep_tok", "secret": True, "value": None}],
                "workflow": _workflow(_credential_block("http", {"password": None})),
            },
        )
        outer = _function_block("outer", {"workflow": _workflow(inner)})

        assert owed_in_workflow(_workflow(outer), prefix="workflow.") == [
            OwedSecret("password", "workflow.blocks.outer.blocks.inner.blocks.http.password", True),
            OwedSecret("deep_tok", "workflow.blocks.outer.blocks.inner.variables.deep_tok"),
        ]


@pytest.mark.usefixtures("_cred_plugin")
class TestOwedInTest:
    def test_its_variables_then_every_place_its_blocks_hold(self) -> None:
        test_data = {
            "variables": {
                "api_tok": {"type": "string", "secret": True, "value": None},
                "captured": {"type": "string", "secret": True, "value": None},
            },
            "workflow": _workflow(
                _writer("w", "captured"),
                _credential_block("http", {"password": None}),
            ),
        }

        assert owed_in_test(test_data) == [
            OwedSecret("api_tok", "variables.api_tok"),
            OwedSecret("password", "blocks.http.password", field=True),
        ]

    def test_a_secret_only_a_muted_block_fills_is_owed(self) -> None:
        muted = _writer("w", "captured")
        muted["data"]["disabled"] = True
        test_data = {
            "variables": {"captured": {"type": "string", "secret": True, "value": None}},
            "workflow": _workflow(muted),
        }

        assert owed_in_test(test_data) == [OwedSecret("captured", "variables.captured")]

    def test_a_test_with_no_workflow_owes_its_variables(self) -> None:
        test_data = {"variables": {"tok": {"type": "string", "secret": True}}}

        assert owed_in_test(test_data) == [OwedSecret("tok", "variables.tok")]


@pytest.mark.usefixtures("_cred_plugin")
class TestOwedInFunction:
    def test_its_declarations_then_its_body(self) -> None:
        definition = {
            "variables": [{"name": "local_tok", "secret": True, "value": None}],
            "outputs": [{"name": "out_tok", "secret": True, "default": "held"}],
            "workflow": _workflow(_credential_block("http", {"password": None})),
        }

        assert owed_in_function(definition) == [
            OwedSecret("local_tok", "variables.local_tok"),
            OwedSecret("password", "blocks.http.password", field=True),
        ]

    def test_a_function_with_no_workflow_owes_its_declarations(self) -> None:
        definition = {"variables": [{"name": "local_tok", "secret": True, "value": None}]}

        assert owed_in_function(definition) == [OwedSecret("local_tok", "variables.local_tok")]
