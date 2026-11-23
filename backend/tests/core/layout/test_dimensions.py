"""Node size estimation mirroring the canvas card."""

from typing import Any


def estimate(node: dict[str, Any], ingress_count: int = 1) -> tuple[int, float]:
    from wavecore.core.layout.dimensions import estimate_node_size

    return estimate_node_size(node, ingress_count)


def fit(node: dict[str, Any], ingress_count: int = 1) -> int:
    from wavecore.core.layout.dimensions import fit_node_width

    return fit_node_width(node, ingress_count)


def make_node(
    element_type: str = "log",
    node_type: str = "plugin",
    *,
    values: dict[str, Any] | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": "Node",
        "elementType": element_type,
        "nodeType": node_type,
        "config": {"values": values or {}},
    }
    if description is not None:
        data["description"] = description
    return {"id": "node-1", "type": "workflowNode", "data": data}


def if_else_node(branch_count: int) -> dict[str, Any]:
    branches = [
        {"id": f"branch_{index}", "type": "if" if index == 0 else "else_if", "conditions": []}
        for index in range(branch_count)
    ]
    return make_node("if-else", "control", values={"branches": branches})


def switch_node(case_count: int, *, default: bool = False) -> dict[str, Any]:
    branches: list[dict[str, Any]] = [
        {"id": f"branch_{index}", "type": "case", "label": "", "conditions": [], "break": True}
        for index in range(case_count)
    ]
    if default:
        branches.append({"id": f"branch_{case_count}", "type": "default", "label": ""})
    return make_node("switch-case", "control", values={"branches": branches})


def parallel_node(branch_count: int) -> dict[str, Any]:
    branches = [{"id": f"branch_{index + 1}", "name": ""} for index in range(branch_count)]
    return make_node("parallel", "control", values={"branches": branches})


class TestDefaultWidths:
    def test_default_plugin_node_is_160_by_73(self) -> None:
        assert estimate(make_node()) == (160, 73)

    def test_zero_ingress_clamps_to_one_handle(self) -> None:
        assert estimate(make_node(), 0) == (160, 73)

    def test_function_node_gets_the_192_floor(self) -> None:
        assert estimate(make_node("function", "function")) == (192, 73)

    def test_a_one_line_description_adds_its_row(self) -> None:
        assert estimate(make_node(description="Fetch it")) == (160, 91.5)


class TestIngressDrivenWidths:
    def test_four_ingress_handles_widen_the_node(self) -> None:
        assert estimate(make_node(), 4) == (320, 73)

    def test_three_ingress_handles_set_a_240_width(self) -> None:
        assert estimate(make_node(), 3) == (240, 73)

    def test_six_ingress_handles_widen_without_an_upper_clamp(self) -> None:
        # handle_min is a hard floor with no upper clamp.
        assert estimate(make_node(), 6) == (480, 73)


class TestBranchFootprints:
    def test_if_else_five_branches(self) -> None:
        assert estimate(if_else_node(5)) == (352, 73)

    def test_if_else_two_branches_matches_the_floor(self) -> None:
        assert estimate(if_else_node(2)) == (160, 73)

    def test_try_with_catch_and_finally_has_four_handles(self) -> None:
        node = make_node(
            "try-catch-finally",
            "control",
            values={"enable_catch": True, "enable_finally": True},
        )
        assert estimate(node) == (288, 73)

    def test_try_with_catch_only_has_three_handles(self) -> None:
        node = make_node(
            "try-catch-finally",
            "control",
            values={"enable_catch": True, "enable_finally": False},
        )
        assert estimate(node) == (224, 73)

    def test_loops_and_remote_keep_the_two_handle_footprint(self) -> None:
        assert estimate(make_node("for", "control", values={"mode": "count", "count": 1})) == (
            160,
            73,
        )
        assert estimate(make_node("remote-execution", "plugin")) == (160, 73)

    def test_assert_modes_match_the_floor(self) -> None:
        assert estimate(make_node("assert", "control", values={"mode": "split"})) == (160, 73)
        assert estimate(make_node("assert", "control", values={"mode": "single"})) == (160, 73)


