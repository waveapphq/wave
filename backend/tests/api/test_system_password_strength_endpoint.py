"""POST /api/v1/system/password-strength: the score and its label, never cached (REQ-5.2.7.1)."""

import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.app import app

PATH = "/api/v1/system/password-strength"
PASSWORD = "Zebra-Quartz-Lantern-77!"
SAMPLES = [
    ("password", 0, "Very weak"),
    ("wave", 1, "Weak"),
    ("Tr0ub4dour&3", 2, "Fair"),
    ("Wavekeeper!9", 3, "Strong"),
    ("blue-kettle-42", 4, "Very strong"),
]


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _score(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(PATH, json=body)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


class TestScorePassword:
    def test_the_answer_is_the_success_envelope(self, client: TestClient) -> None:
        response = client.post(PATH, json={"password": "Wavekeeper!9"})

        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == {"success", "data", "meta"}
        assert body["success"] is True
        assert body["data"] == {"score": 3, "label": "Strong"}
        assert body["meta"]["path"] == PATH
        assert "request_id" in body["meta"]
        assert "timestamp" in body["meta"]

    @pytest.mark.parametrize(("password", "score", "label"), SAMPLES)
    def test_data_holds_the_score_and_the_label_only(
        self, client: TestClient, password: str, score: int, label: str
    ) -> None:
        data = _score(client, {"password": password})

        assert set(data) == {"score", "label"}
        assert data == {"score": score, "label": label}

    def test_the_answer_is_never_cached(self, client: TestClient) -> None:
        response = client.post(PATH, json={"password": "Wavekeeper!9"})

        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store"

    def test_the_response_does_not_repeat_the_password(self, client: TestClient) -> None:
        response = client.post(PATH, json={"password": PASSWORD, "user_inputs": ["wavekeeper"]})

        assert response.status_code == 200, response.text
        assert PASSWORD not in response.text

    def test_an_empty_password_is_very_weak(self, client: TestClient) -> None:
        assert _score(client, {"password": ""}) == {"score": 0, "label": "Very weak"}

    def test_a_password_longer_than_the_scored_length(self, client: TestClient) -> None:
        password = "correct-horse-battery-staple-9f3k!Q" * 3

        data = _score(client, {"password": password})

        assert set(data) == {"score", "label"}
        assert data == _score(client, {"password": password[:72]})


class TestUserInputs:
    def test_the_username_counts_against_the_password(self, client: TestClient) -> None:
        alone = _score(client, {"password": "wavekeeper2026"})

        with_username = _score(
            client, {"password": "wavekeeper2026", "user_inputs": ["wavekeeper"]}
        )

        assert with_username["score"] < alone["score"]

    def test_user_inputs_may_be_left_out_or_empty(self, client: TestClient) -> None:
        alone = _score(client, {"password": "wavekeeper2026"})

        assert _score(client, {"password": "wavekeeper2026", "user_inputs": []}) == alone
        assert _score(client, {"password": "wavekeeper2026", "user_inputs": [""]}) == alone


class TestRequestChecks:
    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"user_inputs": ["wavekeeper"]},
            {"password": 5},
            {"password": "Wavekeeper!9", "user_inputs": "wavekeeper"},
        ],
        ids=["empty", "no-password", "password-not-text", "user-inputs-not-a-list"],
    )
    def test_a_malformed_body_is_a_400(self, client: TestClient, body: dict[str, Any]) -> None:
        response = client.post(PATH, json=body)

        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


class TestNothingIsLogged:
    @pytest.mark.parametrize(
        "password", [PASSWORD, PASSWORD * 4], ids=["short", "over-the-scored-length"]
    )
    def test_the_password_never_reaches_the_log(
        self, client: TestClient, caplog: pytest.LogCaptureFixture, password: str
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            response = client.post(PATH, json={"password": password, "user_inputs": ["wavekeeper"]})

        assert response.status_code == 200, response.text
        messages = [record.getMessage() for record in caplog.records]
        bodies = [message for message in messages if "req body:" in message]
        assert len(bodies) == 1
        assert '"password": "***REDACTED***"' in bodies[0]
        assert all(PASSWORD not in message for message in messages)
        assert PASSWORD not in caplog.text

    def test_a_wrong_typed_password_is_refused_and_never_reaches_the_log(
        self, client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            response = client.post(PATH, json={"password": [PASSWORD]})

        assert response.status_code == 400, response.text
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        messages = [record.getMessage() for record in caplog.records]
        assert any(PATH in message for message in messages)
        assert all(PASSWORD not in message for message in messages)
        assert PASSWORD not in caplog.text
