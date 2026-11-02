"""What a Test variable holds when an ad-hoc run starts (REQ-3.2.1.5).

An ad-hoc run - Run Current, Run from Here - starts from the values the session gave
its variables: what a block wrote, what an expression evaluated to, what a Current-mode
edit set. A variable the session gave no value has none of its own, so it follows its
definition as it stands when the run starts; a value edited after the last run is used.
"""

import uuid
from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.api.workbench.conftest import make_test_record
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

_UNSET_PORT = {"lport": {"type": "integer"}}


def _port(value: str) -> dict[str, Any]:
    return {"lport": {"type": "integer", "value": value}}


def _function_node(node_id: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {"nodes": [], "edges": []},
            "displayName": "Fn",
            "label": "Fn",
        },
    }


class _Session:
    """One Workbench session of a Test whose runs end as soon as they start."""

    def __init__(self, holder: dict[str, Any], execute: MagicMock, run_function: MagicMock) -> None:
        self.test_id = str(uuid.uuid4())
        self.environment_id = str(uuid.uuid4())
        self.declared: dict[str, Any] = {}
        self._execute = execute
        self._run_function = run_function
        record = make_test_record(self.test_id)
        record["workflow"]["nodes"].append(_function_node("fn-1"))
        self.workflow: dict[str, Any] = record["workflow"]
        holder["test"] = record

    def _ended(self, result: dict[str, Any], variables: Any = None) -> dict[str, Any]:
        session = wb_common._workbench_sessions[result["session_id"]]
        if variables is not None:
            # The engine publishes the run's live variables on the session.
            session["variables"] = variables
        session["status"] = "failed"
        return session

    def run(self, declared: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
        """Run the block (or the whole Test) with the Test's variables declared as given."""
        self.declared = declared
        target = (
            workbench_service.RunTarget()
            if full
            else workbench_service.RunTarget(single_node_id="node-log")
        )
        result = workbench_service.start_workbench_run(
            test_id=self.test_id, environment_id=self.environment_id, target=target
        )
        return self._ended(result, self._execute.call_args.args[3])

    def run_function(
        self, declared: dict[str, Any] | None = None, *, unsaved: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Run the Function instance's body (Run Scope), on ``declared`` when it is given.

        ``unsaved`` are the variables of a canvas that is not saved yet.
        """
        if declared is not None:
            self.declared = declared
        canvas = {} if unsaved is None else {"workflow": self.workflow, "variables": unsaved}
        result = workbench_service.start_workbench_run(
            test_id=self.test_id,
            environment_id=self.environment_id,
            scope=workbench_service.ScopedRunOptions(mode="function", function_node_id="fn-1"),
            **canvas,
        )
        return self._ended(result)

    def read_port_into_the_function(self) -> None:
        """Give the Function Block an input ``port`` whose expression reads ``lport``."""
        (node,) = [node for node in self.workflow["nodes"] if node["id"] == "fn-1"]
        node["data"]["localDefinition"]["inputs"] = [
            {"name": "port", "type": "integer", "required": False}
        ]
        node["data"]["config"] = {
            "values": {"port": "lport"},
            "outputBindings": {},
            "profileBindings": [],
        }
        node["data"]["expressionFields"] = ["port"]

    def function_inputs(self) -> dict[str, Any]:
        """The inputs the last Function run starts from, resolved over the Test state."""
        start = self._run_function.call_args.args[2]
        return dict(start.input_values)


@pytest.fixture
def session(workbench_run_mocks: dict[str, Any]) -> Generator[_Session, None, None]:
    with (
        patch(
            "wavecore.api.services.workbench.service._execute_workflow", new_callable=MagicMock
        ) as execute,
        patch(
            "wavecore.api.services.workbench.service._run_scoped_function", new_callable=MagicMock
        ) as run_function,
        patch(
            "wavecore.api.services.workbench.service.test_service.get_test_variables_raw",
            side_effect=lambda _test_id: started.declared,
        ),
    ):
        started = _Session(workbench_run_mocks, execute, run_function)
        yield started


class TestAVariableTheSessionGaveNoValue:
    """It follows its definition, so an edit made after the last run is used."""

    def test_a_value_given_to_an_unset_variable_reaches_the_next_block_run(
        self, session: _Session
    ) -> None:
        assert session.run(_UNSET_PORT)["variables"]["lport"] is None

        assert session.run(_port("9874"))["variables"]["lport"] == 9874

    def test_every_later_edit_reaches_the_next_block_run(self, session: _Session) -> None:
        session.run(_UNSET_PORT)
        session.run(_port("9874"))

        assert session.run(_port("1234"))["variables"]["lport"] == 1234

    def test_an_edited_value_reaches_the_block_run_after_a_full_run(
        self, session: _Session
    ) -> None:
        session.run(_port("8080"), full=True)

        assert session.run(_port("9090"))["variables"]["lport"] == 9090

    def test_a_value_taken_away_reads_as_null_again(self, session: _Session) -> None:
        session.run(_port("8080"))

        assert session.run(_UNSET_PORT)["variables"]["lport"] is None

    def test_a_literal_turned_into_an_expression_is_evaluated_by_the_next_block_run(
        self, session: _Session
    ) -> None:
        host = {"host": {"type": "string", "value": "b"}}
        session.run({**host, "url": {"type": "string", "value": "http://a"}})

        declared = {
            **host,
            "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
        }
        assert session.run(declared)["variables"]["url"] == "http://b"

    def test_a_removed_variable_is_gone_from_the_next_block_run(self, session: _Session) -> None:
        session.run(_port("8080"))

        assert "lport" not in session.run({})["variables"]

    def test_an_edit_reaches_the_block_run_after_a_function_run(self, session: _Session) -> None:
        session.run(_UNSET_PORT)
        session.run_function()

        assert session.run(_port("9874"))["variables"]["lport"] == 9874


class TestARunInsideAFunctionBody:
    """A Function-body run reads the Test's variables by the same rule (REQ-3.2.1.5)."""

    def test_it_sees_a_value_edited_after_the_last_run(self, session: _Session) -> None:
        session.read_port_into_the_function()
        session.run(_UNSET_PORT)

        function_run = session.run_function(_port("9874"))

        assert function_run["variables"]["lport"] == 9874
        assert session.function_inputs() == {"port": 9874}

    def test_it_keeps_a_value_a_block_wrote(self, session: _Session) -> None:
        session.read_port_into_the_function()
        session.run(_UNSET_PORT)["variables"]["lport"] = 54321

        function_run = session.run_function(_port("9874"))

        assert function_run["variables"]["lport"] == 54321
        assert session.function_inputs() == {"port": 54321}

    def test_the_edit_it_saw_is_not_pinned_for_the_next_block_run(self, session: _Session) -> None:
        session.run(_UNSET_PORT)
        session.run_function(_port("9874"))

        assert session.run(_port("1234"))["variables"]["lport"] == 1234

    def test_it_reads_the_variables_of_an_unsaved_canvas(self, session: _Session) -> None:
        session.read_port_into_the_function()
        session.run(_UNSET_PORT)

        function_run = session.run_function(unsaved=_port("9874"))

        assert function_run["variables"]["lport"] == 9874
        assert session.function_inputs() == {"port": 9874}

    def test_a_masked_secret_of_an_unsaved_canvas_is_the_stored_one(
        self, session: _Session
    ) -> None:
        session.run({"token": {"type": "string", "value": "s3cret-token", "secret": True}})
        masked = {"token": {"type": "string", "value": MASK_PLACEHOLDER, "secret": True}}

        function_run = session.run_function(unsaved=masked)

        assert function_run["variables"]["token"] == "s3cret-token"

    def test_the_first_run_of_a_session_seeds_no_test_variable(self, session: _Session) -> None:
        session.read_port_into_the_function()

        function_run = session.run_function(_port("9874"))

        assert dict(function_run["variables"]) == {}
        assert session.function_inputs() == {}

    async def test_a_variable_of_the_body_does_not_pin_a_test_variable_of_the_same_name(
        self, session: _Session
    ) -> None:
        first = session.run(_UNSET_PORT)
        # A Function announces its own inputs, outputs and local variables on the Test's session.
        await wb_common._push_variable_changes(first["session_id"], {}, {"lport": 8080})

        assert session.run(_port("9874"))["variables"]["lport"] == 9874


class TestAVariableTheSessionGaveAValue:
    """It keeps that value through later ad-hoc runs, whatever its definition says."""

    def test_a_value_a_block_wrote_outlives_an_edited_definition(self, session: _Session) -> None:
        session.run(_UNSET_PORT)["variables"]["lport"] = 54321

        assert session.run(_port("9874"))["variables"]["lport"] == 54321

    def test_it_stays_through_every_later_block_run(self, session: _Session) -> None:
        session.run(_UNSET_PORT)["variables"]["lport"] = 54321
        session.run(_UNSET_PORT)

        assert session.run(_port("9874"))["variables"]["lport"] == 54321

    def test_it_stays_through_a_function_run(self, session: _Session) -> None:
        session.run(_UNSET_PORT)["variables"]["lport"] = 54321
        session.run_function()

        assert session.run(_port("9874"))["variables"]["lport"] == 54321

    def test_a_block_that_wrote_zero_over_the_null_start_gave_it_a_value(
        self, session: _Session
    ) -> None:
        session.run(_UNSET_PORT)["variables"]["lport"] = 0

        assert session.run(_port("9874"))["variables"]["lport"] == 0

    def test_a_block_that_wrote_null_over_the_null_start_gave_it_a_value(
        self, session: _Session
    ) -> None:
        session.run(_UNSET_PORT)["variables"]["lport"] = None

        assert session.run(_port("9874"))["variables"]["lport"] is None

    def test_a_block_that_wrote_the_value_it_already_had_gave_it_a_value(
        self, session: _Session
    ) -> None:
        session.run(_port("8080"))["variables"]["lport"] = 8080

        assert session.run(_port("9874"))["variables"]["lport"] == 8080

    def test_a_variable_removed_by_a_block_is_read_from_its_definition_again(
        self, session: _Session
    ) -> None:
        first = session.run(_UNSET_PORT)
        first["variables"]["lport"] = 54321
        del first["variables"]["lport"]

        assert session.run(_port("9874"))["variables"]["lport"] == 9874

    def test_a_current_value_the_user_set_outlives_an_edited_definition(
        self, session: _Session
    ) -> None:
        first = session.run(_UNSET_PORT)
        workbench_service.set_variable_override(
            first["session_id"], "lport", value="0", value_given=True, declared_type="integer"
        )

        assert session.run(_port("9874"))["variables"]["lport"] == 0


class TestACurrentSourceTheUserSet:
    """A Current-mode edit of an expression or a template holds through later ad-hoc runs."""

    _HOST = {"host": {"type": "string", "value": "b"}}

    @pytest.mark.parametrize("evaluated_first", [True, False])
    def test_an_expression_source_outlives_the_run_it_was_set_after(
        self, session: _Session, evaluated_first: bool
    ) -> None:
        declared = {
            **self._HOST,
            "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
        }
        first = session.run(declared)
        if evaluated_first:
            assert first["variables"]["url"] == "http://b"
        workbench_service.set_variable_override(
            first["session_id"], "url", expression="'https://' + host", declared_type="string"
        )

        assert session.run(declared)["variables"]["url"] == "https://b"

    def test_a_template_source_outlives_the_run_it_was_set_after(self, session: _Session) -> None:
        declared = {
            **self._HOST,
            "url": {"type": "string", "value": "http://{{ host }}", "isTemplate": True},
        }
        first = session.run(declared)
        workbench_service.set_variable_override(
            first["session_id"], "url", template="https://{{ host }}", declared_type="string"
        )

        assert session.run(declared)["variables"]["url"] == "https://b"

    def _expression(self) -> dict[str, Any]:
        return {
            **self._HOST,
            "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
        }

    def _set_expression(self, started: dict[str, Any], source: str) -> None:
        workbench_service.set_variable_override(
            started["session_id"], "url", expression=source, declared_type="string"
        )

    def test_a_source_no_block_read_yet_reaches_the_run_after_the_next(
        self, session: _Session
    ) -> None:
        self._set_expression(session.run(self._expression()), "'https://' + host")
        session.run(self._expression())

        assert session.run(self._expression())["variables"]["url"] == "https://b"

    def test_a_source_holds_through_a_function_run(self, session: _Session) -> None:
        self._set_expression(session.run(self._expression()), "'https://' + host")
        session.run_function()

        assert session.run(self._expression())["variables"]["url"] == "https://b"

    def test_a_literal_set_afterwards_replaces_the_source(self, session: _Session) -> None:
        first = session.run(self._expression())
        self._set_expression(first, "'https://' + host")
        workbench_service.set_variable_override(
            first["session_id"], "url", value="ftp://x", value_given=True, declared_type="string"
        )

        assert session.run(self._expression())["variables"]["url"] == "ftp://x"

    def test_a_template_set_afterwards_replaces_the_expression(self, session: _Session) -> None:
        first = session.run(self._expression())
        self._set_expression(first, "'https://' + host")
        workbench_service.set_variable_override(
            first["session_id"], "url", template="ws://{{ host }}", declared_type="string"
        )

        assert session.run(self._expression())["variables"]["url"] == "ws://b"

    def test_an_expression_set_afterwards_replaces_the_template(self, session: _Session) -> None:
        first = session.run(self._expression())
        workbench_service.set_variable_override(
            first["session_id"], "url", template="ws://{{ host }}", declared_type="string"
        )
        self._set_expression(first, "'https://' + host")

        assert session.run(self._expression())["variables"]["url"] == "https://b"

    def test_a_source_set_on_a_literal_replaces_its_definition(self, session: _Session) -> None:
        declared = {**self._HOST, "url": {"type": "string", "value": "http://a"}}
        self._set_expression(session.run(declared), "'https://' + host")

        assert session.run(declared)["variables"]["url"] == "https://b"

    def test_a_full_run_goes_back_to_the_definition(self, session: _Session) -> None:
        self._set_expression(session.run(self._expression()), "'https://' + host")

        assert session.run(self._expression(), full=True)["variables"]["url"] == "http://b"


_HOST = {"host": {"type": "string", "value": "b"}}
_HOST_EDITED = {"host": {"type": "string", "value": "c"}}


def _expression(source: str, var_type: str = "string") -> dict[str, Any]:
    return {"type": var_type, "value": source, "isExpression": True}


def _template(source: str) -> dict[str, Any]:
    return {"type": "string", "value": source, "isTemplate": True}


_URL = {"url": _expression("'http://' + host")}


class TestAnEvaluatedResultAfterAnEdit:
    """An edit of its source, or of a variable it reads, makes the next ad-hoc run evaluate it
    again (REQ-3.2.1.5)."""

    def test_an_edited_variable_it_reads_reaches_the_next_block_run(
        self, session: _Session
    ) -> None:
        declared = {
            "host": {"type": "string", "value": "b"},
            "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
        }
        assert session.run(declared)["variables"]["url"] == "http://b"

        edited = {**declared, "host": {"type": "string", "value": "c"}}
        assert session.run(edited)["variables"]["url"] == "http://c"

    def test_an_edited_source_is_evaluated_by_the_next_block_run(self, session: _Session) -> None:
        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://b"

        edited = {**_HOST, "url": _expression("'https://' + host")}
        assert session.run(edited)["variables"]["url"] == "https://b"

    def test_a_template_follows_an_edited_variable_it_reads(self, session: _Session) -> None:
        declared = {**_HOST, "url": _template("http://{{ host }}")}
        assert session.run(declared)["variables"]["url"] == "http://b"

        assert session.run({**declared, **_HOST_EDITED})["variables"]["url"] == "http://c"

    def test_a_template_follows_its_edited_source(self, session: _Session) -> None:
        assert session.run({**_HOST, "url": _template("http://{{ host }}")})["variables"][
            "url"
        ] == ("http://b")

        edited = {**_HOST, "url": _template("https://{{ host }}")}
        assert session.run(edited)["variables"]["url"] == "https://b"

    def test_an_edit_reaches_a_result_that_reads_it_through_another(
        self, session: _Session
    ) -> None:
        chain = {"b": _expression("a + 1", "integer"), "c": _expression("b + 1", "integer")}
        assert session.run({"a": {"type": "integer", "value": "1"}, **chain})["variables"]["c"] == 3

        edited = session.run({"a": {"type": "integer", "value": "10"}, **chain})["variables"]

        assert (edited["b"], edited["c"]) == (11, 12)

    def test_a_variable_turned_into_an_expression_counts_as_edited(self, session: _Session) -> None:
        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://b"

        edited = {"host": _expression("'c' + 'd'"), **_URL}
        assert session.run(edited)["variables"]["url"] == "http://cd"

    def test_a_variable_it_reads_that_was_removed_is_missed_by_the_next_block_run(
        self, session: _Session
    ) -> None:
        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://b"

        with pytest.raises(Exception, match="^Variable 'host' is not defined$"):
            session.run(_URL)["variables"]["url"]

    def test_a_current_mode_value_of_a_variable_it_reads_reaches_the_next_block_run(
        self, session: _Session
    ) -> None:
        first = session.run({**_HOST, **_URL})
        assert first["variables"]["url"] == "http://b"
        workbench_service.set_variable_override(
            first["session_id"], "host", value="c", value_given=True, declared_type="string"
        )

        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://c"

    def test_a_current_mode_source_of_a_variable_it_reads_reaches_the_next_block_run(
        self, session: _Session
    ) -> None:
        declared = {"path": _expression("'/a'"), "url": _expression("'http://h' + path")}
        first = session.run(declared)
        assert first["variables"]["url"] == "http://h/a"
        workbench_service.set_variable_override(
            first["session_id"], "path", expression="'/z'", declared_type="string"
        )

        assert session.run(declared)["variables"]["url"] == "http://h/z"

    def test_an_edit_made_while_the_run_is_paused_changes_nothing_inside_that_run(
        self, session: _Session
    ) -> None:
        first = session.run({**_HOST, **_URL})
        assert first["variables"]["url"] == "http://b"
        first["status"] = "paused"
        workbench_service.set_variable_override(
            first["session_id"], "host", value="c", value_given=True, declared_type="string"
        )

        assert first["variables"]["url"] == "http://b"
        first["status"] = "failed"
        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://c"

    def test_the_same_holds_for_a_run_inside_a_function_body(self, session: _Session) -> None:
        assert session.run({**_HOST, **_URL})["variables"]["url"] == "http://b"

        function_run = session.run_function({**_HOST_EDITED, **_URL})

        assert function_run["variables"]["url"] == "http://c"

    def test_a_current_mode_source_follows_an_edited_variable_it_reads(
        self, session: _Session
    ) -> None:
        declared = {
            "host": {"type": "string", "value": "b"},
            "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
        }
        workbench_service.set_variable_override(
            session.run(declared)["session_id"],
            "url",
            expression="'https://' + host",
            declared_type="string",
        )
        assert session.run(declared)["variables"]["url"] == "https://b"

        edited = {**declared, "host": {"type": "string", "value": "c"}}
        assert session.run(edited)["variables"]["url"] == "https://c"

    def test_a_current_mode_source_still_holds_two_block_runs_after_it_was_evaluated(
        self, session: _Session
    ) -> None:
        declared = {**_HOST, **_URL}
        workbench_service.set_variable_override(
            session.run(declared)["session_id"],
            "url",
            expression="'https://' + host",
            declared_type="string",
        )
        assert session.run(declared)["variables"]["url"] == "https://b"
        session.run(declared)

        assert session.run({**_HOST_EDITED, **_URL})["variables"]["url"] == "https://c"


class TestAnEvaluatedResultNothingEdited:
    """It keeps its result: a time or a random value does not change between two block runs."""

    _ITEMS = {
        **_HOST,
        "other": {"type": "string", "value": "x"},
        "items": _expression("[host]", "array"),
    }

    def test_it_is_not_evaluated_again_by_the_next_block_runs(self, session: _Session) -> None:
        first = session.run(self._ITEMS)["variables"]["items"]
        session.run(self._ITEMS)

        assert session.run(self._ITEMS)["variables"]["items"] is first

    def test_an_edit_of_a_variable_it_does_not_read_leaves_it(self, session: _Session) -> None:
        first = session.run(self._ITEMS)["variables"]["items"]

        edited = {**self._ITEMS, "other": {"type": "string", "value": "y"}}
        assert session.run(edited)["variables"]["items"] is first

    def test_a_variable_it_reads_declared_again_with_the_same_value_leaves_it(
        self, session: _Session
    ) -> None:
        table = {
            "type": "table",
            "value": {"columns": [{"name": "k", "type": "string"}], "rows": [{"k": "v"}]},
        }
        declared = {"grid": table, "rows": _expression("[len(grid)]", "array")}
        first = session.run(declared)["variables"]["rows"]

        assert first == [1]
        assert session.run({**declared, "grid": dict(table)})["variables"]["rows"] is first

    def test_a_result_evaluated_after_a_current_mode_edit_is_kept(self, session: _Session) -> None:
        first = session.run(self._ITEMS)
        workbench_service.set_variable_override(
            first["session_id"], "host", value="c", value_given=True, declared_type="string"
        )
        evaluated = first["variables"]["items"]

        assert evaluated == ["c"]
        assert session.run(self._ITEMS)["variables"]["items"] is evaluated

    def test_a_block_write_to_a_variable_it_reads_is_not_an_edit(self, session: _Session) -> None:
        first = session.run({**_HOST, **_URL})
        assert first["variables"]["url"] == "http://b"
        first["variables"]["host"] = "from-a-block"

        later = session.run({**_HOST_EDITED, **_URL})["variables"]

        assert (later["host"], later["url"]) == ("from-a-block", "http://b")


class TestAValueGivenToTheExpressionItself:
    """A block's write into it, and a Current-mode value, still win over every later edit."""

    def test_a_value_a_block_wrote_into_it_outlives_an_edited_variable_it_reads(
        self, session: _Session
    ) -> None:
        first = session.run({**_HOST, **_URL})
        assert first["variables"]["url"] == "http://b"
        first["variables"]["url"] = "from-a-block"

        assert session.run({**_HOST_EDITED, **_URL})["variables"]["url"] == "from-a-block"

    def test_a_current_mode_value_of_it_outlives_an_edited_variable_it_reads(
        self, session: _Session
    ) -> None:
        first = session.run({**_HOST, **_URL})
        assert first["variables"]["url"] == "http://b"
        workbench_service.set_variable_override(
            first["session_id"], "url", value="ftp://x", value_given=True, declared_type="string"
        )

        assert session.run({**_HOST_EDITED, **_URL})["variables"]["url"] == "ftp://x"


class TestASecretTheSessionProduced:
    """An ad-hoc run keeps masking what earlier runs of the session marked secret (REQ-3.1.3.5)."""

    _TOKEN = "s3cr3t-runtime-value"

    def test_a_secret_block_output_stays_secret_in_the_next_block_run(
        self, session: _Session
    ) -> None:
        first = session.run({"tok": {"type": "string"}})
        first["secret_registry"].register("tok", self._TOKEN, "output")
        first["variables"]["tok"] = self._TOKEN

        registry = session.run({"tok": {"type": "string"}})["secret_registry"]

        assert registry.is_secret_name("tok")
        assert self._TOKEN in registry.scan_values()

    def test_a_value_written_to_an_unset_secret_stays_scrubbed_in_the_next_block_run(
        self, session: _Session
    ) -> None:
        declared = {"tok": {"type": "string", "secret": True}}
        session.run(declared)["variables"]["tok"] = self._TOKEN

        assert self._TOKEN in session.run(declared)["secret_registry"].scan_values()

    def test_a_full_run_starts_with_its_own_secrets_only(self, session: _Session) -> None:
        first = session.run({"tok": {"type": "string"}})
        first["secret_registry"].register("tok", self._TOKEN, "output")

        registry = session.run({"tok": {"type": "string"}}, full=True)["secret_registry"]

        assert not registry.is_secret_name("tok")
        assert self._TOKEN not in registry.scan_values()

    def test_a_filled_variable_marked_secret_afterwards_is_scrubbed(
        self, session: _Session
    ) -> None:
        session.run({"tok": {"type": "string"}})["variables"]["tok"] = self._TOKEN

        registry = session.run({"tok": {"type": "string", "secret": True}})["secret_registry"]

        assert self._TOKEN in registry.scan_values()

    def test_a_secret_made_plain_is_plain_in_the_next_block_run(self, session: _Session) -> None:
        declared = {"tok": {"type": "string", "value": "s3cr3t-old", "secret": True}}
        session.run(declared)["variables"]["tok"] = self._TOKEN

        registry = session.run({"tok": {"type": "string", "value": "s3cr3t-old"}})[
            "secret_registry"
        ]

        assert not registry.is_secret_name("tok")
        assert self._TOKEN not in registry.scan_values()

    def test_a_value_a_block_resolved_can_be_revealed_by_the_next_block_run(
        self, session: _Session
    ) -> None:
        session.run({})["secret_registry"].register_value(self._TOKEN, "param")

        registry = session.run({})["secret_registry"]
        registry.register_value(self._TOKEN, "param", exempt_block="node-log")

        assert self._TOKEN not in registry.scan_values(exclude_for_block="node-log")

    def test_a_secret_block_output_stays_secret_through_every_later_block_run(
        self, session: _Session
    ) -> None:
        first = session.run({"tok": {"type": "string"}})
        first["secret_registry"].register("tok", self._TOKEN, "output")
        first["variables"]["tok"] = self._TOKEN
        session.run({"tok": {"type": "string"}})

        registry = session.run({"tok": {"type": "string"}})["secret_registry"]

        assert registry.is_secret_name("tok")
        assert self._TOKEN in registry.scan_values()

    def test_a_secret_no_run_wrote_registers_nothing_from_its_null_start(
        self, session: _Session
    ) -> None:
        declared = {"pin": {"type": "integer", "secret": True}}
        session.run(declared)

        assert "0" not in session.run(declared)["secret_registry"].scan_values()


class TestACurrentEditAfterAFunctionRun:
    """A session whose last run was a Function body takes Current-mode edits like any other."""

    _DECLARED = {
        "host": {"type": "string", "value": "b"},
        "url": {"type": "string", "value": "'http://' + host", "isExpression": True},
    }

    def test_an_expression_source_reaches_the_next_block_run(self, session: _Session) -> None:
        session.run(self._DECLARED)
        workbench_service.set_variable_override(
            session.run_function()["session_id"],
            "url",
            expression="'https://' + host",
            declared_type="string",
        )

        assert session.run(self._DECLARED)["variables"]["url"] == "https://b"

    def test_a_template_source_reaches_the_next_block_run(self, session: _Session) -> None:
        session.run(self._DECLARED)
        workbench_service.set_variable_override(
            session.run_function()["session_id"],
            "url",
            template="ws://{{ host }}",
            declared_type="string",
        )

        assert session.run(self._DECLARED)["variables"]["url"] == "ws://b"

    def test_a_value_written_to_a_secret_is_scrubbed(self, session: _Session) -> None:
        session.run({"tok": {"type": "string", "secret": True}})
        function_run = session.run_function()

        function_run["variables"]["tok"] = "s3cr3t-runtime-value"

        assert "s3cr3t-runtime-value" in function_run["secret_registry"].scan_values()