class TestSwitchFootprints:
    """Every branch gets a lane and the guaranteed `then` egress adds one more."""

    def test_switch_counts_branches_plus_the_then_handle(self) -> None:
        assert estimate(switch_node(4, default=True)) == (416, 73)

    def test_one_case_plus_then_matches_the_floor(self) -> None:
        assert estimate(switch_node(1)) == (160, 73)

    def test_two_cases_plus_then_widen_the_node(self) -> None:
        assert estimate(switch_node(2)) == (224, 73)

    def test_a_default_branch_adds_another_lane(self) -> None:
        assert estimate(switch_node(2, default=True)) == (288, 73)

    def test_three_cases_with_a_default(self) -> None:
        assert estimate(switch_node(3, default=True)) == (352, 73)

    def test_empty_branch_list_falls_back_to_the_handle_minimum(self) -> None:
        assert estimate(make_node("switch-case", "control", values={"branches": []})) == (160, 73)

    def test_missing_branches_key_falls_back_to_the_handle_minimum(self) -> None:
        assert estimate(make_node("switch-case", "control")) == (160, 73)

    def test_non_list_branches_falls_back_to_the_handle_minimum(self) -> None:
        string_branches = make_node("switch-case", "control", values={"branches": "branch_0"})
        int_branches = make_node("switch-case", "control", values={"branches": 3})
        assert estimate(string_branches) == (160, 73)
        assert estimate(int_branches) == (160, 73)

    def test_a_description_adds_its_row_to_a_switch(self) -> None:
        node = switch_node(2, default=True)
        node["data"]["description"] = "Route by status"
        assert estimate(node) == (288, 91.5)


class TestParallelFootprints:
    """Every branch gets a lane and the guaranteed `then` egress adds one more."""

    def test_two_branches_plus_then_widen_the_node(self) -> None:
        assert estimate(parallel_node(2)) == (224, 73)

    def test_three_branches_plus_then(self) -> None:
        assert estimate(parallel_node(3)) == (288, 73)

    def test_four_branches_plus_then(self) -> None:
        assert estimate(parallel_node(4)) == (352, 73)

    def test_branch_names_and_limits_do_not_change_the_footprint(self) -> None:
        node = make_node(
            "parallel",
            "control",
            values={
                "branches": [
                    {"id": "branch_1", "name": "ingest", "time_limit": 30000},
                    {"id": "branch_2", "name": "probe"},
                ],
                "join": "first",
                "time_limit": 60000,
            },
        )
        assert estimate(node) == (224, 73)

    def test_empty_branch_list_falls_back_to_the_handle_minimum(self) -> None:
        assert estimate(make_node("parallel", "control", values={"branches": []})) == (160, 73)

    def test_missing_branches_key_falls_back_to_the_handle_minimum(self) -> None:
        assert estimate(make_node("parallel", "control")) == (160, 73)

    def test_an_integer_branch_count_falls_back_to_the_handle_minimum(self) -> None:
        # Guard: branches is a list of records, so a count is not a size.
        assert estimate(make_node("parallel", "control", values={"branches": 4})) == (160, 73)

    def test_a_description_adds_its_row_to_a_parallel(self) -> None:
        node = parallel_node(3)
        node["data"]["description"] = "Fan out"
        assert estimate(node) == (288, 91.5)


