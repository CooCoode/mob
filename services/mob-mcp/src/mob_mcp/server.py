"""stdio MCP server exposing office Mac actuation tools."""

from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP, Image

from mob_mcp import __version__
from mob_mcp.tools import input as input_tools
from mob_mcp.tools.screenshot import screenshot as capture_screenshot
from mob_mcp.tools import windows as windows_tools

INSTRUCTIONS = """\
MOB office Mac desktop actuation (mob-mcp).

Use screenshot to observe the screen, then click/type_text/key to act.
Coordinates for click are in points (logical pixels); see screenshot metadata
for scale_factor on Retina displays.
Requires macOS Accessibility + Screen Recording for the launching host.
Human VNC viewers must stay viewOnly — do not use this server for remote human input.
"""

mcp = FastMCP(
    "mob-mcp",
    instructions=INSTRUCTIONS,
)


@mcp.tool(structured_output=False)
def screenshot() -> list[Any]:
    """Capture the primary display. Returns PNG image plus JSON metadata
    (scale_factor, point/pixel sizes). Use point coordinates for click().
    """
    result = capture_screenshot()
    return [
        Image(data=result["png"], format="png"),
        result["meta_json"],
    ]


@mcp.tool()
def click(
    x: float,
    y: float,
    button: Literal["left", "right"] = "left",
    count: int = 1,
) -> str:
    """Click at screen coordinates in points (logical pixels).

    Args:
        x: Horizontal position in points from the left of the main display.
        y: Vertical position in points from the top of the main display.
        button: left or right mouse button.
        count: click count (2 for double-click).
    """
    return input_tools.click(x=x, y=y, button=button, count=count)


@mcp.tool()
def type_text(text: str) -> str:
    """Type Unicode text into the currently focused UI element.

    Args:
        text: Text to type (uses pasteboard + Cmd+V when possible).
    """
    return input_tools.type_text(text)


@mcp.tool()
def key(combo: str) -> str:
    """Press a key or chord such as return, tab, escape, cmd+c, ctrl+shift+tab.

    Args:
        combo: Key name or modifiers+key joined by + (e.g. cmd+v, alt+f4 is not
            typical on macOS — prefer cmd+q to quit).
    """
    return input_tools.key(combo)


@mcp.tool()
def list_windows(on_screen_only: bool = True) -> str:
    """List visible windows: app, title, bounds, pid (JSON).

    Args:
        on_screen_only: If true, only windows currently on screen.
    """
    return windows_tools.windows_as_json(on_screen_only=on_screen_only)


@mcp.tool()
def open_app(name_or_bundle_id: str) -> str:
    """Launch a macOS application by name (e.g. Safari) or bundle id
    (e.g. com.apple.Safari).

    Args:
        name_or_bundle_id: Application name or bundle identifier.
    """
    return windows_tools.open_app(name_or_bundle_id)


def main() -> None:
    """Run the MCP server over stdio (default FastMCP transport)."""
    # Avoid printing to stdout — it is the MCP transport.
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
