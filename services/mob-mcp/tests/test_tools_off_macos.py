"""Ensure actuation tools fail clearly off macOS."""

import sys

import pytest

from mob_mcp.platform_util import UnsupportedPlatformError
from mob_mcp.tools import click, key, list_windows, open_app, screenshot, type_text


@pytest.mark.skipif(sys.platform == "darwin", reason="non-macOS only")
@pytest.mark.parametrize(
    "fn,args",
    [
        (screenshot, ()),
        (click, (10.0, 10.0)),
        (type_text, ("hi",)),
        (key, ("return",)),
        (list_windows, ()),
        (open_app, ("Safari",)),
    ],
)
def test_tools_require_macos(fn, args):
    with pytest.raises(UnsupportedPlatformError, match="requires macOS"):
        fn(*args)