class TestWaitUntilFootprint:
    """Wait Until's lane count follows its mode, so a Watch node is not widened."""

    @staticmethod
    def footprint(values: dict[str, Any]) -> int:
        from wavecore.core.layout.dimensions import _output_footprint

        return _output_footprint("wait-until", values)

    def test_retry_mode_gets_the_two_lane_footprint(self) -> None:
        assert self.footprint({"mode": "retry"}) == 160

    def test_a_wait_with_no_mode_configured_gets_the_two_lane_footprint(self) -> None:
        assert self.footprint({}) == 160

    def test_watch_mode_gets_the_single_handle_minimum(self) -> None:
        assert self.footprint({"mode": "watch"}) == 120

    def test_a_wait_node_still_renders_at_the_floor_in_both_modes(self) -> None:
        retry = make_node("wait-until", "control", values={"mode": "retry"})
        watch = make_node("wait-until", "control", values={"mode": "watch"})
        assert estimate(retry) == (160, 73)
        assert estimate(watch) == (160, 73)

    def test_ingress_still_beats_the_wait_footprint(self) -> None:
        node = make_node("wait-until", "control", values={"mode": "retry"})
        assert estimate(node, 5) == (400, 73)


class TestCombinedDrivers:
    def test_ingress_and_branch_footprint_take_the_max(self) -> None:
        assert estimate(if_else_node(2), 4) == (320, 73)

    def test_wide_branch_footprint_beats_ingress(self) -> None:
        assert estimate(if_else_node(5), 4) == (352, 73)

    def test_ingress_beats_the_switch_footprint(self) -> None:
        assert estimate(switch_node(2, default=True), 6) == (480, 73)

    def test_wide_switch_footprint_beats_ingress(self) -> None:
        assert estimate(switch_node(4, default=True), 2) == (416, 73)


def labeled_node(
    label: str, element_type: str = "log", node_type: str = "plugin"
) -> dict[str, Any]:
    node = make_node(element_type, node_type)
    node["data"]["label"] = label
    return node


def sized_node(width: Any, node_type: str = "plugin") -> dict[str, Any]:
    node = make_node("function" if node_type == "function" else "log", node_type)
    node["width"] = width
    return node


class TestCanvasBounds:
    def test_resize_bounds_match_the_canvas(self) -> None:
        from wavecore.core.layout import dimensions

        assert dimensions.NODE_MIN_WIDTH == 160
        assert dimensions.NODE_FUNCTION_MIN_WIDTH == 192
        assert dimensions.NODE_MAX_WIDTH == 360

    def test_title_fit_constants_match_the_canvas_title_row(self) -> None:
        from wavecore.core.layout import dimensions

        assert dimensions.TITLE_CHROME_WIDTH == 58
        assert dimensions.TITLE_CHAR_WIDTH == 10


class TestFitWidth:
    def test_a_short_name_sits_at_the_minimum(self) -> None:
        assert fit(labeled_node("Node")) == 160

    def test_a_ten_character_name_still_fits_the_minimum(self) -> None:
        assert fit(labeled_node("Fetch home")) == 160

    def test_a_long_name_widens_to_chrome_plus_ten_per_character(self) -> None:
        assert fit(labeled_node("Write push file on sshd host")) == 338

    def test_a_very_long_name_clamps_at_the_maximum(self) -> None:
        assert fit(labeled_node("Get a namespace that does not exist")) == 360

    def test_a_function_block_keeps_its_wider_floor(self) -> None:
        assert fit(labeled_node("fetch_status", "function", "function")) == 192

    def test_an_empty_label_falls_back_to_the_element_type(self) -> None:
        assert fit(labeled_node("", "remote-execution", "control")) == 218

    def test_the_fit_is_widened_by_the_handle_footprint(self) -> None:
        node = if_else_node(5)
        assert fit(node) == 352
        assert estimate(node) == (352, 73)

    def test_ingress_handles_widen_the_fit(self) -> None:
        assert fit(labeled_node("Log"), 3) == 240

    def test_a_long_name_beats_a_smaller_handle_footprint(self) -> None:
        node = if_else_node(3)
        node["data"]["label"] = "Write push file on sshd host"
        assert fit(node) == 338

    def test_a_short_named_control_is_as_wide_as_its_handles(self) -> None:
        assert fit(if_else_node(3)) == 224
        assert fit(switch_node(2, default=True)) == 288
        assert fit(parallel_node(3)) == 288

    def test_a_handle_footprint_past_the_resize_maximum_is_stored_as_drawn(self) -> None:
        assert fit(if_else_node(6)) == 416

    def test_the_stored_fit_is_the_width_the_layout_engine_uses(self) -> None:
        for node, ingress in (
            (if_else_node(3), 1),
            (labeled_node("Log"), 4),
            (parallel_node(3), 2),
        ):
            node["width"] = fit(node, ingress)
            assert estimate(node, ingress)[0] == node["width"]


