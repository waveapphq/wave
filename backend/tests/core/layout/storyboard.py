"""The release smoke check in three steps: a build, then two changes an assistant makes.

Step two adds a restart and a wait for health after the If, on the If's other path; step
three adds a release query and its check after the wait. The positions are the ones each step
must save, as the design of a changed test's layout gives them.
"""

from typing import Any

from tests.core.recipes.conftest import create_profile, make_recipe

NAME = "Release smoke check"

CONNECT = {
    "block": "ssh-session-open",
    "label": "Connect to App Server",
    "profiles": [
        {
            "profile": "App Server",
            "alias": "app",
            "fields": ["host", "port", "username", "password"],
        }
    ],
    "settings": {
        "host": {"expr": "app.host"},
        "port": {"expr": "app.port"},
        "username": {"expr": "app.username"},
        "password": {"expr": "app.password"},
        "host_key_verification": "strict",
    },
    "capture": {"session_id": "ssh_session"},
}
CHECK = {
    "block": "ssh-session-exec",
    "label": "Check Orders API",
    "settings": {
        "session_id": {"expr": "ssh_session"},
        "command": "pgrep -x orders-api > /dev/null && printf running || printf stopped",
    },
    "capture": {"stdout": "service_state"},
}
ALERT = {
    "block": "http-client",
    "label": "Alert On-Call",
    "settings": {
        "url": "https://oncall.prod.internal/v1/alerts",
        "method": "POST",
        "headers": {"Content-Type": "application/json"},
        "body_mode": "text",
        "body": '{"service":"orders-api","severity":"critical"}',
        "response_mode": "body",
        "verify_ssl": True,
        "ca_cert": "/etc/ssl/certs/prod-internal-ca.pem",
    },
}
DOWN = {
    "if": {
        "label": "Orders API down?",
        "if_label": "Down",
        "when": {
            "variable": "service_state",
            "operator": "not_equals",
            "value": "running",
            "value_type": "string",
        },
        "then": [
            ALERT,
            {
                "halt": {
                    "scope": "test",
                    "status": "failed",
                    "message": "Orders API is not running on the App Server",
                },
                "label": "Fail test",
            },
        ],
    }
}
RESTART = {
    "block": "ssh-session-exec",
    "label": "Restart Orders API",
    "settings": {"session_id": {"expr": "ssh_session"}, "command": "service orders-api restart"},
}
WAIT = {
    "wait_until": {
        "label": "Wait for healthy",
        "that": [
            {"variable": "api_status", "operator": "equals", "value": 200, "value_type": "integer"},
            {
                "variable": "api_health",
                "operator": "contains",
                "value": '"status":"ok"',
                "value_type": "string",
            },
        ],
        "timeout": 30000,
        "interval": 1000,
        "message": "Orders API did not answer healthy within 30 s of the restart",
        "fail_current_scope": True,
        "retry": [
            {
                "block": "http-client",
                "label": "Check /health",
                "settings": {
                    "url": "https://orders-api.prod.internal/health",
                    "method": "GET",
                    "response_mode": "body",
                    "verify_ssl": True,
                    "ca_cert": "/etc/ssl/certs/prod-internal-ca.pem",
                },
                "capture": {"status_code": "api_status", "body": "api_health"},
            }
        ],
    }
}
QUERY = {
    "block": "sql-client",
    "label": "Query releases",
    "profiles": [
        {
            "profile": "Release DB",
            "alias": "db",
            "fields": ["host", "port", "database", "username", "password"],
        }
    ],
    "settings": {
        "operation": "run_sql",
        "database_type": "postgresql",
        "host": {"expr": "db.host"},
        "port": {"expr": "db.port"},
        "database": {"expr": "db.database"},
        "username": {"expr": "db.username"},
        "password": {"expr": "db.password"},
        "sql": "SELECT version, status FROM releases ORDER BY deployed_at DESC LIMIT 1\n",
    },
    "capture": {"rows": "release_rows", "row_count": "release_row_count"},
}
VERIFY = {
    "assert": {
        "label": "Verify release",
        "that": [
            {
                "variable": "release_row_count",
                "operator": "equals",
                "value": 1,
                "value_type": "integer",
            },
            "release_rows[0]['status'] == 'live'",
        ],
        "fail_current_scope": True,
    }
}
DISCONNECT = {
    "block": "ssh-session-close",
    "label": "Disconnect",
    "settings": {"session_id": {"expr": "ssh_session"}},
}

_VARIABLES: list[dict[str, Any]] = [
    {"service_state": {"type": "string"}},
    {"api_status": {"type": "integer"}, "api_health": {"type": "string"}},
    {"release_rows": {"type": "table"}, "release_row_count": {"type": "integer"}},
]
_BODIES = [[CHECK, DOWN], [RESTART, WAIT], [QUERY, VERIFY]]


def step_recipe(step: int, name: str = NAME) -> str:
    """The recipe of step 1, 2 or 3."""
    body = [entry for part in _BODIES[:step] for entry in part]
    variables = {key: value for part in _VARIABLES[:step] for key, value in part.items()}
    remote = {
        "remote": {
            "label": "On App Server",
            "settings": {"session_id": {"expr": "ssh_session"}},
            "body": body,
        }
    }
    return make_recipe(
        [CONNECT, remote, DISCONNECT],
        name=name,
        description="Release smoke check of Orders API on the App Server.",
        tags=["release", "smoke"],
        variables=variables,
    )


def seed_profiles() -> None:
    """The two profiles the steps bind."""
    secret = {"username": "user", "password": "secret"}
    create_profile("App Server", config={"host": "app", "port": "22", **secret})
    create_profile("Release DB", config={"host": "db", "port": "5432", "database": "rel", **secret})


STEP_ONE = {
    "Connect to App Server": {"x": -134, "y": 140},
    "On App Server": {"x": -94, "y": 280},
    "Check Orders API": {"x": -429, "y": 420},
    "Orders API down?": {"x": -429, "y": 560},
    "Alert On-Call": {"x": -414, "y": 700},
    "Fail test": {"x": -400, "y": 840},
    "Disconnect": {"x": -80, "y": 420},
}
# The If's two paths get columns of their own; nothing the change does not need to move moves.
STEP_TWO = {
    "Connect to App Server": {"x": -134, "y": 140},
    "On App Server": {"x": -94, "y": 280},
    "Check Orders API": {"x": -589, "y": 420},
    "Orders API down?": {"x": -589, "y": 560},
    "Alert On-Call": {"x": -734, "y": 700},
    "Fail test": {"x": -720, "y": 840},
    "Restart Orders API": {"x": -439, "y": 700},
    "Wait for healthy": {"x": -429, "y": 840},
    "Check /health": {"x": -414, "y": 980},
    "Disconnect": {"x": -80, "y": 420},
}
# The wait's retry lane moves left of the new Blocks after it, and the Down path makes room.
STEP_THREE = {
    **STEP_TWO,
    "Alert On-Call": {"x": -1054, "y": 700},
    "Fail test": {"x": -1040, "y": 840},
    "Check /health": {"x": -734, "y": 980},
    "Query releases": {"x": -419, "y": 980},
    "Verify release": {"x": -419, "y": 1120},
}
STEPS = {1: STEP_ONE, 2: STEP_TWO, 3: STEP_THREE}


def positions_by_label(workflow: dict[str, Any]) -> dict[str, dict[str, float]]:
    return {node["data"]["label"]: node["position"] for node in workflow["nodes"]}
