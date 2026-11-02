"""The one Authorization header and the one-set rule (REQ-5.1.2, OS-11)."""

import pytest

from wavecore.connectivity.opensearch._auth import authorization
from wavecore.connectivity.opensearch._errors import OpenSearchFailure

MORE_THAN_ONE_SET = (
    "Set only one of Username and Password, API Key or Bearer Token: "
    "all three go in the one Authorization header"
)
PASSWORD_WITHOUT_USERNAME = "Password needs a Username"


def _refused(username: str, password: str, api_key: str, bearer_token: str) -> OpenSearchFailure:
    with pytest.raises(OpenSearchFailure) as caught:
        authorization(username, password, api_key, bearer_token)
    return caught.value


class TestTheHeaderTable:
    """Which fields are filled decides the header; there is no mode picker."""

    def test_username_and_password_give_basic(self) -> None:
        assert authorization("wave", "os-secret", "", "") == "Basic d2F2ZTpvcy1zZWNyZXQ="

    def test_a_username_with_an_empty_password_still_gives_basic(self) -> None:
        assert authorization("wave", "", "", "") == "Basic d2F2ZTo="

    def test_basic_encodes_the_pair_as_utf8(self) -> None:
        assert authorization("jürgen", "pässwörd", "", "") == "Basic asO8cmdlbjpww6Rzc3fDtnJk"

    def test_a_colon_inside_the_password_is_kept(self) -> None:
        assert authorization("svc", "a:b", "", "") == "Basic c3ZjOmE6Yg=="

    def test_an_api_key_is_sent_as_typed(self) -> None:
        assert authorization("", "", "os_Zm9vYmFy", "") == "ApiKey os_Zm9vYmFy"

    def test_a_bearer_token_is_sent_as_typed(self) -> None:
        assert (
            authorization("", "", "", "eyJhbGciOi.eyJzdWIi.c2ln")
            == "Bearer eyJhbGciOi.eyJzdWIi.c2ln"
        )

    def test_nothing_filled_sends_no_header(self) -> None:
        assert authorization("", "", "", "") is None

    def test_an_api_key_typed_with_its_scheme_word_is_not_stripped(self) -> None:
        assert authorization("", "", "ApiKey os_abc", "") == "ApiKey ApiKey os_abc"

    def test_a_bearer_token_typed_with_its_scheme_word_is_not_stripped(self) -> None:
        assert authorization("", "", "", "Bearer eyJ.x.y") == "Bearer Bearer eyJ.x.y"


class TestOneSetOnly:
    """More than one set, or a Password alone: reason Validation, before anything is sent."""

    @pytest.mark.parametrize(
        ("username", "password", "api_key", "bearer_token"),
        [
            ("wave", "os-secret", "os_key", ""),
            ("wave", "", "", "eyJ.x.y"),
            ("", "", "os_key", "eyJ.x.y"),
            ("wave", "os-secret", "os_key", "eyJ.x.y"),
            ("", "os-secret", "os_key", ""),
            ("", "os-secret", "", "eyJ.x.y"),
        ],
        ids=[
            "basic-and-api-key",
            "username-and-bearer",
            "api-key-and-bearer",
            "all-three",
            "password-alone-and-api-key",
            "password-alone-and-bearer",
        ],
    )
    def test_more_than_one_set(
        self, username: str, password: str, api_key: str, bearer_token: str
    ) -> None:
        failure = _refused(username, password, api_key, bearer_token)

        assert failure.message == MORE_THAN_ONE_SET
        assert failure.reason == "Validation"

    def test_a_password_without_a_username(self) -> None:
        failure = _refused("", "os-secret", "", "")

        assert failure.message == PASSWORD_WITHOUT_USERNAME
        assert failure.reason == "Validation"