class TestStoredWidth:
    def test_a_stored_width_replaces_the_floor(self) -> None:
        assert estimate(sized_node(338)) == (338, 73)

    def test_a_stored_width_below_the_floor_is_lifted_to_it(self) -> None:
        assert estimate(sized_node(100)) == (160, 73)

    def test_a_stored_width_above_the_maximum_is_clamped(self) -> None:
        assert estimate(sized_node(500)) == (360, 73)

    def test_handles_still_widen_a_stored_width(self) -> None:
        assert estimate(sized_node(200), 4) == (320, 73)

    def test_a_stored_width_beats_a_smaller_handle_footprint(self) -> None:
        assert estimate(sized_node(300), 3) == (300, 73)

    def test_the_function_floor_lifts_a_small_stored_width(self) -> None:
        assert estimate(sized_node(170, "function")) == (192, 73)

    def test_a_fractional_stored_width_is_rounded(self) -> None:
        assert estimate(sized_node(229.6)) == (230, 73)

    def test_a_non_numeric_stored_width_is_ignored(self) -> None:
        assert estimate(sized_node("wide")) == (160, 73)

    def test_a_stored_width_keeps_the_description_height(self) -> None:
        node = make_node(description="What this does")
        node["width"] = 300
        assert estimate(node) == (300, 91.5)


def tall_node(height: Any, *, description: str | None = None) -> dict[str, Any]:
    node = make_node(description=description)
    node["height"] = height
    return node


class TestStoredHeightIsIgnored:
    """A Block's height is never set by hand: it comes from its content alone."""

    def test_the_height_has_no_resize_bound_left(self) -> None:
        from wavecore.core.layout import dimensions

        assert not hasattr(dimensions, "NODE_MAX_HEIGHT")

    def test_a_stored_height_taller_than_the_card_is_ignored(self) -> None:
        assert estimate(tall_node(200)) == (160, 73)

    def test_a_stored_height_below_the_card_is_ignored(self) -> None:
        assert estimate(tall_node(50)) == (160, 73)

    def test_a_stored_height_on_a_card_with_a_description_is_ignored(self) -> None:
        assert estimate(tall_node(150, description="Fetch it")) == (160, 91.5)

    def test_a_non_numeric_stored_height_is_ignored(self) -> None:
        assert estimate(tall_node("tall")) == (160, 73)


def described(
    description: str, *, width: int | None = None, expanded: bool = False
) -> dict[str, Any]:
    node = make_node(description=description)
    if width is not None:
        node["width"] = width
    if expanded:
        node["data"]["descriptionExpanded"] = True
    return node


