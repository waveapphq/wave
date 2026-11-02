"""The one Authorization header and the one-set rule (REQ-5.1.2)."""

from wavecore.connectivity.web_address import basic_authorization

from ._errors import VALIDATION, OpenSearchFailure


def authorization(username: str, password: str, api_key: str, bearer_token: str) -> str | None:
    """The header value the filled fields make, or None when none is filled."""
    if sum(map(bool, (username or password, api_key, bearer_token))) > 1:
        raise OpenSearchFailure(
            "Set only one of Username and Password, API Key or Bearer Token: "
            "all three go in the one Authorization header",
            VALIDATION,
        )
    if password and not username:
        raise OpenSearchFailure("Password needs a Username", VALIDATION)
    if username:
        return basic_authorization(username, password)
    if api_key:
        return f"ApiKey {api_key}"
    return f"Bearer {bearer_token}" if bearer_token else None
