"""Hotkey parsing unit tests (no GUI)."""

import pytest

from mob_mcp.tools.input import parse_hotkey


@pytest.mark.parametrize(
    "spec,key,mods",
    [
        ("return", "return", []),
        ("tab", "tab", []),
        ("cmd+c", "c", ["command"]),
        ("command+c", "c", ["command"]),
        ("ctrl+shift+tab", "tab", ["control", "shift"]),
        ("alt+f4", "f4", ["option"]),
        ("CMD+V", "v", ["command"]),
    ],
)
def test_parse_hotkey(spec, key, mods):
    got_key, got_mods = parse_hotkey(spec)
    assert got_key == key
    assert got_mods == mods


def test_parse_hotkey_rejects_empty():
    with pytest.raises(ValueError):
        parse_hotkey("")


def test_parse_hotkey_rejects_modifiers_only():
    with pytest.raises(ValueError, match="no key"):
        parse_hotkey("cmd+shift")