class TestCardHeight:
    """The whole card the canvas draws."""

    def test_the_card_constants_match_the_canvas(self) -> None:
        from wavecore.core.layout import dimensions

        assert dimensions.NODE_DEFAULT_HEIGHT == 44
        assert dimensions.BODY_CHROME_HEIGHT == 42
        assert dimensions.DESCRIPTION_GAP == 4
        assert dimensions.DESCRIPTION_LINE_HEIGHT == 16.5
        assert dimensions.DESCRIPTION_MAX_LINES == 2
        assert dimensions.DESCRIPTION_CHROME_WIDTH == 58
        assert dimensions.DESCRIPTION_CHEVRON_WIDTH == 20
        assert dimensions.DESCRIPTION_CHAR_WIDTH == 7.5
        assert dimensions.STATUS_BAR_HEIGHT == 29

    def test_the_tallest_card_with_a_collapsed_description_is_108(self) -> None:
        from wavecore.core.layout import dimensions

        assert dimensions.TALLEST_COLLAPSED_HEIGHT == 108

    def test_a_card_with_its_title_only_is_73(self) -> None:
        assert estimate(make_node()) == (160, 73)

    def test_a_one_line_description_makes_91_5(self) -> None:
        assert estimate(described("Fetch it")) == (160, 91.5)

    def test_a_description_wider_than_its_text_box_wraps_to_108(self) -> None:
        assert estimate(described("Read the order queue")) == (160, 108)

    def test_the_same_description_on_a_wider_block_stays_on_one_line(self) -> None:
        assert estimate(described("Read the order queue", width=300)) == (300, 91.5)

    def test_a_long_description_is_clamped_at_two_lines(self) -> None:
        assert estimate(described("x" * 64)) == (160, 108)

    def test_a_line_break_starts_a_line(self) -> None:
        assert estimate(described("line one\nline two", width=300)) == (300, 108)

    def test_a_final_line_break_adds_no_line(self) -> None:
        assert estimate(described("line one\n", width=300)) == (300, 91.5)

    def test_an_expanded_description_shows_every_line_beside_the_chevron(self) -> None:
        assert estimate(described("x" * 64, expanded=True)) == (160, 174)

    def test_an_expanded_description_keeps_its_blank_lines(self) -> None:
        assert estimate(described("a\n\nb", width=300, expanded=True)) == (300, 124.5)

    def test_a_function_block_card_has_the_same_height(self) -> None:
        assert estimate(make_node("function", "function")) == (192, 73)


def note_node(text: str, **size: Any) -> dict[str, Any]:
    return {
        "id": "note-1",
        "type": "noteNode",
        "data": {
            "label": "Note",
            "elementType": "note",
            "nodeType": "control",
            "config": {"values": {"text": text}},
        },
        **size,
    }


class TestNoteSize:
    """A Note's size is its stored size, else estimated from its text (REQ-5.2.7.4)."""

    def test_a_stored_size_is_the_size(self) -> None:
        assert estimate(note_node("Read me", width=300, height=200)) == (300, 200)

    def test_a_stored_width_of_160_is_kept(self) -> None:
        assert estimate(note_node("Read me", width=160, height=90)) == (160, 90)

    def test_a_size_stored_on_one_axis_only_estimates_the_other_from_the_text(self) -> None:
        assert estimate(note_node("one\ntwo\nthree\nfour", width=300)) == (300, 142)
        assert estimate(note_node("x" * 20, height=200)) == (186, 200)

    def test_a_short_one_line_note_sits_at_the_width_floor(self) -> None:
        # 7 x 8 + 26 = 82, lifted to 120; 22.75 + 51 = 73.75, rounded up.
        assert estimate(note_node("Read me")) == (120, 74)

    def test_a_long_line_widens_the_note_without_a_maximum(self) -> None:
        assert estimate(note_node("x" * 100)) == (826, 74)

    def test_the_longest_line_sets_the_width(self) -> None:
        assert estimate(note_node("short\n" + "y" * 20 + "\nmid")) == (186, 120)

    def test_four_lines_make_a_142_px_note(self) -> None:
        # 4 x 22.75 + 51 = 142.
        assert estimate(note_node("one\ntwo\nthree\nfour")) == (120, 142)

    def test_eight_lines_make_a_233_px_note(self) -> None:
        # 8 x 22.75 + 51 = 233.
        text = "\n".join(f"line {index}" for index in range(1, 9))
        assert estimate(note_node(text)) == (120, 233)
