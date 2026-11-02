"""The free variable names of an expression (REQ-3.1.3.13): what the save-time
undeclared-variable scan and the computed-variable cycle check read."""


class TestExtractExpressionNamesScopes:
    """A name bound by a comprehension or a lambda is local, not a variable reference.

    The save-time undeclared-variable scan reads this function, so a name it
    wrongly reports blocks the user from saving a perfectly valid expression.
    """

    @staticmethod
    def names(expression: str) -> set[str]:
        from wavecore.core.variables.computed import extract_expression_names

        return extract_expression_names(expression)

    def test_plain_reference_is_still_collected(self) -> None:
        assert self.names("rows") == {"rows"}

    def test_generator_target_is_local(self) -> None:
        assert self.names("','.join(str(r) for r in rows)") == {"rows"}

    def test_list_comprehension_target_is_local(self) -> None:
        assert self.names("[r for r in rows]") == {"rows"}

    def test_set_comprehension_target_is_local(self) -> None:
        assert self.names("{r for r in rows}") == {"rows"}

    def test_dict_comprehension_targets_are_local(self) -> None:
        assert self.names("{k: v for k, v in pairs}") == {"pairs"}

    def test_tuple_unpacking_target_is_local(self) -> None:
        assert self.names("[a + b for a, b in pairs]") == {"pairs"}

    def test_nested_comprehension_targets_are_local(self) -> None:
        assert self.names("[x + y for x in outer for y in inner]") == {"outer", "inner"}

    def test_lambda_parameter_is_local(self) -> None:
        assert self.names("list(map(lambda r: r, rows))") == {"rows"}

    def test_lambda_varargs_are_local(self) -> None:
        assert self.names("(lambda *args: sum(args))(total)") == {"total"}

    def test_comprehension_condition_keeps_free_names(self) -> None:
        assert self.names("[r for r in rows if r > threshold]") == {"rows", "threshold"}

    def test_a_genuinely_free_name_inside_a_comprehension_is_still_collected(self) -> None:
        assert self.names("[r * factor for r in rows]") == {"rows", "factor"}

    def test_the_target_name_is_free_again_outside_its_comprehension(self) -> None:
        assert self.names("[r for r in rows] + [r]") == {"rows", "r"}

    def test_builtins_are_not_collected(self) -> None:
        assert self.names("len(rows)") == {"rows"}

    def test_a_syntax_error_yields_no_names(self) -> None:
        assert self.names("rows +") == set()

    def test_sandbox_builtins_are_not_variable_references(self) -> None:
        assert self.names("str(map(str, rows))") == {"rows"}
        assert self.names("str(any(rows))") == {"rows"}
        assert self.names("str(filter(None, rows))") == {"rows"}
        assert self.names("str(Table(columns=['a']))") == set()

    def test_every_name_the_run_offers_is_not_collected(self) -> None:
        from wavecore.core.expressions.security import SAFE_BUILTINS

        for name in SAFE_BUILTINS:
            assert self.names(f"{name}") == set(), name

    def test_a_name_the_run_does_not_offer_is_collected(self) -> None:
        assert self.names("list(zip(rows, tuple(enumerate(cols))))") == {
            "zip",
            "tuple",
            "enumerate",
            "rows",
            "cols",
        }
