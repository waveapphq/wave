"""One-shot MCP client for E2E: reads a recipe from stdin, calls one tool, prints the envelope."""

import asyncio
import json
import sys

from mcp import types
from mcp.client import Client


async def main() -> None:
    url, tool = sys.argv[1], sys.argv[2]
    recipe = sys.stdin.read()
    async with Client(
        url,
        client_info=types.Implementation(name="wave-e2e-recipe-client", version="1.0.0"),
    ) as client:
        result = await client.call_tool(tool, {"recipe": recipe})
        payload = json.loads(result.content[0].text)
        print(json.dumps({"isError": bool(result.is_error), "payload": payload}))


asyncio.run(main())
