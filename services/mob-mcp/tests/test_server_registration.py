"""MCP tool registration smoke (no GUI / no stdio run)."""

import asyncio

import mob_mcp.server as server
from mob_mcp.server import mcp


def test_expected_tools_registered():
    tools = asyncio.run(mcp.list_tools())
    names = sorted(t.name for t in tools)
    assert names == [
        "click",
        "key",
        "list_windows",
        "open_app",
        "screenshot",
        "type_text",
    ]


def test_screenshot_returns_mcp_content(monkeypatch):
    monkeypatch.setattr(
        server,
        "capture_screenshot",
        lambda: {"png": b"png", "meta_json": "{}"},
    )

    content = asyncio.run(mcp.call_tool("screenshot", {}))

    assert [item.type for item in content] == ["image", "text"]
