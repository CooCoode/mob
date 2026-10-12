"""Platform guard tests (run on any OS)."""

import sys

import pytest

from mob_mcp.platform_util import UnsupportedPlatformError, is_macos, require_macos


def test_is_macos_matches_sys_platform():
    assert is_macos() is (sys.platform == "darwin")


def test_require_macos_errors_off_darwin(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    with pytest.raises(UnsupportedPlatformError, match="requires macOS"):
        require_macos("screenshot")


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS only")
def test_require_macos_ok_on_darwin():
    require_macos("screenshot")
