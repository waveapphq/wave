"""Password strength score (REQ-5.2.7.1): a score from 0 to 4 and its one-word label."""

import logging

import pytest

from wavecore.api.services import password_strength

LABELS = {0: "Very weak", 1: "Weak", 2: "Fair", 3: "Strong", 4: "Very strong"}
SAMPLES = [
    ("password", 0),
    ("wave", 1),
    ("Tr0ub4dour&3", 2),
    ("Wavekeeper!9", 3),
    ("blue-kettle-42", 4),
    ("correct-horse-battery-staple-9f3k!Q", 4),
]
WEAK_START = "a" * 72
STRONG_TAIL = "Zx9!qP#7mK2$vL5&"
LOGGED_PASSWORD = "Zebra-Quartz-Lantern-77!"


class TestScore:
    @pytest.mark.parametrize(("password", "expected"), SAMPLES)
    def test_a_password_gets_its_score_and_label(self, password: str, expected: int) -> None:
        assert password_strength.score(password) == {"score": expected, "label": LABELS[expected]}

    def test_the_samples_cover_every_score(self) -> None:
        scores = {password_strength.score(password)["score"] for password, _ in SAMPLES}

        assert scores == set(LABELS)

    def test_an_empty_password_is_very_weak(self) -> None:
        assert password_strength.score("") == {"score": 0, "label": "Very weak"}

    @pytest.mark.parametrize(
        "password",
        ["", "wave", "Wavekeeper!9", "x" * 100],
        ids=["empty", "weak", "strong", "over-the-limit"],
    )
    def test_the_result_holds_the_score_and_the_label_only(self, password: str) -> None:
        result = password_strength.score(password)

        assert set(result) == {"score", "label"}
        assert type(result["score"]) is int
        assert result["label"] == LABELS[result["score"]]


class TestUserInputs:
    def test_a_password_built_on_a_user_input_scores_lower(self) -> None:
        alone = password_strength.score("wavekeeper2026")

        with_username = password_strength.score("wavekeeper2026", user_inputs=["wavekeeper"])

        assert with_username["score"] < alone["score"]
        assert with_username["label"] == LABELS[with_username["score"]]

    def test_user_inputs_are_the_second_argument(self) -> None:
        by_name = password_strength.score("wavekeeper2026", user_inputs=["wavekeeper"])

        assert password_strength.score("wavekeeper2026", ["wavekeeper"]) == by_name
        assert password_strength.score("wavekeeper2026", ("wavekeeper",)) == by_name

    def test_no_user_inputs_is_the_default(self) -> None:
        alone = password_strength.score("wavekeeper2026")

        assert password_strength.score("wavekeeper2026", user_inputs=()) == alone
        assert password_strength.score("wavekeeper2026", user_inputs=[]) == alone

    def test_an_unrelated_user_input_changes_nothing(self) -> None:
        alone = password_strength.score("Wavekeeper!9")

        assert password_strength.score("Wavekeeper!9", user_inputs=["alice"]) == alone

    def test_empty_user_inputs_are_dropped(self) -> None:
        alone = password_strength.score("wavekeeper2026")
        with_username = password_strength.score("wavekeeper2026", user_inputs=["wavekeeper"])

        assert password_strength.score("wavekeeper2026", user_inputs=[""]) == alone
        assert password_strength.score("wavekeeper2026", user_inputs=["", ""]) == alone
        assert (
            password_strength.score("wavekeeper2026", user_inputs=["", "wavekeeper", ""])
            == with_username
        )

    def test_an_empty_password_with_user_inputs_is_very_weak(self) -> None:
        result = password_strength.score("", user_inputs=["wavekeeper"])

        assert result == {"score": 0, "label": "Very weak"}


class TestLongPasswords:
    def test_the_scored_length_is_the_library_limit(self) -> None:
        assert password_strength.MAX_SCORED_LENGTH == 72

    def test_a_password_at_the_limit_is_scored(self) -> None:
        assert password_strength.score(WEAK_START) == {"score": 0, "label": "Very weak"}

    @pytest.mark.parametrize("length", [73, 100, 5000])
    def test_a_longer_password_is_scored_without_error(self, length: int) -> None:
        result = password_strength.score("x" * length)

        assert set(result) == {"score", "label"}

    def test_a_longer_password_scores_as_its_first_characters(self) -> None:
        password = "correct-horse-battery-staple-9f3k!Q" * 3
        limit = password_strength.MAX_SCORED_LENGTH
        assert len(password) > limit

        assert password_strength.score(password) == password_strength.score(password[:limit])

    def test_characters_past_the_limit_do_not_raise_the_score(self) -> None:
        assert password_strength.score(STRONG_TAIL) == {"score": 4, "label": "Very strong"}

        result = password_strength.score(WEAK_START + STRONG_TAIL)

        assert result == password_strength.score(WEAK_START)
        assert result == {"score": 0, "label": "Very weak"}

    def test_a_longer_password_still_counts_the_user_inputs(self) -> None:
        password = "wavekeeper2026" + "x" * 100
        limit = password_strength.MAX_SCORED_LENGTH

        assert password_strength.score(
            password, user_inputs=["wavekeeper"]
        ) == password_strength.score(password[:limit], user_inputs=["wavekeeper"])


class TestNothingIsLogged:
    @pytest.mark.parametrize(
        "password", [LOGGED_PASSWORD, LOGGED_PASSWORD * 4], ids=["short", "over-the-limit"]
    )
    def test_the_password_is_never_logged(
        self, caplog: pytest.LogCaptureFixture, password: str
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            password_strength.score(password, user_inputs=["wavekeeper"])

        assert all(LOGGED_PASSWORD not in record.getMessage() for record in caplog.records)
        assert LOGGED_PASSWORD not in caplog.text
