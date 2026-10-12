"""open_app bundle-id heuristic."""

from mob_mcp.tools.windows import _looks_like_bundle_id


def test_bundle_id():
    assert _looks_like_bundle_id("com.apple.Safari")
    assert _looks_like_bundle_id("org.mozilla.firefox")


def test_app_name():
    assert not _looks_like_bundle_id("Safari")
    assert not _looks_like_bundle_id("Google Chrome")
